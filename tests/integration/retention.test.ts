import { afterAll, describe, expect, it } from 'vitest';
import { readdir } from 'node:fs/promises';
import { auth } from '../../src/modules/identity-access/auth';
import { provisionSynthetic } from '../../src/modules/identity-access/provision';
import { database, closeDatabase, transaction } from '../../src/adapters/postgres/database';
import { closeQueue } from '../../src/adapters/queue';
import { upload, getStudy, savePlan, confirmPlan } from '../../src/modules/materials-setup/service';
import { createBatch, uploadSlot, acknowledge, getBatch } from '../../src/modules/materials-setup/batches';
import { runExtraction } from '../../src/modules/materials-setup/extraction';
import { getDisclosure, decide } from '../../src/modules/processing-consent/service';
import { requestCourseGeneration, submitPracticeCard, requestWhyStep } from '../../src/modules/course-generation/service';
import { runCourseGeneration, runWhyStep } from '../../src/modules/course-generation/worker';
import { dependenciesPreview, personalRemoval, reconcileCopies } from '../../src/modules/lifecycle-platform/service';
import {
  createCourseArchiveFixture,
  exportCourseArchive,
  reconcileRetention,
  registerRetentionCopy,
  requireRetentionClass,
  type RetentionClassKey,
} from '../../src/modules/lifecycle-platform/retention';
import { requestExport, downloadExport } from '../../src/modules/setup-export/service';
import { runExport } from '../../src/modules/setup-export/worker';
import { config } from '../../src/platform/config';
import type { Command, Identity, Plan } from '../../src/contracts/setup';
import type { CourseJob, WhyJob } from '../../src/contracts/courses';

// Synthetic fixtures only: every account, copy, receipt and course-controller
// record below is generated for this suite. No live AI, external calls, real
// data, or epic-5 instructor/course integration. Clock control manipulates
// timestamps with SQL UPDATEs exactly like the existing suites — never the
// system clock.

const command = (revision = 0): Command => ({ schemaVersion: 1, commandKey: crypto.randomUUID(), expectedRevision: revision });
const text = 'Synthetic retention fixture: bounded copies only. <script>inert</script>';
const stream = (value = text) => new Blob([value]).stream();
const DAY = 24 * 60 * 60 * 1000;

