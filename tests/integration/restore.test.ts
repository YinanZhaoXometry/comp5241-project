import { afterAll, describe, expect, it } from 'vitest';
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { Client, Pool } from 'pg';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { BACKUP_DIR, BACKUP_LOCK, createBackup, purgeExpiredBackups } from '../../scripts/backup';
import {
  checkSchemaCompatibility,
  invalidateAllSessions,
  loadBackup,
  restoreBackup,
  restoreDump,
  replayJournalInto,
  type LoadedBackup,
} from '../../scripts/restore';
import {
  PROTECTIVE_JOURNAL_FILE,
  PROTECTIVE_JOURNAL_STATE,
  deliverPendingJournalEvents,
  journalConsentWithdrawal,
  journalDeletion,
  journalDigest,
  journalFixtureEvent,
  journalSessionRevocation,
  pruneProtectiveJournalFile,
  protectiveEventFixture,
  verifyJournalCompleteness,
  type JournalExportRow,
} from '../../src/adapters/protected-journal';
import { provisionSynthetic } from '../../src/modules/identity-access/provision';
import { auth } from '../../src/modules/identity-access/auth';
import { decide, withdraw } from '../../src/modules/processing-consent/service';
import { upload, getStudy } from '../../src/modules/materials-setup/service';
import { runExtraction } from '../../src/modules/materials-setup/extraction';
import { personalRemoval } from '../../src/modules/lifecycle-platform/service';
import { objectsActive } from '../../src/modules/lifecycle-platform/repository';
import { closeDatabase, database, transaction } from '../../src/adapters/postgres/database';
import { closeQueue } from '../../src/adapters/queue';
import type { Command, Identity } from '../../src/contracts/setup';

// LOCAL SYNTHETIC coverage of S13 (delivery-checks): one encrypted snapshot of
// this workspace's isolated loopback database plus the independently stored
// protective journal, restored into a scratch database CREATED BY THIS TEST,
// with the beyond-criteria proof that direct access, dispatch-shaped egress
// and the snapshot's queued work are all still denied around the
// restore → invalidate-sessions → replay window. Every account, document and
// event below is synthetic; nothing leaves this machine.
//
// The journal appends use exactly the adapter functions the integrator hook
// snippets call inside the S3/S9 transactions; here they run in a follow-up
// transaction because the merged module functions own their transactions —
// the atomic in-transaction placement is what those snippets deliver.
// This suite exercises the real pg_dump/openssl/tar toolchain and therefore
// only runs where the .local toolchain exists (integration), never on a
// package branch.

const command = (): Command => ({ schemaVersion: 1, commandKey: crypto.randomUUID(), expectedRevision: 0 });
const withdrawalHash = createHash('sha256').update(JSON.stringify({ withdrawal: true })).digest('hex');
const text = 'Synthetic restore-fixture source: isolated backup coverage.';
const stream = (value = text) => new Blob([value]).stream();

let loaded: LoadedBackup | undefined;

async function actor(label: string) {
  const credentials = await provisionSynthetic(label, 'learner');
  const response = await auth().api.signInEmail({
    body: { email: credentials.email, password: credentials.password },
    asResponse: true,
  });
  const body = await response.json();
  const session = await database().query<{ id: string }>('SELECT id FROM auth.session WHERE token=$1', [body.token]);
  return { userId: credentials.userId, sessionId: session.rows[0].id } satisfies Identity;
}

// This suite seeds its OWN eligible synthetic configuration version so the
// grant never depends on another suite's leftover disclosure state. Synthetic
// test fixture only — never provider eligibility evidence.
async function eligibleConfiguration() {
  const max = await database().query<{ max: number | null }>('SELECT max(version) AS max FROM app.processor_configuration');
  const version = (max.rows[0].max ?? 0) + 1;
  const id = crypto.randomUUID();
  await database().query(
    `INSERT INTO app.processor_configuration(id,version,provider,purpose,categories,retention_notice,eligibility,synthetic_test,daily_admission_limit)
     VALUES($1,$2,'Synthetic restore-test configuration (fixture — not compliant live AI)','S13 restore fixture','["synthetic excerpts"]'::jsonb,'Synthetic test fixture; nothing leaves this machine.','eligible',true,10)`,
    [id, version],
  );
  return { id, version };
}

