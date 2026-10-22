import { afterAll, describe, expect, it } from 'vitest';
import { auth } from '../../src/modules/identity-access/auth';
import { provisionSynthetic } from '../../src/modules/identity-access/provision';
import {
  upload,
  getStudy,
  savePlan,
} from '../../src/modules/materials-setup/service';
import {
  removeRoot,
  personalRemoval,
  dependenciesPreview,
  reconcileCopies,
} from '../../src/modules/lifecycle-platform/service';
import type { DependencyPreview } from '../../src/modules/lifecycle-platform/dependencies';
import {
  registerLifecyclePort,
  unregisterLifecyclePort,
  type LifecyclePort,
} from '../../src/modules/lifecycle-platform/derivatives';
import * as lifecycle from '../../src/modules/lifecycle-platform/repository';
import { runExtraction } from '../../src/modules/materials-setup/extraction';
import { acknowledge } from '../../src/modules/materials-setup/batches';
import {
  database,
  closeDatabase,
  transaction,
} from '../../src/adapters/postgres/database';
import { closeQueue } from '../../src/adapters/queue';
import {
  getOriginal,
} from '../../src/modules/materials-setup/queries';
import { extractTxt } from '../../src/adapters/txt-extractor';
import { config } from '../../src/platform/config';
import { protectedResponse } from '../../src/platform/http';
import { readdir } from 'node:fs/promises';
import type { Command, Identity, Plan } from '../../src/contracts/setup';

// Synthetic fixtures only: every account, document and receipt below is
// generated for this suite. No live AI, external calls or real data.
const command = (revision = 0): Command => ({
  schemaVersion: 1,
  commandKey: crypto.randomUUID(),
  expectedRevision: revision,
});
const text = 'Synthetic lifecycle deletion test source. <script>inert</script>';
const stream = (value = text) => new Blob([value]).stream();
const manual: Plan = {
  topic: 'Deletion lifecycle',
  goal: 'Apply a skill',
  clarification: '',
  outcomes: ['Verify protective deletion'],
  miniCourse: {
    title: 'Lifecycle probe',
    lessons: ['Preview, revoke, purge'],
    practice: 'Delete a synthetic study',
    estimatedMinutes: 15,
  },
  missingExplanations: 'Coverage not assessed. No supplementary source fetched.',
};
async function actor(label: string) {
  const credentials = await provisionSynthetic(label, 'learner');
  const response = await auth().api.signInEmail({
    body: { email: credentials.email, password: credentials.password },
    asResponse: true,
  });
  const body = await response.json();
  const session = await database().query<{ id: string }>(
    'SELECT id FROM auth.session WHERE token=$1',
    [body.token],
  );
  return { userId: credentials.userId, sessionId: session.rows[0].id } satisfies Identity;
}
async function extracted(identity: Identity, filename: string, value = text) {
  const receipt = await upload(identity, command(), filename, stream(value));
  await runExtraction(receipt.operationId!);
  return receipt;
}
async function planned(identity: Identity, filename: string) {
  const receipt = await extracted(identity, filename);
  let study = await getStudy(identity, receipt.rootId);
  await acknowledge(identity, receipt.rootId, {
    ...command(study.revision),
    selected: [
      {
        slotId: study.slots[0].slotId,
        extractionId: study.extractionId!,
        acknowledged: true,
      },
    ],
    excluded: [],
  });
  study = await getStudy(identity, receipt.rootId);
  const saved = await savePlan(identity, receipt.rootId, {
    ...command(study.revision),
    plan: manual,
    extractionId: study.extractionId!,
    selectionId: study.selection!.id,
  });
  return { ...receipt, planRevisionId: saved.planRevisionId, extractionId: study.extractionId! };
}
function category(preview: { categories: { key: string; count: number }[] }, key: string) {
  return preview.categories.find(item => item.key === key);
}
// personalRemoval is a discriminated union by body: preview in, receipt in.
type PersonalReceipt = {
  requestId: string;
  commandKey: string;
  state: string;
  acceptedAt: string;
  deadlineAt: string;
  purgedAt: string | null;
};
const asPreview = (value: Awaited<ReturnType<typeof personalRemoval>>) => value as DependencyPreview;
const asReceipt = (value: Awaited<ReturnType<typeof personalRemoval>>) => value as PersonalReceipt;
const DAY = 24 * 60 * 60 * 1000;
afterAll(async () => {
  await closeQueue();
  await closeDatabase();
});

