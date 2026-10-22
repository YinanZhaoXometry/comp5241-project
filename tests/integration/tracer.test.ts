import { afterAll, describe, expect, it } from 'vitest';
import { auth } from '../../src/modules/identity-access/auth';
import { provisionSynthetic } from '../../src/modules/identity-access/provision';
import {
  upload,
  getStudy,
  savePlan,
  confirmPlan,
} from '../../src/modules/materials-setup/service';
import { removeRoot } from '../../src/modules/lifecycle-platform/service';
import { runExtraction } from '../../src/modules/materials-setup/extraction';
import { database, closeDatabase } from '../../src/adapters/postgres/database';
import { closeQueue } from '../../src/adapters/queue';
import { enqueue } from '../../src/adapters/queue';
import { transaction } from '../../src/adapters/postgres/database';
import {
  createRoot,
  stage,
  receipt as recordReceipt,
} from '../../src/modules/lifecycle-platform/repository';
import { createOperation } from '../../src/modules/lifecycle-platform/operations';
import { reconcileCopies } from '../../src/modules/lifecycle-platform/service';
import { authorize } from '../../src/modules/identity-access/access';
import {
  getOperation,
  getOriginal,
} from '../../src/modules/materials-setup/queries';
import { extractTxt } from '../../src/adapters/txt-extractor';
import { acknowledge } from '../../src/modules/materials-setup/batches';
import { store } from '../../src/adapters/private-files';
import { config } from '../../src/platform/config';
import { protectedResponse } from '../../src/platform/http';
import { readdir, mkdir, rmdir } from 'node:fs/promises';
import type { Command, Identity, Plan } from '../../src/contracts/setup';

const command = (revision = 0): Command => ({
  schemaVersion: 1,
  commandKey: crypto.randomUUID(),
  expectedRevision: revision,
});
const text =
  'Synthetic unit testing: arrange, act, assert. <script>not executable</script>';
const stream = (value = text) => new Blob([value]).stream();
const manual: Plan = {
  topic: 'Unit testing',
  goal: 'Apply a skill',
  clarification: '',
  outcomes: ['Write a deterministic unit test'],
  miniCourse: {
    title: 'First test',
    lessons: ['Arrange, act, assert'],
    practice: 'Test an addition function',
    estimatedMinutes: 20,
  },
  missingExplanations:
    'Coverage not assessed. No supplementary source fetched.',
};
async function actor(
  label: string,
  role: 'learner' | 'instructor' | 'admin' = 'learner',
) {
  const credentials = await provisionSynthetic(label, role);
  const response = await auth().api.signInEmail({
    body: { email: credentials.email, password: credentials.password },
    asResponse: true,
  });
  const body = await response.json();
  const session = await database().query<{ id: string }>(
    'SELECT id FROM auth.session WHERE token=$1',
    [body.token],
  );
  return {
    userId: credentials.userId,
    sessionId: session.rows[0].id,
  } satisfies Identity;
}
afterAll(async () => {
  await closeQueue();
  await closeDatabase();
});