async function admin() {
  const client = new Client({
    host: resolve('.local/pg-socket'),
    port: 55432,
    user: 'tracer_bootstrap',
    database: 'postgres',
  });
  await client.connect();
  return client;
}

async function createScratch(prefix: string) {
  const name = `${prefix}_${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`;
  const settings = JSON.parse(await readFile('.local/migration-config.json', 'utf8')) as { databaseUrl: string };
  const url = new URL(settings.databaseUrl);
  url.pathname = `/${name}`;
  const client = await admin();
  try {
    await client.query(`CREATE DATABASE ${name} OWNER ${url.username}`);
  } finally {
    await client.end();
  }
  return { name, url: url.href };
}

async function dropScratch(name: string) {
  const client = await admin();
  try {
    await client.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  } finally {
    await client.end();
  }
}

// Shared scenario state; its run sequentially inside one describe.
const state: {
  a?: Identity;
  b?: Identity;
  configuration?: { id: string; version: number };
  aRoot?: string;
  aObject?: string;
  aOperation?: string;
  bRoot?: string;
  bObject?: string;
  backupId?: string;
  tamperedId?: string;
  targetName?: string;
} = {};

// Suite-start wall clock for the residue sweep below: it only ever removes
// artifacts created DURING this run, so an operator's real backup inventory
// (anything registered before this suite started) is never touched.
const RUN_STARTED_AT = new Date();

// Test-hygiene sweep (epic-2 S9, 2026-10-27): a failing run never reaches the
// expiry case below, a createBackup can die between registrations (its dump
// row stays active while nothing reclaims the artifacts), and a hard kill in
// the plaintext staging window leaves unencrypted residue createBackup's own
// finally cannot clean. The sweep reclaims THIS run's residue in two steps:
// (1) the run's tracked snapshots are forced through the product purge path
// (backdate their rows, purge), and (2) artifacts created during this run are
// removed unless a registry row REGISTERED BEFORE this run claims them —
// pre-run rows are the operator's real inventory and always survive. The whole
// sweep holds the same advisory lock the product backup/restore path
// serializes on, so a concurrent operator backup's not-yet-registered
// artifacts can never be swept from under it. Never weakens the real-failure
// paths above — it runs only after every assertion — and a sweep failure must
// never mask the suite's own result, so it is honestly logged and swallowed.
// (Interleaved restore-suite PROCESSES are not serialized by anything here —
// the same documented cross-process fixture-race caveat as the rest of the
// integration suites applies.)
async function sweepRunResidue() {
  try {
    const client = await database().connect();
    try {
      await client.query('SELECT pg_advisory_lock($1)', [BACKUP_LOCK]);
      try {
        const tracked = [state.backupId, state.tamperedId].filter((id): id is string => !!id);
        if (tracked.length) {
          await client.query(
            `UPDATE app.retention_registry SET expires_at=clock_timestamp()-interval '1 second'
             WHERE kind IN ('protective-backup-dump','protective-backup-files','protective-backup-journal')
               AND state='active' AND row_id=ANY($1::text[])`,
            [tracked],
          );
          await purgeExpiredBackups(client);
        }
        const preRun = new Set(
          (
            await client.query<{ key: string; created_at: Date }>(
              'SELECT storage_key AS key, created_at FROM app.retention_registry',
            )
          ).rows
            .filter(row => row.created_at < RUN_STARTED_AT)
            .map(row => row.key),
        );
        let entries: string[] = [];
        try {
          entries = await readdir(BACKUP_DIR);
        } catch {
          entries = [];
        }
        for (const name of entries) {
          // Encrypted artifacts and manifests, plus the PLAINTEXT staging
          // names (.dump/.tar/.jsonl) an uncatchable kill can leave behind.
          const id = name.replace(/\.(?:dump|tar|jsonl)(?:\.enc)?$|\.json$/u, '');
          if (id === name) continue; // not a backup artifact
          const path = resolve(BACKUP_DIR, name);
          try {
            const info = await stat(path);
            if (info.mtime >= RUN_STARTED_AT && !preRun.has(id)) await rm(path, { force: true });
          } catch {
            /* vanished concurrently; nothing to sweep */
          }
        }
      } finally {
        await client.query('SELECT pg_advisory_unlock($1)', [BACKUP_LOCK]).catch(() => undefined);
      }
    } finally {
      client.release();
    }
  } catch (error) {
    console.error(JSON.stringify({ event: 'restore-suite-residue-sweep-pending', error: String(error) }));
  }
}

