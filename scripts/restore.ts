// S13 protective restore: ordered, fail-closed recovery of one local encrypted
// backup produced by scripts/backup.ts. The granular exported steps exist so
// tests can observe denials in the restore→invalidate→replay window; the
// operator entry point is restoreBackup (or the CLI below).
//
// Procedure order (each step aborts the restore on failure, before anything
// later runs):
//   1. decrypt dump/files/journal and verify every manifest digest;
//   2. PROVE journal completeness (contiguous 1..cut, count, canonical digest,
//      pinned event shapes) BEFORE any schema is restored — an incomplete
//      journal fails closed and NOTHING is restored;
//   3. pg_restore the verified dump into an EMPTY target database (never the
//      live one; the operator swap is a documented manual step);
//   4. ordered auth → application → queue schema compatibility: a reference
//      database is migrated with scripts/migrate.ts (S1's migration owner) and
//      every table/column the current code needs must exist in the restored
//      schema, else abort;
//   5. invalidate ALL restored sessions (the auth fence trigger bumps every
//      principal epoch, which also denies queued jobs);
//   6. import the journal copy and replay it (deletion/withdrawal/revocation
//      reconcile) — still before any traffic, reminders, queue dispatch or
//      egress; replay only ever denies, never grants.
// A stale snapshot (older than the 24h RPO bound) is refused unless the caller
// passes allowStaleSnapshot — an explicit revalidation, never a default.
//
// LOCAL SYNTHETIC SCOPE: this procedure proves the local mechanism only. It
// cannot certify managed-host retention or a production RTO (delivery-checks
// S13/F5/F6); timings recorded here are local synthetic evidence.

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { constants, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { Client, Pool, type PoolClient } from 'pg';
import { migrate } from './migrate';
import { BACKUP_DIR, KEY_FILE, RPO_HOURS, pgBin, schemaInventory } from './backup';
import { config } from '../src/platform/config';
import {
  importJournalRows,
  journalSessionRevocation,
  replayJournal,
  resolveJournalInput,
  verifyJournalCompleteness,
  type JournalExportRow,
  type JournalInput,
  type ReplaySummary,
} from '../src/adapters/protected-journal';

export const RTO_HOURS = 8;
const CIPHER_ARGS = ['-aes-256-cbc', '-salt', '-pbkdf2', '-iter', '600000'];
const OPENSSL = process.env.BACKUP_OPENSSL ?? '/usr/bin/openssl';

export type RestoreOptions = {
  backupId: string;
  /** Loopback URL of an EMPTY target database (never the live one). */
  targetDatabaseUrl: string;
  /** Explicit revalidation for a snapshot older than the 24h RPO bound. */
  allowStaleSnapshot?: boolean;
  /** Restore the private-file snapshot into local private storage (default true). */
  restoreFiles?: boolean;
};

export type RestoreResult = {
  backupId: string;
  targetName: string;
  sessionsInvalidated: number;
  journalImported: number;
  replay: ReplaySummary;
  fileCopies: number;
  extras: number;
  timings: { step: string; ms: number }[];
  rtoMinutes: number;
  rtoBudgetOk: boolean;
};

export type BackupManifest = {
  schemaVersion: 1;
  backupId: string;
  createdAt: string;
  database: { host: string; port: string; name: string };
  dump: { file: string; sha256: string; bytes: number };
  files: { file: string; sha256: string; bytes: number; count: number };
  journal: { file: string; sha256: string; bytes: number; cut: { cut: number; count: number; digest: string } };
};

export type LoadedBackup = {
  manifest: BackupManifest;
  journal: JournalInput;
  dumpPath: string;
  filesTarPath: string | null;
  stagingDir: string;
};

function ownerUrl() {
  const data = JSON.parse(readFileSync(resolve('.local/migration-config.json'), 'utf8')) as {
    databaseUrl: string;
  };
  const url = new URL(data.databaseUrl);
  if (url.hostname !== '127.0.0.1') throw new Error('Restore requires the local loopback cluster');
  return url;
}

function targetSettings(targetDatabaseUrl: string) {
  const url = new URL(targetDatabaseUrl);
  if (url.hostname !== '127.0.0.1') throw new Error('Restore target must be loopback');
  if (!/^[a-z0-9_]+$/u.test(url.pathname.slice(1))) throw new Error('Invalid target database name');
  return { url, name: url.pathname.slice(1) };
}

async function decrypt(encPath: string, plainPath: string): Promise<Buffer> {
  execFileSync(OPENSSL, ['enc', '-d', ...CIPHER_ARGS, '-in', encPath, '-out', plainPath, '-pass', `file:${KEY_FILE}`]);
  return readFile(plainPath);
}

function expectDigest(plain: Buffer, expected: { sha256: string; bytes: number }, what: string) {
  const digest = createHash('sha256').update(plain).digest('hex');
  if (digest !== expected.sha256 || plain.length !== expected.bytes)
    throw new Error(`${what} failed integrity verification`);
}

// Local admin handle for scratch reference database management only.
function admin() {
  return new Client({ host: resolve('.local/pg-socket'), port: 55432, user: 'tracer_bootstrap', database: 'postgres' });
}

// Steps 1+2: decrypt, integrity-verify against the manifest and prove journal
// completeness. Nothing has been restored when this fails.
export async function loadBackup(
  backupId: string,
  options: { allowStaleSnapshot?: boolean; restoreFiles?: boolean; allowEmbeddedJournalFallback?: boolean } = {},
): Promise<LoadedBackup> {
  config();
  if (!/^[0-9a-f-]{36}$/u.test(backupId)) throw new Error('Invalid backup id');
  const manifest = JSON.parse(await readFile(resolve(BACKUP_DIR, `${backupId}.json`), 'utf8')) as BackupManifest;
  if (manifest.schemaVersion !== 1 || manifest.backupId !== backupId) throw new Error('Unsupported manifest');
  const ageHours = (Date.now() - Date.parse(manifest.createdAt)) / 3600000;
  if (ageHours > RPO_HOURS && !options.allowStaleSnapshot) {
    console.error(JSON.stringify({ event: 'restore-stale-snapshot-refused', ageHours: Math.round(ageHours) }));
    throw new Error('Snapshot exceeds the 24h RPO bound; retake or pass explicit revalidation');
  }
  const stagingDir = await mkdtemp(resolve(tmpdir(), 'tracer-restore-'));
  try {
    const dumpPath = resolve(stagingDir, 'dump.pgc');
    expectDigest(await decrypt(resolve(BACKUP_DIR, manifest.dump.file), dumpPath), manifest.dump, 'dump');
    const journalPlain = resolve(stagingDir, 'journal.jsonl');
    expectDigest(await decrypt(resolve(BACKUP_DIR, manifest.journal.file), journalPlain), manifest.journal, 'journal');
    const embedded: JournalExportRow[] = (await readFile(journalPlain, 'utf8'))
      .split('\n')
      .filter(line => line.trim())
      .map(line => JSON.parse(line) as JournalExportRow);
    verifyJournalCompleteness(embedded, manifest.journal.cut);
    // Fail-closed journal resolution: prefer the independent store (it may hold
    // post-snapshot events the embedded copy predates); unusable stores refuse
    // the restore unless the operator passes the explicit fallback.
    const journal = await resolveJournalInput(embedded, manifest.journal.cut, options);
    let filesTarPath: string | null = null;
    if (options.restoreFiles !== false) {
      filesTarPath = resolve(stagingDir, 'files.tar');
      expectDigest(await decrypt(resolve(BACKUP_DIR, manifest.files.file), filesTarPath), manifest.files, 'private-file snapshot');
    }
    await rm(journalPlain, { force: true });
    return { manifest, journal, dumpPath, filesTarPath, stagingDir };
  } catch (error) {
    await rm(stagingDir, { recursive: true, force: true });
    throw error;
  }
}

// Step 3: pg_restore the verified dump into an EMPTY loopback target.
export async function restoreDump(dumpPath: string, targetDatabaseUrl: string): Promise<void> {
  const { url, name } = targetSettings(targetDatabaseUrl);
  const restore = pgBin('pg_restore');
  execFileSync(
    restore.path,
    ['-h', url.hostname, '-p', url.port, '-U', url.username, '-d', name, '--no-owner', dumpPath],
    { env: { ...process.env, PGPASSWORD: decodeURIComponent(url.password) }, stdio: ['ignore', 'ignore', 'pipe'] },
  );
}

// Step 4: ordered schema compatibility against S1's migration owner. Migrates
// a scratch reference with the CURRENT ordered migrations (auth → application
// → queue) and requires every reference table/column to exist in the restored
// schema. Returns the count of restored-only extras (recorded, not an error).
export async function checkSchemaCompatibility(targetPool: Pool): Promise<number> {
  const owner = ownerUrl();
  const refName = `p8ref_${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`;
  const referenceUrl = new URL(owner.href);
  referenceUrl.pathname = `/${refName}`;
  const adminClient = admin();
  await adminClient.connect();
  try {
    await adminClient.query(`CREATE DATABASE ${refName} OWNER ${owner.username}`);
    await migrate(referenceUrl.href);
  } finally {
    await adminClient.query(`DROP DATABASE IF EXISTS ${refName} WITH (FORCE)`).catch(() => undefined);
    await adminClient.end();
  }
  const referencePool = new Pool({ connectionString: referenceUrl.href, max: 1 });
  const referenceClient = await referencePool.connect();
  let reference: Awaited<ReturnType<typeof schemaInventory>>;
  try {
    reference = await schemaInventory(referenceClient);
  } finally {
    referenceClient.release();
    await referencePool.end();
  }
  const restoredClient = await targetPool.connect();
  let restored: Awaited<ReturnType<typeof schemaInventory>>;
  try {
    restored = await schemaInventory(restoredClient);
  } finally {
    restoredClient.release();
  }
  const keys = new Set(restored.map(row => `${row.schema}.${row.table}.${row.column}:${row.dataType}`));
  const missing = reference.filter(row => !keys.has(`${row.schema}.${row.table}.${row.column}:${row.dataType}`));
  if (missing.length) {
    console.error(JSON.stringify({ event: 'restore-schema-incompatible', missing: missing.length }));
    throw new Error('Restored schema lacks tables/columns the current code requires');
  }
  return restored.length - reference.length;
}

// Step 5: invalidate ALL restored sessions; the auth fence trigger bumps every
// principal epoch, so queued jobs restored from the snapshot lose their
// authorization basis too. Journaled as one system-scope revocation in the
// same transaction.
export async function invalidateAllSessions(target: Pool): Promise<number> {
  await target.query('BEGIN');
  try {
    const client = await target.connect();
    let invalidated = 0;
    try {
      const updated = await client.query(
        'UPDATE auth.session SET "expiresAt"=clock_timestamp() WHERE "expiresAt">clock_timestamp()',
      );
      invalidated = updated.rowCount ?? 0;
      await journalSessionRevocation(client, {
        ownerId: null,
        sessionIds: [],
        receipt: { scope: 'all', reason: 'restore' },
      });
    } finally {
      client.release();
    }
    await target.query('COMMIT');
    return invalidated;
  } catch (error) {
    await target.query('ROLLBACK');
    throw error;
  }
}

// Step 6: import the independent journal copy and replay it, still before any
// traffic, reminders, queue dispatch or egress. Replay only denies.
export async function replayJournalInto(
  target: Pool,
  rows: JournalExportRow[],
): Promise<{ imported: number; replay: ReplaySummary }> {
  await target.query('BEGIN');
  try {
    const client: PoolClient = await target.connect();
    let imported = 0;
    let replay: ReplaySummary = { reconciled: 0, unchanged: 0, fixtureNoOp: 0, events: 0 };
    try {
      imported = await importJournalRows(client, rows);
      replay = await replayJournal(client, rows);
    } finally {
      client.release();
    }
    await target.query('COMMIT');
    return { imported, replay };
  } catch (error) {
    await target.query('ROLLBACK');
    throw error;
  }
}

// Full ordered operator procedure (steps 1–6 plus the private-file snapshot
// and timing capture). Any failure aborts before later steps run; the target
// is then NOT ready for traffic and the operator procedure says to drop it.
export async function restoreBackup(options: RestoreOptions): Promise<RestoreResult> {
  const started = Date.now();
  const timings: { step: string; ms: number }[] = [];
  const mark = (step: string, since: number) => timings.push({ step, ms: Date.now() - since });
  const { name: targetName } = targetSettings(options.targetDatabaseUrl);
  const target = new Pool({ connectionString: options.targetDatabaseUrl, max: 2 });
  let sessionsInvalidated = 0;
  let journalImported = 0;
  let replay: ReplaySummary = { reconciled: 0, unchanged: 0, fixtureNoOp: 0, events: 0 };
  let fileCopies = 0;
  let extras = 0;
  let loaded: LoadedBackup | undefined;
  try {
    const loadStarted = Date.now();
    const backup = await loadBackup(options.backupId, options);
    loaded = backup;
    mark('decrypt-verify-journal', loadStarted);
    const restoreStarted = Date.now();
    await restoreDump(backup.dumpPath, options.targetDatabaseUrl);
    mark('pg-restore', restoreStarted);
    const compatStarted = Date.now();
    extras = await checkSchemaCompatibility(target);
    mark('schema-compat', compatStarted);
    const invalidateStarted = Date.now();
    sessionsInvalidated = await invalidateAllSessions(target);
    mark('invalidate-sessions', invalidateStarted);
    const replayStarted = Date.now();
    const replayed = await replayJournalInto(target, backup.journal.rows);
    journalImported = replayed.imported;
    replay = replayed.replay;
    mark('journal-replay', replayStarted);
    if (backup.filesTarPath) {
      const filesStarted = Date.now();
      const extractDir = resolve(backup.stagingDir, 'objects');
      await mkdir(extractDir, { mode: 0o700 });
      execFileSync('/usr/bin/tar', ['-xf', backup.filesTarPath, '-C', extractDir], {
        stdio: ['ignore', 'ignore', 'pipe'],
      });
      const storagePath = config().storagePath;
      await mkdir(storagePath, { recursive: true, mode: 0o700 });
      for (const name of (await readdir(extractDir)).filter(name => !name.startsWith('.'))) {
        try {
          await copyFile(resolve(extractDir, name), resolve(storagePath, name), constants.COPYFILE_EXCL);
          fileCopies += 1;
        } catch {
          // An existing local file with the same uuid stays authoritative;
          // the copy is skipped, never overwritten.
        }
      }
      mark('files-restore', filesStarted);
    }
    mark('total', started);
    const rtoMinutes = Math.round((Date.now() - started) / 60000);
    const result: RestoreResult = {
      backupId: options.backupId,
      targetName,
      sessionsInvalidated,
      journalImported,
      replay,
      fileCopies,
      extras,
      timings,
      rtoMinutes,
      rtoBudgetOk: Date.now() - started < RTO_HOURS * 3600 * 1000,
    };
    console.log(
      JSON.stringify({
        event: 'restore-complete',
        backupId: options.backupId,
        target: targetName,
        sessionsInvalidated,
        journalImported,
        replay,
        rtoMinutes,
        rtoBudgetOk: result.rtoBudgetOk,
        timings,
      }),
    );
    console.log(
      JSON.stringify({
        event: 'restore-operator-note',
        note: 'Target is reconciled but not live. Swap databases and runtime configuration manually; the worker reconciles pending physical purges at start. Local evidence does not certify managed hosting.',
      }),
    );
    return result;
  } catch (error) {
    console.error(JSON.stringify({ event: 'restore-failed', backupId: options.backupId }));
    throw error;
  } finally {
    if (loaded) await rm(loaded.stagingDir, { recursive: true, force: true });
    await target.end();
  }
}

// CLI: `npm run restore -- <backupId>` restores into the pinned scratch
// database `tracer_synthetic_restored` (recreated from scratch each run). The
// operator swap to live is a documented manual step — never automated here.
if (process.argv[1] && resolve(process.argv[1]) === resolve('scripts/restore.ts')) {
  const backupId = process.argv[2];
  if (!backupId) throw new Error('Usage: npm run restore -- <backupId>');
  const owner = ownerUrl();
  const targetName = 'tracer_synthetic_restored';
  const adminClient = admin();
  await adminClient.connect();
  try {
    await adminClient.query(`DROP DATABASE IF EXISTS ${targetName} WITH (FORCE)`);
    await adminClient.query(`CREATE DATABASE ${targetName} OWNER ${owner.username}`);
  } finally {
    await adminClient.end();
  }
  const targetUrl = new URL(owner.href);
  targetUrl.pathname = `/${targetName}`;
  await restoreBackup({ backupId, targetDatabaseUrl: targetUrl.href });
}