type RegistryRow = {
  id: string;
  kind: string;
  retention_class: string;
  state: string;
  storage_key: string | null;
  table_name: string | null;
  row_id: string | null;
  expires_at: Date;
  alerted_at: Date | null;
  purged_at: Date | null;
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

async function extracted(identity: Identity, filename: string) {
  const receipt = await upload(identity, command(), filename, stream());
  await runExtraction(receipt.operationId!, async input => input);
  return receipt;
}

async function registryRow(kind: string, rowId: string): Promise<RegistryRow> {
  const rows = await database().query<RegistryRow>(
    'SELECT * FROM app.retention_registry WHERE kind=$1 AND row_id=$2 ORDER BY created_at LIMIT 1',
    [kind, rowId],
  );
  expect(rows.rows).toHaveLength(1);
  return rows.rows[0];
}

async function storageKeys(rootId: string) {
  return (
    await database().query<{ storage_key: string }>(
      'SELECT storage_key FROM app.lifecycle_object WHERE root_id=$1 AND storage_key IS NOT NULL',
      [rootId],
    )
  ).rows.map(row => row.storage_key);
}

afterAll(async () => {
  await closeQueue();
  await closeDatabase();
});

describe('bounded retention registry and synthetic archive contract', () => {
  it('refuses unregistered derivative persistence and registers known copies idempotently without resurrecting purged rows', async () => {
    const a = await actor('retention-register');
    // The check a module calls before persisting a derivative copy: an
    // unregistered class (a future type) fails closed — it is never silently
    // omitted from deletion.
    expect(() => requireRetentionClass('course-media-future')).toThrow();
    await expect(
      transaction(client =>
        registerRetentionCopy(client, {
          kind: 'synthetic-future-media',
          retentionClass: 'course-media-future' as RetentionClassKey,
          ownerId: a.userId,
          table: 'future_media',
          rowId: 'row-1',
          expiresAt: new Date(Date.now() + DAY),
        }),
      ),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    // Known class, row locator: one idempotent inventory row per copy. The
    // copy-identity index is global and the integration database persists rows
    // between suite runs, so the locator must be unique per run — a fixed
    // literal would collide with a previous run's leftover row, whose expiry
    // the guarded upsert must not (and does not) refresh.
    const run = crypto.randomUUID();
    const kind = `synthetic-copy-${run}`;
    const rowLocator = { table: 'synthetic_store', rowId: `row-1-${run}` };
    const expires = new Date(Date.now() + DAY);
    const refreshExpires = new Date(expires.getTime() + 3600 * 1000);
    const first = await transaction(client =>
      registerRetentionCopy(client, {
        kind,
        retentionClass: 'metadata-receipt',
        ownerId: a.userId,
        ...rowLocator,
        expiresAt: expires,
      }),
    );
    const duplicate = await transaction(client =>
      registerRetentionCopy(client, {
        kind,
        retentionClass: 'metadata-receipt',
        ownerId: a.userId,
        ...rowLocator,
        expiresAt: refreshExpires,
      }),
    );
    expect(duplicate).toBe(first);
    const rows = await database().query(
      'SELECT id,expires_at,state FROM app.retention_registry WHERE kind=$1 AND table_name=$2 AND row_id=$3',
      [kind, rowLocator.table, rowLocator.rowId],
    );
    expect(rows.rowCount).toBe(1);
    // Contract: for a still-active row the stored expiry is exactly the value
    // the caller passed on the refresh — never an older or clock-derived one.
    expect((rows.rows[0] as { expires_at: Date }).expires_at.getTime()).toBe(refreshExpires.getTime());
    // Key locator variant registers the same way.
    const key = crypto.randomUUID();
    await transaction(client =>
      registerRetentionCopy(client, {
        kind: 'synthetic-copy',
        retentionClass: 'metadata-receipt',
        ownerId: a.userId,
        storageKey: key,
        expiresAt: expires,
      }),
    );
    expect(
      (
        await database().query('SELECT 1 FROM app.retention_registry WHERE kind=$1 AND storage_key=$2', [
          'synthetic-copy',
          key,
        ])
      ).rowCount,
    ).toBe(1);
    // No expiry receipt resurrects purged data: a late re-registration of a
    // purged copy leaves the receipt purged (and the copy stays gone wherever
    // a purge ran — proven end-to-end in the deletion case below).
    await database().query("UPDATE app.retention_registry SET state='purged',purged_at=clock_timestamp() WHERE id=$1", [first]);
    await transaction(client =>
      registerRetentionCopy(client, {
        kind,
        retentionClass: 'metadata-receipt',
        ownerId: a.userId,
        ...rowLocator,
        expiresAt: new Date(Date.now() + DAY),
      }),
    );
    expect(((await database().query('SELECT state FROM app.retention_registry WHERE id=$1', [first])).rows[0] as { state: string }).state).toBe('purged');
  });

  it('expires twenty-four-hour export artifacts from inventory, rows and disk, and repeats safely', async () => {
    const a = await actor('retention-export');
    const key = command();
    const receipt = await requestExport(a, key);
    await runExport(receipt.operationId!);
    const created = (
      await database().query<{ state: string; artifact_key: string | null; expires_at: Date | null }>(
        'SELECT state,artifact_key,expires_at FROM app.export_request WHERE id=$1',
        [receipt.operationId!],
      )
    ).rows[0];
    expect(created.state).toBe('ready');
    const artifactKey = created.artifact_key!;
    // The scheduler registers the active copy in the explicit inventory.
    await reconcileRetention();
    const registry = await registryRow('export-request', receipt.operationId!);
    expect(registry.retention_class).toBe('export-artifact');
    expect(registry.state).toBe('active');
    expect(registry.alerted_at).toBeNull();
    expect(Math.abs(registry.expires_at.getTime() - created.expires_at!.getTime())).toBeLessThan(5000);
    expect((await readdir(config().storagePath))).toContain(artifactKey);
    // 24h expiry boundary via SQL timestamp manipulation (never the clock).
    await database().query("UPDATE app.export_request SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1", [receipt.operationId!]);
    await database().query("UPDATE app.retention_registry SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1", [registry.id]);
    await reconcileRetention();
    const expired = (
      await database().query<{ state: string; artifact_key: string | null }>(
        'SELECT state,artifact_key FROM app.export_request WHERE id=$1',
        [receipt.operationId!],
      )
    ).rows[0];
    expect(expired.state).toBe('expired');
    expect(expired.artifact_key).toBeNull();
    const purged = await registryRow('export-request', receipt.operationId!);
    expect(purged.state).toBe('purged');
    expect(purged.purged_at).not.toBeNull();
    // Beyond-criteria: the expired-copy inventory matches the actual files —
    // the artifact key is gone from private storage, not just the row.
    expect((await readdir(config().storagePath))).not.toContain(artifactKey);
    await expect(downloadExport(a, receipt.operationId!, new AbortController().signal)).rejects.toMatchObject({
      code: 'FORBIDDEN_OR_NOT_FOUND',
    });
    // Duplicate scheduler execution is safe and creates no duplicate rows.
    await reconcileRetention();
    await reconcileRetention();
    expect(
      (
        await database().query('SELECT count(*)::int AS count FROM app.retention_registry WHERE kind=$1 AND row_id=$2', [
          'export-request',
          receipt.operationId!,
        ])
      ).rows[0],
    ).toMatchObject({ count: 1 });
  });

  it('records the seven-day deletion class, alerts overdue without restoring access and leaves enforcement to the reconciler', async () => {
    const a = await actor('retention-deletion');
    const uploaded = await extracted(a, 'retention-deletion.txt');
    const keys = await storageKeys(uploaded.rootId);
    expect(keys.length).toBeGreaterThanOrEqual(1);
    const receipt = (await personalRemoval(a, command())) as {
      requestId: string;
      state: string;
      deadlineAt: string;
    };
    expect(receipt.state).toBe('pending');
    await reconcileRetention();
    const registry = await registryRow('deletion-request', receipt.requestId);
    expect(registry.retention_class).toBe('deletion-active-purge');
    expect(registry.state).toBe('active');
    expect(registry.alerted_at).toBeNull();
    expect(Math.abs(registry.expires_at.getTime() - Date.parse(receipt.deadlineAt))).toBeLessThan(5000);
    // Past the deadline: exactly one overdue alert; status/alert visibility only
    // — the request stays pending and every read stays denied.
    await database().query("UPDATE app.deletion_request SET deadline_at=clock_timestamp()-interval '1 hour' WHERE id=$1", [receipt.requestId]);
    await database().query("UPDATE app.retention_registry SET expires_at=clock_timestamp()-interval '1 hour' WHERE id=$1", [registry.id]);
    await reconcileRetention();
    const overdue = await registryRow('deletion-request', receipt.requestId);
    expect(overdue.alerted_at).not.toBeNull();
    expect(overdue.state).toBe('active');
    expect(
      (
        await database().query<{ state: string }>('SELECT state FROM app.deletion_request WHERE id=$1', [receipt.requestId])
      ).rows[0].state,
    ).toBe('pending');
    await expect(getStudy(a, uploaded.rootId)).rejects.toMatchObject({ code: 'FORBIDDEN_OR_NOT_FOUND' });
    const alertedAt = overdue.alerted_at!;
    await reconcileRetention();
    expect((await registryRow('deletion-request', receipt.requestId)).alerted_at).toEqual(alertedAt);
    // Enforcement stays with the deletion reconciler; the registry follows.
    await reconcileCopies();
    expect(
      (
        await database().query<{ state: string }>('SELECT state FROM app.deletion_request WHERE id=$1', [receipt.requestId])
      ).rows[0].state,
    ).toBe('purged');
    await reconcileRetention();
    const done = await registryRow('deletion-request', receipt.requestId);
    expect(done.state).toBe('purged');
    expect((await readdir(config().storagePath)).some(copy => keys.includes(copy))).toBe(false);
    // Receipt cleanup after the thirty-day ceiling, and no expiry receipt
    // resurrects the purged data afterwards.
    await database().query("UPDATE app.retention_registry SET purged_at=clock_timestamp()-interval '31 days' WHERE id=$1", [done.id]);
    await reconcileRetention();
    expect((await database().query('SELECT 1 FROM app.retention_registry WHERE id=$1', [done.id])).rowCount).toBe(0);
    await expect(getStudy(a, uploaded.rootId)).rejects.toMatchObject({ code: 'FORBIDDEN_OR_NOT_FOUND' });
    expect((await readdir(config().storagePath)).some(copy => keys.includes(copy))).toBe(false);
  });

  // Epic-2 S8: the seven-day deletion deadline covers the course derivative
  // classes. The ports purge them with the reconciler (proven as a set in the
  // course-generation suite); this test pins the inventory side — the
  // registered deletion-request class records the deadline that covers the
  // derivative purge, the reconciler completes the purge inside it under
  // normal operation, and the registry follows to purged.
  it('the seven-day deletion class covers course derivatives: the registry records the deadline and the reconciler completes the purge', async () => {
    const a = await actor('retention-course-deadline');
    // Pin this test's own clearly-labeled synthetic fixture configuration:
    // suite order can leave a low-quota fixture current (ai-draft's quota
    // probe inserts a one-request limit), and this test admits several
    // dispatches under one owner.
    const maxVersion = await database().query<{ max: number }>('SELECT max(version) AS max FROM app.processor_configuration');
    await database().query(
      `INSERT INTO app.processor_configuration(id,version,provider,purpose,categories,retention_notice,eligibility,synthetic_test,daily_admission_limit)
       VALUES($1,$2,'Synthetic test spy (fixture — not compliant live AI)','Boundary test purpose','["synthetic excerpts"]'::jsonb,'Synthetic test fixture; nothing leaves this machine.','eligible',true,100)`,
      [crypto.randomUUID(), maxVersion.rows[0].max + 1],
    );
    const disclosure = await getDisclosure(a);
    await decide(a, { ...command(), configurationVersion: disclosure.configuration.version, decision: 'granted', acknowledgedTerms: true });
    // A confirmed study with the full course derivative set.
    const texts = [
      'Unit testing checks a single unit of behavior. Arrange inputs, act, assert outcomes.',
      'A test double stands in for a dependency. Coverage reports executed lines, not assertion quality.',
      'A third perspective rounds the reading out for deeper levels.',
    ];
    const slotIds = texts.map(() => crypto.randomUUID());
    const batch = await createBatch(a, { ...command(), inputs: texts.map((value, index) => ({ slotId: slotIds[index], filename: `deadline-${index}.txt`, mime: 'text/plain', byteLength: Buffer.byteLength(value) })) });
    for (const [index, value] of texts.entries()) {
      const up = await uploadSlot(a, batch.rootId, slotIds[index], command(), new Blob([value]).stream());
      await runExtraction(up.operationId!);
    }
    const preview = await getBatch(a, batch.rootId);
    const slots = preview.slots.filter(slot => slotIds.includes(slot.slotId));
    await acknowledge(a, batch.rootId, { ...command(preview.revision), selected: slots.map(slot => ({ slotId: slot.slotId, extractionId: slot.extractionId!, acknowledged: true as const })), excluded: [] });
    const acknowledged = await getBatch(a, batch.rootId);
    const derivativePlan: Plan = {
      topic: 'Unit testing', goal: 'Understand a topic', clarification: '',
      outcomes: ['Explain arrange-act-assert'],
      miniCourse: { title: 'Deadline', lessons: ['What a unit test is'], practice: 'Write one test', estimatedMinutes: 15 },
      missingExplanations: 'Sources do not cover mock frameworks. A conflicting statement about coverage appears in public documentation. One unverifiable claim exists about coverage.',
    };
    const saved = await savePlan(a, batch.rootId, { ...command(acknowledged.revision), plan: derivativePlan, extractionId: acknowledged.selection!.sources[0].extractionId, selectionId: acknowledged.selection!.id });
    const confirmed = await confirmPlan(a, batch.rootId, { ...command(saved.revision), planRevisionId: saved.planRevisionId! });
    await requestCourseGeneration(a, batch.rootId, { ...command(confirmed.revision) });
    const courseJob = (await database().query<{ id: string; root_id: string; admission_id: string }>(
      'SELECT id,root_id,admission_id FROM app.generated_course WHERE root_id=$1 ORDER BY created_at DESC LIMIT 1', [batch.rootId],
    )).rows[0];
    await runCourseGeneration({ schemaVersion: 1, requestId: courseJob.id, admissionId: courseJob.admission_id, rootId: courseJob.root_id, ownerId: a.userId, sessionId: a.sessionId } satisfies CourseJob);
    const courseId = (await database().query<{ id: string }>("SELECT id FROM app.generated_course WHERE root_id=$1 AND status='ready'", [batch.rootId])).rows[0].id;
    await submitPracticeCard(a, batch.rootId, { ...command(confirmed.revision), courseId, cardId: 'practice:0', attempted: 'deadline coverage', assisted: false });
    await requestWhyStep(a, batch.rootId, { ...command(confirmed.revision), courseId, lessonIndex: 0, depth: 1 });
    const whyJob = (await database().query<{ id: string; root_id: string; admission_id: string }>(
      'SELECT id,root_id,admission_id FROM app.why_explanation WHERE course_id=$1 AND lesson_index=0 AND depth=1', [courseId],
    )).rows[0];
    await runWhyStep({ schemaVersion: 1, requestId: whyJob.id, admissionId: whyJob.admission_id, courseId, rootId: whyJob.root_id, ownerId: a.userId, sessionId: a.sessionId, lessonIndex: 0, depth: 1 } satisfies WhyJob);
    // Whole-personal removal: the accepted request carries the seven-day
    // deadline the derivative purge rides.
    const removalKey = command();
    const receipt = (await personalRemoval(a, removalKey)) as { requestId: string; state: string; deadlineAt: string };
    expect(receipt.state).toBe('pending');
    await reconcileRetention();
    const registry = await registryRow('deletion-request', receipt.requestId);
    expect(registry.retention_class).toBe('deletion-active-purge');
    expect(registry.state).toBe('active');
    expect(Math.abs(registry.expires_at.getTime() - Date.parse(receipt.deadlineAt))).toBeLessThan(5000);
    // The reconciler completes the derivative purge under normal operation,
    // well inside the recorded deadline.
    await reconcileCopies();
    for (const [table, where] of [
      ['app.generated_course', 'owner_id=$1'],
      ['app.supplement_request', 'owner_id=$1'],
      ['app.course_item_state', 'owner_id=$1'],
      ['app.practice_attempt', 'owner_id=$1'],
      ['app.why_explanation', 'owner_id=$1'],
    ] as const) {
      expect((await database().query<{ count: number }>(`SELECT count(*)::int AS count FROM ${table} WHERE ${where}`, [a.userId])).rows[0].count).toBe(0);
    }
    expect(((await personalRemoval(a, removalKey)) as { state: string }).state).toBe('purged');
    // The registry follows once past its recorded expiry: the class member is
    // marked purged and the deadline receipt never resurrects anything.
    await database().query("UPDATE app.retention_registry SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1", [registry.id]);
    await reconcileRetention();
    expect((await registryRow('deletion-request', receipt.requestId)).state).toBe('purged');
    expect((await database().query<{ count: number }>('SELECT count(*)::int AS count FROM app.generated_course WHERE owner_id=$1', [a.userId])).rows[0].count).toBe(0);
  });

  it('expires content-free metadata and receipts at thirty days without touching real data', async () => {
    const a = await actor('retention-receipts');
    const uploaded = await extracted(a, 'retention-receipts.txt');
    await dependenciesPreview(a, uploaded.rootId, { schemaVersion: 1 });
    const preview = (
      await database().query<{ id: string }>(
        'SELECT id FROM app.deletion_preview WHERE root_id=$1 ORDER BY created_at DESC LIMIT 1',
        [uploaded.rootId],
      )
    ).rows[0];
    await reconcileRetention();
    const registry = await registryRow('deletion-preview', preview.id);
    expect(registry.retention_class).toBe('metadata-receipt');
    expect(registry.state).toBe('active');
    // Backdate past the thirty-day ceiling: the sweep deletes the journal row
    // and records the purge as a receipt.
    await database().query("UPDATE app.deletion_preview SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1", [preview.id]);
    await database().query("UPDATE app.retention_registry SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1", [registry.id]);
    await reconcileRetention();
    expect((await database().query('SELECT 1 FROM app.deletion_preview WHERE id=$1', [preview.id])).rowCount).toBe(0);
    expect((await registryRow('deletion-preview', preview.id)).state).toBe('purged');
    // The journal expiry is content-free metadata housekeeping: the study and
    // its copies are untouched.
    expect((await getStudy(a, uploaded.rootId)).text).toContain('Synthetic retention fixture');
    const liveKeys = await storageKeys(uploaded.rootId);
    expect((await readdir(config().storagePath)).some(copy => liveKeys.includes(copy))).toBe(true);
  });

  it('runs the synthetic ninety-day archive contract: notice and export precede purge, and nothing is served after it', async () => {
    const a = await actor('retention-archive');
    const fixture = await createCourseArchiveFixture(a, {
      schemaVersion: 1,
      courseController: 'synthetic-course-controller-7',
    });
    // The registry holds the course-archive copy with the ninety-day expiry.
    await reconcileRetention();
    const registry = await registryRow('course-archive', fixture.archiveId);
    expect(registry.retention_class).toBe('course-archive');
    expect(registry.state).toBe('active');
    expect(Math.abs(registry.expires_at.getTime() - Date.parse(fixture.purgeDueAt))).toBeLessThan(5000);
    const active = (
      await database().query<{ state: string; noticed_at: Date | null }>(
        'SELECT state,noticed_at FROM app.archive_contract WHERE id=$1',
        [fixture.archiveId],
      )
    ).rows[0];
    expect(active.state).toBe('active');
    expect(active.noticed_at).toBeNull();
    // Export before the recorded notice is refused.
    await expect(exportCourseArchive(a, fixture.archiveId)).rejects.toMatchObject({ code: 'CONFLICT' });
    // Notice deadline passes (60d): the notice is recorded, no purge runs.
    await database().query(
      "UPDATE app.archive_contract SET archived_at=clock_timestamp()-interval '61 days',notice_due_at=clock_timestamp()-interval '1 day',purge_due_at=clock_timestamp()+interval '29 days' WHERE id=$1",
      [fixture.archiveId],
    );
    await database().query("UPDATE app.retention_registry SET expires_at=clock_timestamp()+interval '29 days' WHERE id=$1", [registry.id]);
    await reconcileRetention();
    const noticed = (
      await database().query<{ state: string; noticed_at: Date }>(
        'SELECT state,noticed_at FROM app.archive_contract WHERE id=$1',
        [fixture.archiveId],
      )
    ).rows[0];
    expect(noticed.state).toBe('notice');
    expect(noticed.noticed_at).not.toBeNull();
    const noticedAt = noticed.noticed_at.getTime();
    // Learner-initiated export inside the window; duplicate calls replay one receipt.
    const exported = await exportCourseArchive(a, fixture.archiveId);
    expect(exported.receipt).toMatchObject({ schemaVersion: 1, synthetic: true, courseController: 'synthetic-course-controller-7' });
    expect(await exportCourseArchive(a, fixture.archiveId)).toMatchObject({ exportedAt: exported.exportedAt });
    const exportedAt = Date.parse(exported.exportedAt);
    expect(exportedAt).toBeGreaterThanOrEqual(noticedAt);
    // Purge deadline (90d): the synthetic course-controller record is deleted
    // and the receipt marks the purge strictly after the export.
    await database().query("UPDATE app.archive_contract SET purge_due_at=clock_timestamp()-interval '1 second' WHERE id=$1", [fixture.archiveId]);
    await database().query("UPDATE app.retention_registry SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1", [registry.id]);
    await reconcileRetention();
    expect((await database().query('SELECT 1 FROM app.archive_contract WHERE id=$1', [fixture.archiveId])).rowCount).toBe(0);
    const purged = await registryRow('course-archive', fixture.archiveId);
    expect(purged.state).toBe('purged');
    expect(purged.purged_at!.getTime()).toBeGreaterThanOrEqual(exportedAt);
    // After the purge nothing is served and repeated scheduler runs keep it gone.
    await expect(exportCourseArchive(a, fixture.archiveId)).rejects.toMatchObject({ code: 'FORBIDDEN_OR_NOT_FOUND' });
    await reconcileRetention();
    expect((await database().query('SELECT 1 FROM app.archive_contract WHERE id=$1', [fixture.archiveId])).rowCount).toBe(0);
    // One pass from archive to purge still records the notice before purging:
    // the purge only runs behind a recorded notice, so a purged row proves the
    // ninety-day contract order held inside that single run.
    const fast = await createCourseArchiveFixture(a, {
      schemaVersion: 1,
      courseController: 'synthetic-course-controller-8',
    });
    await database().query(
      "UPDATE app.archive_contract SET archived_at=clock_timestamp()-interval '91 days',notice_due_at=clock_timestamp()-interval '31 days',purge_due_at=clock_timestamp()-interval '1 second' WHERE id=$1",
      [fast.archiveId],
    );
    await reconcileRetention();
    expect((await database().query('SELECT 1 FROM app.archive_contract WHERE id=$1', [fast.archiveId])).rowCount).toBe(0);
    expect((await registryRow('course-archive', fast.archiveId)).state).toBe('purged');
  });

  it('keeps duplicate concurrent scheduler executions safe', async () => {
    const a = await actor('retention-duplicate');
    const uploaded = await extracted(a, 'retention-duplicate.txt');
    await dependenciesPreview(a, uploaded.rootId, { schemaVersion: 1 });
    await Promise.all([reconcileRetention(), reconcileRetention(), reconcileRetention()]);
    const rows = await database().query<{ kind: string; count: number }>(
      'SELECT kind,count(*)::int AS count FROM app.retention_registry WHERE owner_id=$1 GROUP BY kind',
      [a.userId],
    );
    const counts = new Map(rows.rows.map(row => [row.kind, row.count]));
    expect(counts.get('deletion-preview')).toBe(1);
    expect(counts.get('deletion-request')).toBeUndefined();
    expect(counts.get('export-request')).toBeUndefined();
    await expect(reconcileRetention()).resolves.toBeUndefined();
  });
});