afterAll(async () => {
  try {
    if (loaded) await rm(loaded.stagingDir, { recursive: true, force: true });
    if (state.targetName) await dropScratch(state.targetName);
  } finally {
    // The residue sweep must run even when an earlier cleanup step throws.
    await sweepRunResidue();
    await closeQueue();
    await closeDatabase();
  }
});

describe('isolated backup and protective restore', () => {
  it('appends journal events atomically with the protective transition (no false success)', async () => {
    state.a = await actor('restore-owner-a');
    state.b = await actor('restore-owner-b');
    state.configuration = await eligibleConfiguration();
    await decide(state.a, {
      schemaVersion: 1,
      commandKey: crypto.randomUUID(),
      expectedRevision: 0,
      configurationVersion: state.configuration.version,
      decision: 'granted',
      acknowledgedTerms: true,
    });
    const receipt = {
      commandKey: crypto.randomUUID(),
      configurationId: state.configuration.id,
      disclosureVersion: state.configuration.version,
      requestHash: withdrawalHash,
    };
    let keptId = '';
    // A valid append followed by a malformed append share one transaction:
    // the failure must roll the VALID append back too — the journal never
    // records half of a protective transition, and the caller never sees a
    // success for a transition that is not durably journaled.
    await expect(
      transaction(async client => {
        const kept = await journalConsentWithdrawal(client, {
          ownerId: state.a!.userId,
          sessionId: state.a!.sessionId,
          receipt,
        });
        keptId = kept.id;
        await journalConsentWithdrawal(client, {
          ownerId: state.a!.userId,
          sessionId: state.a!.sessionId,
          receipt: { ...receipt, requestHash: 'not-a-request-hash' },
        });
      }),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    expect((await database().query('SELECT 1 FROM app.protective_journal WHERE id=$1', [keptId])).rowCount).toBe(0);
    // Independent-store delivery: one durable fixture event (recorded no-op on
    // replay) as the delivery vehicle; the store is established, a delivery
    // whose store path is unwritable fails without claiming success (the
    // event stays durable in the table), and a retry converges.
    await transaction(client =>
      journalFixtureEvent(client, protectiveEventFixture('enrollment-revocation', state.a!.userId)),
    );
    await transaction(client => deliverPendingJournalEvents(client));
    await expect(stat(PROTECTIVE_JOURNAL_STATE)).resolves.toBeTruthy();
    await rm(PROTECTIVE_JOURNAL_FILE);
    await rm(PROTECTIVE_JOURNAL_STATE);
    await mkdir(PROTECTIVE_JOURNAL_STATE); // unwritable store path
    await expect(transaction(client => deliverPendingJournalEvents(client))).rejects.toThrow();
    await rm(PROTECTIVE_JOURNAL_STATE, { recursive: true });
    await transaction(client => deliverPendingJournalEvents(client));
    await expect(stat(PROTECTIVE_JOURNAL_STATE)).resolves.toBeTruthy();
  });

  it('creates one encrypted snapshot with a registered 30-day inventory and an independent journal copy', async () => {
    // Owner A keeps a QUEUED extraction job at snapshot time (upload enqueues;
    // this suite never runs it before the snapshot) — the beyond-criteria's
    // queued-work fixture. Owner B keeps unrelated material that must survive.
    const uploaded = await upload(state.a!, command(), 'restore-queued.txt', stream());
    state.aRoot = uploaded.rootId;
    state.aOperation = uploaded.operationId!;
    state.aObject = (
      await database().query<{ id: string }>(
        "SELECT id FROM app.lifecycle_object WHERE root_id=$1 AND kind='original'",
        [state.aRoot],
      )
    ).rows[0].id;
    const bReceipt = await upload(state.b!, command(), 'restore-untouched.txt', stream());
    state.bRoot = bReceipt.rootId;
    state.bObject = (
      await database().query<{ id: string }>(
        "SELECT id FROM app.lifecycle_object WHERE root_id=$1 AND kind='original'",
        [state.bRoot],
      )
    ).rows[0].id;

    const backup = await createBackup();
    state.backupId = backup.backupId;
    // The three physical artifacts are registered under P7's S13 classes with
    // the thirty-day expiry; the manifest itself stays content-free.
    const rows = await database().query<{ kind: string; retention_class: string; state: string; expires_at: Date }>(
      "SELECT kind,retention_class,state,expires_at FROM app.retention_registry WHERE row_id=$1 ORDER BY kind",
      [backup.backupId],
    );
    expect(rows.rows.map(row => row.kind).sort()).toEqual([
      'protective-backup-dump',
      'protective-backup-files',
      'protective-backup-journal',
    ]);
    for (const row of rows.rows) {
      expect(['backup-snapshot', 'protective-journal']).toContain(row.retention_class);
      expect(row.state).toBe('active');
      expect(row.expires_at.getTime()).toBeGreaterThan(Date.now() + 29 * 24 * 3600 * 1000);
    }
    const manifest = JSON.parse(await readFile(resolve(BACKUP_DIR, `${backup.backupId}.json`), 'utf8')) as {
      journal: { cut: { cut: number; count: number; digest: string } };
    };
    expect(manifest.journal.cut.count).toBe(backup.journalCut.count);
    expect((await stat(resolve(BACKUP_DIR, `${backup.backupId}.dump.enc`))).size).toBeGreaterThan(0);
    // Explicit budget in this suite's established pattern (the two restore
    // cases below already carry 120000): the physical snapshot toolchain
    // (pg_dump + tar of every accumulated private object + PBKDF2 encrypt)
    // scales with the LOCAL synthetic state this workspace has accumulated
    // across months of runs, which has outgrown vitest's 30 s default. Every
    // assertion still runs to completion — nothing is skipped or weakened.
  }, 120000);

  it('records post-snapshot deletion, withdrawal and revocation in the protective journal', async () => {
    // AFTER the snapshot: withdraw consent, delete everything personal,
    // revoke the session. The snapshot predates all three, so a plain restore
    // would resurrect granted consent, live roots and a valid session — the
    // journal (delivered to the independent store) is what reconciles them.
    const withdrawalCommand = command();
    const withdrawn = await withdraw(state.a!, withdrawalCommand);
    expect(withdrawn.decision).toBe('withdrawn');
    await transaction(async client => {
      await journalConsentWithdrawal(client, {
        ownerId: state.a!.userId,
        sessionId: state.a!.sessionId,
        receipt: {
          commandKey: withdrawalCommand.commandKey,
          configurationId: state.configuration!.id,
          disclosureVersion: state.configuration!.version,
          requestHash: withdrawalHash,
        },
      });
      await deliverPendingJournalEvents(client);
    });
    const roots = (
      await database().query<{ id: string }>('SELECT id FROM app.lifecycle_root WHERE owner_id=$1', [state.a!.userId])
    ).rows.map(row => row.id);
    const objects = (
      await database().query<{ id: string }>('SELECT id FROM app.lifecycle_object WHERE root_id=ANY($1::uuid[])', [roots])
    ).rows.map(row => row.id);
    const receipt = (await personalRemoval(state.a!, command())) as { state: string };
    expect(receipt.state).toBe('pending');
    await transaction(async client => {
      await journalDeletion(client, {
        ownerId: state.a!.userId,
        rootIds: roots,
        objectIds: objects,
        receipt: { scope: 'personal' },
      });
      // Fixture type without a live producer module: appended through the
      // explicit adapter fixture, never pretending a feature exists.
      await journalFixtureEvent(client, protectiveEventFixture('publication-withdrawal', state.a!.userId));
      await deliverPendingJournalEvents(client);
    });
    // Session revocation: the auth fence trigger bumps A's epoch as a side
    // effect, revoking every queued job's authorization basis. The event is
    // journaled so a post-snapshot restore re-applies it (no live producer
    // module exists for revocation yet).
    await database().query('DELETE FROM auth.session WHERE id=$1', [state.a!.sessionId]);
    await transaction(async client => {
      await journalSessionRevocation(client, {
        ownerId: state.a!.userId,
        sessionIds: [state.a!.sessionId],
        receipt: { scope: 'sessions', reason: 'operator' },
      });
      await deliverPendingJournalEvents(client);
    });
    // Direct access denial for the revoked owner.
    await expect(getStudy(state.a!, state.aRoot!)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    // Queued-work denial under the ACTUAL product contract (recorded in the
    // ticket Plan Change Log): runExtraction checks session existence first
    // (authorize) and the epoch second, but a session/epoch denial is
    // deliberately swallowed into an orderly terminal operation state
    // (failedOperation records it; the error is not rethrown), so the call
    // RESOLVES instead of rejecting. Give the denial a fair witness: a
    // dedicated owner whose queued operation was NOT canceled by the personal
    // deletion, whose session is then revoked. The job must terminate without
    // ever producing an extraction.
    const queued = await actor('restore-queued-c');
    const queuedUpload = await upload(queued, command(), 'restore-queued-c.txt', stream());
    await database().query('DELETE FROM auth.session WHERE id=$1', [queued.sessionId]);
    await expect(runExtraction(queuedUpload.operationId!)).resolves.toBeUndefined();
    const queuedOperation = await database().query<{ state: string }>(
      'SELECT state FROM app.operation WHERE id=$1',
      [queuedUpload.operationId!],
    );
    expect(queuedOperation.rows[0].state).toBe('canceled');
    expect(
      (await database().query('SELECT 1 FROM app.extraction_revision WHERE root_id=$1', [queuedUpload.rootId]))
        .rowCount,
    ).toBe(0);
  });

  it('restores into a scratch database and denies access, dispatch and queued work around reconciliation', async () => {
    const target = await createScratch('restore_tgt');
    state.targetName = target.name;
    loaded = await loadBackup(state.backupId!, { restoreFiles: false });
    expect(loaded.journal.source).toBe('independent');
    // The journal replay set is the verified union of the independent store
    // and the snapshot's embedded cut. It intentionally also carries
    // unrelated live events (other suites' merged S3/S9 hooks deliver into
    // the same store, and stale segments from earlier runs may head it):
    // replay's owner-presence guard skips those with an honest count, so
    // every expectation below is a ≥ bound, never an exact total.
    const journalRows = loaded.journal.rows;
    expect(journalRows.length).toBeGreaterThanOrEqual(4);
    await restoreDump(loaded.dumpPath, target.url);
    const targetPool = new Pool({ connectionString: target.url, max: 2, options: '-c search_path=app,auth,public' });
    const extras = await checkSchemaCompatibility(targetPool);
    expect(extras).toBeGreaterThanOrEqual(0);
    // Queue-schema overlap: the snapshot's queued extraction job came back
    // intact, so the restored queue is the same durable job store.
    const job = await targetPool.query<{ data: { operationId?: string } }>('SELECT data FROM queue.job WHERE id=$1', [
      state.aOperation!,
    ]);
    expect(job.rows[0]?.data).toMatchObject({ operationId: state.aOperation!, ownerId: state.a!.userId });

    // Ordered procedure position: restored, sessions invalidated, journal NOT
    // yet replayed. The pre-deletion snapshot resurrected A's root, A's
    // granted consent and A's valid-looking session — exactly why every
    // attempt in this window must stay denied by the fences.
    const invalidated = await invalidateAllSessions(targetPool);
    expect(invalidated).toBeGreaterThanOrEqual(2); // A's and B's snapshot sessions
    const client = await targetPool.connect();
    try {
      // Direct access: the restored session is dead — authorize() denies it.
      const session = await client.query('SELECT 1 FROM auth.session WHERE id=$1 AND "expiresAt">clock_timestamp()', [
        state.a!.sessionId,
      ]);
      expect(session.rowCount).toBe(0);
      const resurrectedRoot = await client.query<{ deleted_at: Date | null }>(
        'SELECT deleted_at FROM app.lifecycle_root WHERE id=$1',
        [state.aRoot!],
      );
      expect(resurrectedRoot.rows[0].deleted_at).toBeNull();
      // The dispatch/egress fence (objectsActive, as admitDispatch consults
      // it) still sees the resurrected objects BEFORE replay — replay below
      // is what re-denies them; nothing may serve traffic in between.
      expect(await objectsActive(client, state.a!.userId, [state.aObject!])).toBe(true);
      const granted = await client.query<{ decision: string }>(
        'SELECT decision FROM app.processing_decision WHERE owner_id=$1 ORDER BY decided_at DESC LIMIT 1',
        [state.a!.userId],
      );
      expect(granted.rows[0]?.decision).toBe('granted');
    } finally {
      client.release();
    }

    // Reconciliation: import the independent copy and replay, still before
    // any traffic, reminders, queue dispatch or egress. Replay only denies.
    const replayed = await replayJournalInto(targetPool, journalRows);
    expect(replayed.replay.fixtureNoOp).toBeGreaterThanOrEqual(1);
    const after = await targetPool.connect();
    try {
      const decision = await after.query<{ decision: string }>(
        'SELECT decision FROM app.processing_decision WHERE owner_id=$1 ORDER BY decided_at DESC LIMIT 1',
        [state.a!.userId],
      );
      expect(decision.rows[0].decision).toBe('withdrawn');
      const root = await after.query<{ deleted_at: Date | null; cleanup_state: string }>(
        'SELECT deleted_at,cleanup_state FROM app.lifecycle_root WHERE id=$1',
        [state.aRoot!],
      );
      expect(root.rows[0].deleted_at).not.toBeNull();
      expect(root.rows[0].cleanup_state).toBe('pending'); // worker start purges the bytes
      const objects = await after.query<{ invalidated_at: Date | null }>(
        'SELECT invalidated_at FROM app.lifecycle_object WHERE root_id=$1',
        [state.aRoot!],
      );
      for (const row of objects.rows) expect(row.invalidated_at).not.toBeNull();
      expect(await objectsActive(after, state.a!.userId, [state.aObject!])).toBe(false);
      const operation = await after.query<{ state: string }>('SELECT state FROM app.operation WHERE id=$1', [
        state.aOperation!,
      ]);
      expect(operation.rows[0].state).toBe('canceled');
      // Unrelated owner B survives the restore with live objects and fences.
      const bRoot = await after.query<{ deleted_at: Date | null }>(
        'SELECT deleted_at FROM app.lifecycle_root WHERE id=$1',
        [state.bRoot!],
      );
      expect(bRoot.rows[0].deleted_at).toBeNull();
      expect(await objectsActive(after, state.b!.userId, [state.bObject!])).toBe(true);
      const sessions = await after.query<{ count: string }>(
        'SELECT count(*) AS count FROM auth.session WHERE "expiresAt">clock_timestamp()',
      );
      expect(sessions.rows[0].count).toBe('0');
    } finally {
      after.release();
      await targetPool.end();
    }
    // Full ordered procedure into a second scratch target: the timed operator
    // path (RTO evidence recorded honestly; no production claim attached).
    const timed = await createScratch('restore_timed');
    try {
      const result = await restoreBackup({ backupId: state.backupId!, targetDatabaseUrl: timed.url, restoreFiles: false });
      expect(result.replay.events).toBe(journalRows.length);
      expect(result.rtoBudgetOk).toBe(true);
      expect(result.timings.map(step => step.step)).toContain('journal-replay');
    } finally {
      await dropScratch(timed.name);
    }
  }, 120000);

  it('fails closed when the journal cannot be proven complete', async () => {
    const rows: JournalExportRow[] = loaded!.journal.rows;
    const cut = { cut: rows[rows.length - 1].seq, count: rows.length, digest: journalDigest(rows) };
    // Truncated export: count/digest/last-seq all mismatch.
    expect(() => verifyJournalCompleteness(rows.slice(0, -1), cut)).toThrow();
    // Mutated export: same shape, different content.
    const mutated = rows.map((row, index) => (index === 0 ? { ...row, sessionIds: [crypto.randomUUID()] } : row));
    expect(() => verifyJournalCompleteness(mutated, cut)).toThrow();
    // A restore whose journal ciphertext was tampered with aborts BEFORE any
    // schema is restored: the target database stays empty.
    const tampered = await createBackup();
    state.tamperedId = tampered.backupId; // swept by afterAll if a later step fails
    const journalKey = (
      await database().query<{ storage_key: string }>(
        "SELECT storage_key FROM app.retention_registry WHERE kind='protective-backup-journal' AND row_id=$1",
        [tampered.backupId],
      )
    ).rows[0].storage_key;
    const journalPath = resolve(BACKUP_DIR, `${journalKey}.jsonl.enc`);
    const encrypted = await readFile(journalPath);
    const corrupted = Buffer.concat([encrypted, Buffer.from([encrypted[0] ^ 0xff])]);
    await writeFile(journalPath, corrupted);
    const doomed = await createScratch('restore_doomed');
    try {
      await expect(
        restoreBackup({ backupId: tampered.backupId, targetDatabaseUrl: doomed.url, restoreFiles: false }),
      ).rejects.toThrow();
      const probe = new Pool({ connectionString: doomed.url, max: 1 });
      const tables = await probe.query<{ count: string }>(
        "SELECT count(*) AS count FROM information_schema.tables WHERE table_schema='app'",
      );
      await probe.end();
      expect(tables.rows[0].count).toBe('0');
    } finally {
      await dropScratch(doomed.name);
    }
  }, 120000);

  it('expires thirty-day-old snapshots from inventory, registry and disk', async () => {
    // The independent journal store prunes content-free segments past the
    // AD-4 ceiling but is never deleted outright: it is the continuation the
    // next restore needs, and a prune with nothing old is a no-op.
    await expect(pruneProtectiveJournalFile(new Date(Date.now() - 1000))).resolves.toBe(0);
    // An OPERATOR-registered snapshot outside this suite (future expiry, its
    // own bytes on disk) must survive everything below: the backdate is
    // bounded to this suite's own snapshots, and the purge may only take
    // what is actually due.
    const operatorKey = crypto.randomUUID();
    await writeFile(resolve(BACKUP_DIR, `${operatorKey}.dump.enc`), 'synthetic operator-inventory decoy');
    const operatorRow = await database().query<{ id: string }>(
      `INSERT INTO app.retention_registry(id,owner_id,kind,retention_class,storage_key,table_name,row_id,expires_at)
       VALUES($1,null,'protective-backup-dump','backup-snapshot',$2,'backup_manifest',$3,clock_timestamp()+interval '30 days')
       RETURNING id`,
      [crypto.randomUUID(), operatorKey, crypto.randomUUID()],
    );
    // Backdate THIS suite's registered snapshots past the class ceiling, then
    // let the maintenance purge prove expiry physically: files deleted, rows
    // purged, manifests removed, and a repeat purge a safe no-op.
    await database().query(
      `UPDATE app.retention_registry SET expires_at=clock_timestamp()-interval '1 second'
       WHERE kind IN ('protective-backup-dump','protective-backup-files','protective-backup-journal')
         AND state='active' AND row_id=ANY($1::text[])`,
      [[state.backupId!, state.tamperedId!]],
    );
    // The suite's own artifacts exist as real bytes right before the purge,
    // so the ENOENT checks below are non-vacuous per artifact kind.
    const suffixOf: Record<string, string> = {
      'protective-backup-dump': '.dump.enc',
      'protective-backup-files': '.tar.enc',
      'protective-backup-journal': '.jsonl.enc',
    };
    const own = (
      await database().query<{ kind: string; storage_key: string }>(
        'SELECT kind,storage_key FROM app.retention_registry WHERE row_id=$1',
        [state.backupId!],
      )
    ).rows;
    expect(own).toHaveLength(3);
    for (const row of own) {
      await expect(stat(resolve(BACKUP_DIR, `${row.storage_key}${suffixOf[row.kind]}`))).resolves.toBeTruthy();
    }
    let purged: string[] = [];
    await transaction(async client => {
      purged = await purgeExpiredBackups(client);
    });
    expect(purged).toContain(state.backupId!);
    for (const row of own) {
      await expect(stat(resolve(BACKUP_DIR, `${row.storage_key}${suffixOf[row.kind]}`))).rejects.toMatchObject({ code: 'ENOENT' });
    }
    await expect(stat(resolve(BACKUP_DIR, `${state.backupId!}.json`))).rejects.toMatchObject({ code: 'ENOENT' });
    // The operator's row and bytes are untouched by the bounded purge.
    const operator = await database().query<{ state: string }>(
      'SELECT state FROM app.retention_registry WHERE id=$1',
      [operatorRow.rows[0].id],
    );
    expect(operator.rows[0].state).toBe('active');
    await expect(stat(resolve(BACKUP_DIR, `${operatorKey}.dump.enc`))).resolves.toBeTruthy();
    await transaction(async client => {
      await expect(purgeExpiredBackups(client)).resolves.toEqual([]);
    });
    // Remove this test's own decoy (best-effort; the afterAll sweep's
    // run-window rule also reclaims the file if this cleanup is not reached).
    await rm(resolve(BACKUP_DIR, `${operatorKey}.dump.enc`), { force: true });
    await database().query('DELETE FROM app.retention_registry WHERE id=$1', [operatorRow.rows[0].id]);
  });
});