describe('root-scoped deletion and whole-personal deletion lifecycle', () => {
  it('previews root dependencies by category, journals content-free counts and denies unauthorized or deleted scopes', async () => {
    const a = await actor('lifecycle-preview-a');
    const keeper = await extracted(a, 'keeper.txt', 'Unrelated synthetic root kept after A is deleted');
    const plannedRoot = await planned(a, 'preview.txt');
    const preview = await dependenciesPreview(a, plannedRoot.rootId, { schemaVersion: 1 });
    expect(preview.scope).toBe('root');
    expect(preview.deadlineDays).toBe(7);
    expect(category(preview, 'studies')).toMatchObject({ count: 1 });
    expect(category(preview, 'originals')).toMatchObject({ count: 1 });
    expect(category(preview, 'extractions')).toMatchObject({ count: 1 });
    expect(category(preview, 'selections')).toMatchObject({ count: 1 });
    expect(category(preview, 'plans')).toMatchObject({ count: 1 });
    expect(category(preview, 'confirmations')).toMatchObject({ count: 0 });
    expect(category(preview, 'operations')).toMatchObject({ count: 0 });
    // The journal stores category counts only, never plan or material text.
    const journal = await database().query<{ categories: unknown }>(
      'SELECT categories FROM app.deletion_preview WHERE root_id=$1 ORDER BY created_at DESC LIMIT 1',
      [plannedRoot.rootId],
    );
    expect(journal.rows).toHaveLength(1);
    expect(JSON.stringify(journal.rows[0].categories)).not.toContain('Deletion lifecycle');
    expect(category(preview, 'exports')).toBeUndefined();
    expect(category(preview, 'diagnostics')).toBeUndefined();
    const b = await actor('lifecycle-preview-b');
    await expect(
      dependenciesPreview(b, plannedRoot.rootId, { schemaVersion: 1 }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN_OR_NOT_FOUND' });
    await expect(
      dependenciesPreview(a, plannedRoot.rootId, { schemaVersion: 2 }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    // Deleting A leaves unrelated B usable, and a deleted root can no longer
    // be previewed because nothing selectable remains.
    await removeRoot(a, plannedRoot.rootId, command(3));
    await expect(
      dependenciesPreview(a, plannedRoot.rootId, { schemaVersion: 1 }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN_OR_NOT_FOUND' });
    expect((await getStudy(a, keeper.rootId)).text).toContain('Unrelated synthetic root');
  });

  it('whole-personal deletion revokes every root before returning, replays one receipt and reports the seven-day deadline', async () => {
    const a = await actor('lifecycle-personal');
    const plannedRoot = await planned(a, 'personal-plan.txt');
    const second = await extracted(a, 'personal-second.txt');
    const keys = (
      await database().query<{ storage_key: string }>(
        'SELECT storage_key FROM app.lifecycle_object WHERE root_id=ANY($1::uuid[]) AND storage_key IS NOT NULL',
        [[plannedRoot.rootId, second.rootId]],
      )
    ).rows.map(row => row.storage_key);
    const preview = asPreview(await personalRemoval(a, { schemaVersion: 1, preview: true }));
    expect(preview.scope).toBe('personal');
    expect(category(preview, 'studies')).toMatchObject({ count: 2 });
    expect(category(preview, 'originals')).toMatchObject({ count: 2 });
    expect(category(preview, 'plans')).toMatchObject({ count: 1 });
    const key = command(0);
    const receipt = asReceipt(await personalRemoval(a, key));
    expect(receipt.state).toBe('pending');
    const span =
      Date.parse(receipt.deadlineAt) - Date.parse(receipt.acceptedAt);
    expect(Math.abs(span - 7 * DAY)).toBeLessThan(5000);
    // Denial is durable before the accepted request returns.
    for (const rootId of [plannedRoot.rootId, second.rootId]) {
      await expect(getStudy(a, rootId)).rejects.toMatchObject({ code: 'FORBIDDEN_OR_NOT_FOUND' });
      await expect(getOriginal(a, rootId)).rejects.toMatchObject({ code: 'FORBIDDEN_OR_NOT_FOUND' });
    }
    expect(await personalRemoval(a, key)).toMatchObject({ requestId: receipt.requestId });
    await expect(
      personalRemoval(a, { ...key, expectedRevision: 1 }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    // A late worker result cannot recommit into a revoked lineage.
    await runExtraction(second.operationId!);
    expect(
      (
        await database().query(
          'SELECT 1 FROM app.extraction_revision WHERE root_id=$1',
          [second.rootId],
        )
      ).rowCount,
    ).toBe(0);
    await reconcileCopies();
    await reconcileCopies();
    const purged = asReceipt(await personalRemoval(a, key));
    expect(purged).toMatchObject({ requestId: receipt.requestId, state: 'purged' });
    const copies = await readdir(config().storagePath);
    expect(keys.every(storage => !copies.includes(storage))).toBe(true);
    for (const [table, column] of [
      ['app.material', 'id'],
      ['app.extraction_revision', 'root_id'],
      ['app.plan_revision', 'root_id'],
      ['app.plan_confirmation', 'root_id'],
      ['app.lifecycle_object', 'root_id'],
    ] as const) {
      expect(
        (
          await database().query(
            `SELECT 1 FROM ${table} WHERE ${column}=ANY($1::uuid[]) LIMIT 1`,
            [[plannedRoot.rootId, second.rootId]],
          )
        ).rowCount,
      ).toBe(0);
    }
    const request = await database().query(
      'SELECT state,purged_at FROM app.deletion_request WHERE id=$1',
      [receipt.requestId],
    );
    expect(request.rows[0]).toMatchObject({ state: 'purged' });
    expect(request.rows[0].purged_at).not.toBeNull();
    const b = await actor('lifecycle-personal-other');
    const other = await extracted(b, 'untouched.txt');
    expect((await getStudy(b, other.rootId)).text).toContain('Synthetic lifecycle');
  });

  it('personal deletion racing an in-flight extraction discards the late result and erases every copy', async () => {
    const a = await actor('lifecycle-race');
    const uploaded = await upload(a, command(), 'race.txt', stream());
    const keys = (
      await database().query<{ storage_key: string }>(
        'SELECT storage_key FROM app.lifecycle_object WHERE root_id=$1 AND storage_key IS NOT NULL',
        [uploaded.rootId],
      )
    ).rows.map(row => row.storage_key);
    expect(keys.length).toBeGreaterThanOrEqual(1);
    let reached!: () => void;
    let release!: () => void;
    const atOutput = new Promise<void>(resolve => {
      reached = resolve;
    });
    const resume = new Promise<void>(resolve => {
      release = resolve;
    });
    const running = runExtraction(uploaded.operationId!, async input => {
      const output = await extractTxt(input);
      reached();
      await resume;
      return output;
    });
    await atOutput;
    const key = command(0);
    const receipt = asReceipt(await personalRemoval(a, key));
    expect(receipt.state).toBe('pending');
    await expect(getStudy(a, uploaded.rootId)).rejects.toMatchObject({
      code: 'FORBIDDEN_OR_NOT_FOUND',
    });
    release();
    await running;
    expect(
      (
        await database().query(
          'SELECT 1 FROM app.extraction_revision WHERE root_id=$1',
          [uploaded.rootId],
        )
      ).rowCount,
    ).toBe(0);
    expect(
      (
        await database().query('SELECT state FROM app.operation WHERE id=$1', [
          uploaded.operationId,
        ])
      ).rows[0].state,
    ).toBe('canceled');
    await reconcileCopies();
    const copies = await readdir(config().storagePath);
    expect(keys.every(storage => !copies.includes(storage))).toBe(true);
  });

  it('denies an in-flight protected download at the next chunk once deletion is accepted', async () => {
    const a = await actor('lifecycle-download');
    const uploaded = await upload(a, command(), 'download.txt', stream());
    const original = await getOriginal(a, uploaded.rootId);
    const response = protectedResponse(
      a,
      uploaded.rootId,
      original.bytes,
      new AbortController().signal,
      true,
      [original.objectId],
    );
    const reader = response.body!.getReader();
    expect((await reader.read()).value?.length).toBeGreaterThan(0);
    await personalRemoval(a, command(0));
    await expect(reader.read()).rejects.toThrow('This item is unavailable');
    reader.releaseLock();
  });

  it('registered derivative ports preview, deny and purge before return and the reconciler completes them (synthetic adapter contract)', async () => {
    const a = await actor('lifecycle-ports');
    const plannedRoot = await planned(a, 'ports.txt');
    const calls: string[] = [];
    const synthetic: LifecyclePort = {
      name: 'synthetic-future-derivative',
      label: 'Synthetic future reminders (contract fixture)',
      async preview(_client, scope) {
        calls.push(`preview:${scope.personal ? 'personal' : 'root'}`);
        return [
          {
            key: 'reminders',
            label: this.label,
            count: scope.personal ? 3 : scope.rootIds.length,
          },
        ];
      },
      async deny(_client, scope) {
        calls.push(`deny:${scope.personal ? 'personal' : 'root'}:${scope.rootIds.length}`);
      },
      async purge(_client, scope) {
        calls.push(`purge:${scope.personal ? 'personal' : 'root'}`);
      },
    };
    registerLifecyclePort(synthetic);
    try {
      const preview = await dependenciesPreview(a, plannedRoot.rootId, { schemaVersion: 1 });
      expect(category(preview, 'reminders')).toMatchObject({ count: 1 });
      const key = command(0);
      await personalRemoval(a, key);
      // Deny ran for the whole-personal scope before the receipt returned, and
      // the purge attempt followed it inside the same accepted request.
      const denyAt = calls.indexOf('deny:personal:1');
      const purgeAt = calls.indexOf('purge:personal');
      expect(denyAt).toBeGreaterThanOrEqual(0);
      expect(purgeAt).toBeGreaterThan(denyAt);
      await reconcileCopies();
      expect(calls).toContain('purge:root');
      expect(await personalRemoval(a, key)).toMatchObject({ state: 'purged' });
      // A synthetic late recommit through the shared lineage fence fails.
      await expect(
        transaction(client =>
          lifecycle.assertObjects(client, a.userId, [plannedRoot.extractionId]),
        ),
      ).rejects.toMatchObject({ code: 'FORBIDDEN_OR_NOT_FOUND' });
    } finally {
      unregisterLifecyclePort(synthetic.name);
    }
  });

  it('a failing derivative port never restores access and the reconciler finishes once it recovers', async () => {
    const a = await actor('lifecycle-port-failure');
    const uploaded = await extracted(a, 'port-failure.txt');
    registerLifecyclePort({
      name: 'synthetic-failing-port',
      label: 'Synthetic failing derivative',
      async preview() {
        return [];
      },
      async deny() {
        throw new Error('Synthetic derivative deny failure');
      },
      async purge() {
        throw new Error('Synthetic derivative purge failure');
      },
    });
    try {
      const key = command(0);
      // Journal + denial commit first; the failing port is retried later, so
      // the accepted request still returns its receipt with use denied.
      const receipt = asReceipt(await personalRemoval(a, key));
      expect(receipt.state).toBe('pending');
      await expect(getStudy(a, uploaded.rootId)).rejects.toMatchObject({
        code: 'FORBIDDEN_OR_NOT_FOUND',
      });
      await expect(reconcileCopies()).resolves.toBeUndefined();
      expect(await personalRemoval(a, key)).toMatchObject({ state: 'pending' });
      unregisterLifecyclePort('synthetic-failing-port');
      await reconcileCopies();
      expect(await personalRemoval(a, key)).toMatchObject({ state: 'purged' });
    } finally {
      unregisterLifecyclePort('synthetic-failing-port');
    }
  });

  it('root-scoped deletion keeps derivative ports root-scoped and idempotent across retried purges', async () => {
    const a = await actor('lifecycle-root-ports');
    const plannedRoot = await planned(a, 'root-ports.txt');
    const other = await extracted(a, 'root-ports-kept.txt');
    const calls: string[] = [];
    registerLifecyclePort({
      name: 'synthetic-root-port',
      label: 'Synthetic root derivative',
      async preview() {
        return [];
      },
      async deny(_client, scope) {
        calls.push(`deny:${scope.personal ? 'personal' : 'root'}`);
      },
      async purge(_client, scope) {
        calls.push(`purge:${scope.personal ? 'personal' : 'root'}`);
      },
    });
    try {
      const deletion = command(3);
      expect(await removeRoot(a, plannedRoot.rootId, deletion)).toEqual(
        await removeRoot(a, plannedRoot.rootId, deletion),
      );
      expect(calls).toContain('deny:root');
      expect(calls).not.toContain('deny:personal');
      await reconcileCopies();
      await reconcileCopies();
      expect(calls.filter(call => call === 'purge:root').length).toBeGreaterThanOrEqual(1);
      expect((await getStudy(a, other.rootId)).text).toContain('Synthetic lifecycle');
      const state = await database().query(
        'SELECT cleanup_state FROM app.lifecycle_root WHERE id=$1',
        [plannedRoot.rootId],
      );
      expect(state.rows[0].cleanup_state).toBe('purged');
    } finally {
      unregisterLifecyclePort('synthetic-root-port');
    }
  });
});