describe('real PostgreSQL private tracer', () => {
  it('persists exact Manual confirmation, rejects B/instructor/admin and replays one result', async () => {
    const a = await actor('trace-a');
    const uploadCommand = command();
    const first = await upload(a, uploadCommand, 'synthetic.txt', stream());
    const replay = await upload(a, uploadCommand, 'synthetic.txt', stream());
    expect(replay).toEqual(first);
    await expect(
      upload(a, uploadCommand, 'synthetic.txt', stream('changed')),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    await runExtraction(first.operationId!);
    let preview = await getStudy(a, first.rootId);
    expect(preview.text).toBe(text);
    await expect(
      savePlan(a, first.rootId, {
        ...command(preview.revision),
        plan: manual,
        extractionId: preview.extractionId!,
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    await acknowledge(a, first.rootId, {
      ...command(preview.revision),
      selected: [
        {
          slotId: preview.slots[0].slotId,
          extractionId: preview.extractionId!,
          acknowledged: true,
        },
      ],
      excluded: [],
    });
    preview = await getStudy(a, first.rootId);
    const saved = await savePlan(a, first.rootId, {
      ...command(preview.revision),
      plan: manual,
      extractionId: preview.extractionId!,
      selectionId: preview.selection!.id,
    });
    const confirmation = {
      ...command(saved.revision),
      planRevisionId: saved.planRevisionId!,
    };
    const confirmed = await confirmPlan(a, first.rootId, confirmation);
    expect(await confirmPlan(a, first.rootId, confirmation)).toEqual(confirmed);
    await closeDatabase();
    expect((await getStudy(a, first.rootId)).confirmed?.plan).toEqual(manual);
    for (const other of [
      await actor('trace-b'),
      await actor('trace-instructor', 'instructor'),
      await actor('trace-admin', 'admin'),
    ]) {
      await expect(getStudy(other, first.rootId)).rejects.toMatchObject({
        code: 'FORBIDDEN_OR_NOT_FOUND',
      });
    }
    await expect(
      savePlan(a, first.rootId, {
        ...command(0),
        plan: manual,
        extractionId: preview.extractionId!,
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    await removeRoot(a, first.rootId, command(confirmed.revision));
    await expect(getStudy(a, first.rootId)).rejects.toMatchObject({
      code: 'FORBIDDEN_OR_NOT_FOUND',
    });
  });

  it('rejects invalid input without orphan files, rows or jobs', async () => {
    const a = await actor('invalid');
    const before = await database().query(
      'SELECT count(*) FROM app.lifecycle_staging',
    );
    const files = (await readdir(config().storagePath)).sort();
    const jobs = (
      await database().query('SELECT id FROM queue.job ORDER BY id')
    ).rows;
    for (const [name, value] of [
      ['x.pdf', text],
      ['x.txt', ''],
      ['x.txt', '\u0000binary'],
      ['x.txt', 'a'.repeat(20 * 1024 * 1024 + 1)],
    ]) {
      await expect(
        upload(a, command(), name, stream(value)),
      ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    }
    expect(
      (await database().query('SELECT count(*) FROM app.lifecycle_staging'))
        .rows,
    ).toEqual(before.rows);
    expect((await readdir(config().storagePath)).sort()).toEqual(files);
    expect(
      (await database().query('SELECT id FROM queue.job ORDER BY id')).rows,
    ).toEqual(jobs);
    expect(
      (
        await database().query(
          'SELECT count(*)::int AS count FROM app.lifecycle_root WHERE owner_id=$1',
          [a.userId],
        )
      ).rows[0].count,
    ).toBe(0);
  });

  it('revocation and expiry deny reads, mutations and late extraction', async () => {
    const a = await actor('revoked');
    const receipt = await upload(a, command(), 'revoked.txt', stream());
    await database().query('DELETE FROM auth.session WHERE id=$1', [
      a.sessionId,
    ]);
    await expect(getStudy(a, receipt.rootId)).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
    await runExtraction(receipt.operationId!);
    expect(
      (
        await database().query('SELECT state FROM app.operation WHERE id=$1', [
          receipt.operationId,
        ])
      ).rows[0].state,
    ).toBe('canceled');
    const expired = await actor('expired');
    await database().query(
      'UPDATE auth.session SET "expiresAt"=clock_timestamp()-interval \'1 second\' WHERE id=$1',
      [expired.sessionId],
    );
    await expect(
      upload(expired, command(), 'expired.txt', stream()),
    ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('rolls back enqueue/state/receipt on one SQL client and is invisible to an independent client', async () => {
    const a = await actor('rollback');
    const rootId = crypto.randomUUID();
    const operationId = crypto.randomUUID();
    const rollbackCommand = command();
    const observer = await database().connect();
    try {
      await expect(
        transaction(async (client) => {
          const principal = await authorize(client, a);
          await createRoot(client, a.userId, rootId);
          const job = {
            schemaVersion: 1 as const,
            operationId,
            rootId,
            ownerId: a.userId,
            sessionId: a.sessionId,
            generation: 0,
            epoch: principal.epoch,
          };
          await createOperation(client, job);
          await enqueue(client, job);
          await recordReceipt(
            client,
            a,
            rollbackCommand,
            'upload',
            'synthetic-rollback-hash',
            { rootId, operationId, revision: 0 },
          );
          expect(
            (
              await client.query('SELECT id FROM queue.job WHERE id=$1', [
                operationId,
              ])
            ).rowCount,
          ).toBe(1);
          expect(
            (
              await observer.query('SELECT id FROM queue.job WHERE id=$1', [
                operationId,
              ])
            ).rowCount,
          ).toBe(0);
          throw new Error('Synthetic rollback after enqueue');
        }),
      ).rejects.toThrow('Synthetic rollback');
      for (const table of ['app.lifecycle_root', 'app.operation', 'queue.job'])
        expect(
          (
            await observer.query(`SELECT id FROM ${table} WHERE id=$1`, [
              table.includes('root') ? rootId : operationId,
            ])
          ).rowCount,
        ).toBe(0);
      expect(
        (
          await observer.query(
            'SELECT 1 FROM app.command_receipt WHERE owner_id=$1 AND command_key=$2',
            [a.userId, rollbackCommand.commandKey],
          )
        ).rowCount,
      ).toBe(0);
    } finally {
      observer.release();
    }
  });

  it('serializes simultaneous duplicate uploads and duplicate effects across independent clients', async () => {
    const a = await actor('duplicates');
    const key = command();
    const [first, second] = await Promise.all([
      upload(a, key, 'duplicate.txt', stream()),
      upload(a, key, 'duplicate.txt', stream()),
    ]);
    expect(first).toEqual(second);
    expect(
      (
        await database().query('SELECT id FROM queue.job WHERE id=$1', [
          first.operationId,
        ])
      ).rowCount,
    ).toBe(1);
    await Promise.all([
      runExtraction(first.operationId!),
      runExtraction(first.operationId!),
    ]);
    expect(
      (
        await database().query(
          'SELECT id FROM app.extraction_revision WHERE root_id=$1',
          [first.rootId],
        )
      ).rowCount,
    ).toBe(1);
    let preview = await getStudy(a, first.rootId);
    await acknowledge(a, first.rootId, {
      ...command(preview.revision),
      selected: [
        {
          slotId: preview.slots[0].slotId,
          extractionId: preview.extractionId!,
          acknowledged: true,
        },
      ],
      excluded: [],
    });
    preview = await getStudy(a, first.rootId);
    const saved = await savePlan(a, first.rootId, {
      ...command(preview.revision),
      plan: manual,
      extractionId: preview.extractionId!,
      selectionId: preview.selection!.id,
    });
    const confirmation = {
      ...command(saved.revision),
      planRevisionId: saved.planRevisionId!,
    };
    const results = await Promise.all([
      confirmPlan(a, first.rootId, confirmation),
      confirmPlan(a, first.rootId, confirmation),
    ]);
    expect(results[0]).toEqual(results[1]);
    expect(
      (
        await database().query(
          'SELECT plan_id FROM app.plan_confirmation WHERE root_id=$1',
          [first.rootId],
        )
      ).rowCount,
    ).toBe(1);
  });

  it('fences deletion racing extracted output, removes physical copies and preserves unrelated roots', async () => {
    const a = await actor('delete-race');
    const first = await upload(a, command(), 'remove.txt', stream());
    const other = await upload(
      a,
      command(),
      'keep.txt',
      stream('Unrelated synthetic root'),
    );
    await runExtraction(other.operationId!);
    let reached!: () => void;
    let release!: () => void;
    const atOutput = new Promise<void>((resolve) => {
      reached = resolve;
    });
    const resume = new Promise<void>((resolve) => {
      release = resolve;
    });
    const running = runExtraction(first.operationId!, async (input) => {
      const output = await extractTxt(input);
      reached();
      await resume;
      return output;
    });
    await atOutput;
    const keys = (
      await database().query<{ storage_key: string }>(
        'SELECT storage_key FROM app.lifecycle_object WHERE root_id=$1 AND storage_key IS NOT NULL',
        [first.rootId],
      )
    ).rows.map((row) => row.storage_key);
    const deletion = command(0);
    expect(await removeRoot(a, first.rootId, deletion)).toEqual(
      await removeRoot(a, first.rootId, deletion),
    );
    await expect(getStudy(a, first.rootId)).rejects.toMatchObject({
      code: 'FORBIDDEN_OR_NOT_FOUND',
    });
    release();
    await running;
    await reconcileCopies();
    const copies = await readdir(config().storagePath);
    expect(keys.every((key) => !copies.includes(key))).toBe(true);
    for (const table of [
      'app.material',
      'app.extraction_revision',
      'app.plan_revision',
      'app.lifecycle_object',
    ]) {
      expect(
        (
          await database().query(
            `SELECT 1 FROM ${table} WHERE ${table === 'app.material' ? 'id' : 'root_id'}=$1`,
            [first.rootId],
          )
        ).rowCount,
      ).toBe(0);
    }
    expect((await getStudy(a, other.rootId)).text).toBe(
      'Unrelated synthetic root',
    );
    expect(
      (
        await database().query('SELECT state FROM app.operation WHERE id=$1', [
          first.operationId,
        ])
      ).rows[0].state,
    ).toBe('canceled');
  });

  it('serializes session revocation against a protected mutation and discards late output', async () => {
    const a = await actor('revocation-race');
    const uploaded = await upload(a, command(), 'revocation.txt', stream());
    let reached!: () => void;
    let release!: () => void;
    const atOutput = new Promise<void>((resolve) => {
      reached = resolve;
    });
    const resume = new Promise<void>((resolve) => {
      release = resolve;
    });
    const running = runExtraction(uploaded.operationId!, async (input) => {
      const output = await extractTxt(input);
      reached();
      await resume;
      return output;
    });
    await atOutput;
    const revoker = await database().connect();
    try {
      await revoker.query('DELETE FROM auth.session WHERE id=$1', [
        a.sessionId,
      ]);
    } finally {
      revoker.release();
    }
    release();
    await running;
    expect(
      (
        await database().query(
          'SELECT id FROM app.extraction_revision WHERE root_id=$1',
          [uploaded.rootId],
        )
      ).rowCount,
    ).toBe(0);
    await expect(getOriginal(a, uploaded.rootId)).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
    await expect(getOperation(a, uploaded.operationId!)).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
  });

  it('reconciles expired staged copies after rollback/restart and reports honest 120-second pending', async () => {
    const a = await actor('staging');
    const key = await transaction((client) => stage(client, a.userId));
    await store(key, stream());
    await database().query(
      "UPDATE app.lifecycle_staging SET lease_until=clock_timestamp()-interval '1 second' WHERE key=$1",
      [key],
    );
    await reconcileCopies();
    expect((await readdir(config().storagePath)).includes(key)).toBe(false);
    expect(
      (
        await database().query(
          'SELECT 1 FROM app.lifecycle_staging WHERE key=$1',
          [key],
        )
      ).rowCount,
    ).toBe(0);
    const uploaded = await upload(a, command(), 'pending.txt', stream());
    await database().query(
      "UPDATE app.operation SET created_at=clock_timestamp()-interval '121 seconds' WHERE id=$1",
      [uploaded.operationId],
    );
    expect((await getStudy(a, uploaded.rootId)).operation).toMatchObject({
      state: 'queued',
      pending: true,
    });
  });

  it('accepts exactly 20MiB and isolates the complete output without creating extra effects', async () => {
    const a = await actor('at-limit');
    const value = 'a'.repeat(20 * 1024 * 1024);
    const uploaded = await upload(a, command(), 'at-limit.txt', stream(value));
    await runExtraction(uploaded.operationId!);
    expect((await getStudy(a, uploaded.rootId)).text?.length).toBe(
      value.length,
    );
    await removeRoot(a, uploaded.rootId, command(1));
  });

  it('denies runtime schema administration and ordered migration metadata writes', async () => {
    await expect(
      database().query('CREATE TABLE app.synthetic_forbidden_ddl(id int)'),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      database().query('CREATE SCHEMA synthetic_forbidden_schema'),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      database().query(
        "INSERT INTO app.schema_migration VALUES('synthetic-forbidden','not-applied')",
      ),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('keeps crash-staged copies pending until reconciled instead of falsely reporting purged', async () => {
    const a = await actor('crash-staging');
    const uploaded = await upload(a, command(), 'crash.txt', stream());
    const staged = await transaction((client) => stage(client, a.userId));
    await store(
      staged,
      stream('Synthetic unregistered extraction after crash'),
    );
    await removeRoot(a, uploaded.rootId, command());
    expect(
      (
        await database().query(
          'SELECT cleanup_state FROM app.lifecycle_root WHERE id=$1',
          [uploaded.rootId],
        )
      ).rows[0].cleanup_state,
    ).toBe('pending');
    expect((await readdir(config().storagePath)).includes(staged)).toBe(true);
    await database().query(
      "UPDATE app.lifecycle_staging SET lease_until=clock_timestamp()-interval '1 second' WHERE key=$1",
      [staged],
    );
    await reconcileCopies();
    await reconcileCopies();
    expect((await readdir(config().storagePath)).includes(staged)).toBe(false);
    expect(
      (
        await database().query(
          'SELECT cleanup_state FROM app.lifecycle_root WHERE id=$1',
          [uploaded.rootId],
        )
      ).rows[0].cleanup_state,
    ).toBe('purged');
  });

  it('isolates one physical purge failure and continues cleaning unrelated pending roots', async () => {
    const a = await actor('purge-isolation');
    const b = await actor('purge-unrelated');
    const first = await upload(a, command(), 'blocked.txt', stream());
    const second = await upload(b, command(), 'unrelated.txt', stream());
    const key = crypto.randomUUID();
    const path = `${config().storagePath}/${key}`;
    await mkdir(path);
    await database().query(
      "INSERT INTO app.lifecycle_object(id,root_id,kind,storage_key) VALUES($1,$2,'extraction',$3)",
      [crypto.randomUUID(), first.rootId, key],
    );
    try {
      await removeRoot(a, first.rootId, command());
      await database().query(
        "UPDATE app.lifecycle_root SET deleted_at=clock_timestamp(),cleanup_state='pending' WHERE id=$1",
        [second.rootId],
      );
      await expect(reconcileCopies()).resolves.toBeUndefined();
      expect(
        (
          await database().query(
            'SELECT cleanup_state FROM app.lifecycle_root WHERE id=$1',
            [second.rootId],
          )
        ).rows[0].cleanup_state,
      ).toBe('purged');
      expect(
        (
          await database().query(
            'SELECT cleanup_state FROM app.lifecycle_root WHERE id=$1',
            [first.rootId],
          )
        ).rows[0].cleanup_state,
      ).toBe('pending');
    } finally {
      await rmdir(path);
      await reconcileCopies();
    }
  });

  it('records an exhausted extraction attempt as permanent instead of promising nonexistent retries', async () => {
    const a = await actor('exhausted');
    const uploaded = await upload(a, command(), 'exhausted.txt', stream());
    await database().query(
      "UPDATE queue.job SET retry_count=retry_limit,state='active' WHERE id=$1",
      [uploaded.operationId],
    );
    await expect(
      runExtraction(uploaded.operationId!, async () => {
        throw new Error('Synthetic final extraction failure');
      }),
    ).rejects.toThrow('Extraction requires retry');
    expect((await getOperation(a, uploaded.operationId!)).state).toBe(
      'permanent-failed',
    );
    await removeRoot(a, uploaded.rootId, command());
  });

  it('stops controlled stream chunks immediately after session revocation', async () => {
    const a = await actor('stream-revocation');
    const uploaded = await upload(a, command(), 'stream.txt', stream());
    const response = protectedResponse(
      a,
      uploaded.rootId,
      'a'.repeat(40000),
      new AbortController().signal,
      true,
    );
    const reader = response.body!.getReader();
    expect((await reader.read()).value?.length).toBe(16384);
    await database().query('DELETE FROM auth.session WHERE id=$1', [
      a.sessionId,
    ]);
    await expect(reader.read()).rejects.toThrow('This item is unavailable');
    reader.releaseLock();
  });

  it('reconciles terminal queue state after a final-attempt process crash bypassed the catch', async () => {
    const a = await actor('terminal-crash');
    const uploaded = await upload(a, command(), 'terminal-crash.txt', stream());
    // Persist the exact two-store crash boundary: claim committed, no catch ran,
    // and queue supervision has already exhausted the final attempt.
    await database().query(
      "UPDATE app.operation SET state='extracting',attempt_id=$2,lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",
      [uploaded.operationId, crypto.randomUUID()],
    );
    await database().query(
      "UPDATE queue.job SET state='failed',retry_count=retry_limit WHERE id=$1",
      [uploaded.operationId],
    );
    await reconcileCopies();
    expect((await getOperation(a, uploaded.operationId!)).state).toBe(
      'permanent-failed',
    );
    await removeRoot(a, uploaded.rootId, command());
  });
});
