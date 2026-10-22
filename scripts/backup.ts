// S13 isolated local backup: one encrypted PostgreSQL snapshot (pg_dump from
// the .local/pg18 toolchain), one encrypted private-file snapshot, and one
// independently stored encrypted protective-journal export, plus a content-free
// manifest. Encryption uses the openssl CLI with a key file under .local/
// (never in the repo, never printed); no new npm dependency.
//
// LOCAL SYNTHETIC SCOPE. This script is the physical implementation P7's
// `backup-snapshot`/`protective-journal` retention classes were registered
// for. Local evidence cannot certify managed-host retention/geo/deletion
// terms (delivery-checks S13/F5/F6); it authorizes nothing beyond this
// machine. Run only against the local loopback cluster owned by this
// workspace (never the Homebrew default clusters).
//
// Every artifact is registered in app.retention_registry with a 30-day expiry
// (class configuration) AND purged here on the next run after expiry, so
// expiry has a working physical proof path. Each run: purge expired → dump →
// journal cut → files snapshot → encrypt → manifest → register.

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { open, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { constants, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Pool, type PoolClient } from 'pg';
import { config } from '../src/platform/config';
import { RETENTION_CLASSES, registerRetentionCopy } from '../src/modules/lifecycle-platform/retention';
import {
  deliverPendingJournalEvents,
  journalDigest,
  readProtectiveJournal,
  type JournalExpectation,
  type JournalExportRow,
} from '../src/adapters/protected-journal';

export const BACKUP_DIR = resolve('.local/backups');
export const KEY_FILE = resolve('.local/backup-key');
export const RETENTION_DAYS = RETENTION_CLASSES['backup-snapshot'].days;
export const RPO_HOURS = 24;
// Serializes backup/restore against each other on the local cluster.
export const BACKUP_LOCK = 5241003;

const OPENSSL = process.env.BACKUP_OPENSSL ?? '/usr/bin/openssl';
const DEFAULT_PG_BIN = '/opt/homebrew/opt/postgresql@18/bin';
const CIPHER_ARGS = ['-aes-256-cbc', '-salt', '-pbkdf2', '-iter', '600000'];

export type BackupManifest = {
  schemaVersion: 1;
  backupId: string;
  createdAt: string;
  database: { host: string; port: string; name: string };
  tool: { pgDump: string };
  dump: { file: string; sha256: string; bytes: number };
  files: { file: string; sha256: string; bytes: number; count: number };
  journal: { file: string; sha256: string; bytes: number; cut: JournalExpectation };
  migrations: { name: string; hash: string }[];
  schema: { schema: string; table: string; column: string; dataType: string }[];
  retention: { classes: string[]; expiresAt: string };
};

export type BackupResult = {
  backupId: string;
  journalCut: JournalExpectation;
  expiresAt: string;
  fileCount: number;
  timings: { step: string; ms: number }[];
};

function settings() {
  // Loopback-only enforcement mirrors src/platform/config.ts for the owner
  // connection used by the dump toolchain.
  const data = JSON.parse(readFileSync(resolve('.local/migration-config.json'), 'utf8')) as {
    databaseUrl: string;
  };
  const url = new URL(data.databaseUrl);
  if (url.hostname !== '127.0.0.1') throw new Error('Backup requires the local loopback database');
  return { url, databaseUrl: data.databaseUrl };
}

export function pgBin(tool: 'pg_dump' | 'pg_restore') {
  for (const base of [resolve('.local/pg18/bin'), process.env.PG_BIN, DEFAULT_PG_BIN]) {
    if (!base) continue;
    try {
      const version = execFileSync(`${base}/${tool}`, ['--version'], { encoding: 'utf8' });
      if (!/ 18\./u.test(version)) continue;
      return { path: `${base}/${tool}`, version: version.trim() };
    } catch {
      continue;
    }
  }
  throw new Error('PostgreSQL 18 toolchain not found (expected under .local/pg18/bin or PG_BIN)');
}

async function ensureKey(): Promise<void> {
  try {
    await readFile(KEY_FILE, { encoding: 'utf8' });
  } catch {
    const key = execFileSync(OPENSSL, ['rand', '-hex', '32'], { encoding: 'utf8' }).trim();
    // Created with exclusive-create 0600. The key material is never printed,
    // logged or committed; losing .local/backup-key makes every snapshot
    // undecryptable by design.
    await writeFile(KEY_FILE, `${key}\n`, { mode: 0o600, flag: 'wx' });
  }
}

async function encrypt(plainPath: string): Promise<{ encPath: string; sha256: string; bytes: number }> {
  const plain = await readFile(plainPath);
  const sha256 = createHash('sha256').update(plain).digest('hex');
  const encPath = `${plainPath}.enc`;
  execFileSync(OPENSSL, ['enc', ...CIPHER_ARGS, '-in', plainPath, '-out', encPath, '-pass', `file:${KEY_FILE}`]);
  await rm(plainPath, { force: true });
  return { encPath, sha256, bytes: plain.length };
}

// The content-free schema inventory used by restore's compatibility check.
export async function schemaInventory(client: PoolClient) {
  const rows = await client.query<{ table_schema: string; table_name: string; column_name: string; data_type: string }>(
    `SELECT table_schema,table_name,column_name,data_type FROM information_schema.columns
     WHERE table_schema IN ('auth','app','queue') ORDER BY table_schema,table_name,column_name`,
  );
  return rows.rows.map(row => ({
    schema: row.table_schema,
    table: row.table_name,
    column: row.column_name,
    dataType: row.data_type,
  }));
}

// Expires due snapshots honestly: registry rows are marked purged and the
// physical encrypted files are deleted — an expiry receipt must never
// describe bytes that still exist. Returns the backup ids fully purged.
export async function purgeExpiredBackups(client: PoolClient): Promise<string[]> {
  const due = await client.query<{ kind: string; storage_key: string; row_id: string }>(
    `SELECT kind,storage_key,row_id FROM app.retention_registry
     WHERE kind IN ('protective-backup-dump','protective-backup-files','protective-backup-journal')
       AND state='active' AND expires_at<=clock_timestamp()
     ORDER BY row_id FOR UPDATE`,
  );
  const byBackup = new Map<string, number>();
  for (const row of due.rows) {
    await rm(resolve(BACKUP_DIR, `${row.storage_key}.enc`), { force: true });
    await client.query(
      `UPDATE app.retention_registry SET state='purged',purged_at=clock_timestamp(),updated_at=clock_timestamp()
       WHERE kind=$1 AND storage_key=$2 AND state='active'`,
      [row.kind, row.storage_key],
    );
    byBackup.set(row.row_id, (byBackup.get(row.row_id) ?? 0) + 1);
  }
  const purged: string[] = [];
  for (const [backupId, copies] of byBackup) {
    if (copies < 3) continue; // never remove the manifest while copies remain
    await rm(resolve(BACKUP_DIR, `${backupId}.json`), { force: true });
    purged.push(backupId);
  }
  return purged;
}

export async function createBackup(): Promise<BackupResult> {
  const started = Date.now();
  const timings: { step: string; ms: number }[] = [];
  const mark = (step: string, since: number) => timings.push({ step, ms: Date.now() - since });
  const { url, databaseUrl } = settings();
  const dump = pgBin('pg_dump');
  config(); // refuse unless the runtime configuration is the loopback local one
  await mkdir(BACKUP_DIR, { recursive: true, mode: 0o700 });
  await ensureKey();
  const backupId = crypto.randomUUID();
  const filesKey = crypto.randomUUID();
  const journalKey = crypto.randomUUID();
  const staging: string[] = [];
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  try {
    // One serialized maintenance window; a concurrent restore or backup waits.
    const lock = await pool.connect();
    try {
      await lock.query('SELECT pg_advisory_lock($1)', [BACKUP_LOCK]);
      const purgeStarted = Date.now();
      const expired = await purgeExpiredBackups(lock);
      mark('purge-expired', purgeStarted);
      if (expired.length) console.log(JSON.stringify({ event: 'backup-expired-purged', count: expired.length }));

      const dumpStarted = Date.now();
      const dumpPlain = resolve(BACKUP_DIR, `${backupId}.dump`);
      staging.push(dumpPlain);
      execFileSync(
        dump.path,
        ['-h', url.hostname, '-p', url.port, '-U', url.username, '-Fc', '-f', dumpPlain, url.pathname.slice(1)],
        { env: { ...process.env, PGPASSWORD: decodeURIComponent(url.password) }, stdio: ['ignore', 'ignore', 'pipe'] },
      );
      mark('pg-dump', dumpStarted);

      // The journal cut is taken AFTER the dump completes: pg_dump reads one
      // repeatable-read snapshot, so any event committed while it ran is
      // absent from the dump and MUST be inside this export (replay is
      // idempotent, so rows present in both converge instead of doubling).
      // Delivery runs first so the independent store (and this embedded copy)
      // also heal any pending tail from a failed post-commit delivery.
      const journalStarted = Date.now();
      await deliverPendingJournalEvents(lock);
      const journalRows: JournalExportRow[] = await readProtectiveJournal(lock);
      const journalCut: JournalExpectation = {
        cut: journalRows.length ? journalRows[journalRows.length - 1].seq : 0,
        count: journalRows.length,
        digest: journalDigest(journalRows),
      };
      mark('journal-export', journalStarted);

      const schema = await schemaInventory(lock);
      const migrations = (
        await lock.query<{ name: string; hash: string }>('SELECT name,hash FROM app.schema_migration ORDER BY name')
      ).rows;

      const filesStarted = Date.now();
      const storagePath = config().storagePath;
      let fileNames: string[] = [];
      try {
        fileNames = (await readdir(storagePath)).filter(name => !name.startsWith('.'));
      } catch {
        fileNames = [];
      }
      const filesPlain = resolve(BACKUP_DIR, `${filesKey}.tar`);
      staging.push(filesPlain);
      const tarFd = await open(filesPlain, constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC, 0o600);
      try {
        execFileSync('/usr/bin/tar', ['-cf', '-', '-C', storagePath, '.'], { stdio: ['ignore', tarFd.fd, 'pipe'] });
      } finally {
        await tarFd.close();
      }
      mark('private-files-snapshot', filesStarted);

      const encryptStarted = Date.now();
      const encDump = await encrypt(dumpPlain);
      staging.pop();
      const encFiles = await encrypt(filesPlain);
      staging.pop();
      const journalPlain = await writeTemp(
        resolve(BACKUP_DIR, `${journalKey}.jsonl`),
        Buffer.from(journalRows.map(row => JSON.stringify(row)).join('\n'), 'utf8'),
      );
      staging.push(journalPlain);
      const encJournal = await encrypt(journalPlain);
      staging.pop();
      mark('encrypt', encryptStarted);

      const expiresAt = new Date(Date.now() + RETENTION_DAYS * 24 * 3600 * 1000);
      const manifest: BackupManifest = {
        schemaVersion: 1,
        backupId,
        createdAt: new Date().toISOString(),
        database: { host: url.hostname, port: url.port, name: url.pathname.slice(1) },
        tool: { pgDump: dump.version },
        dump: { file: `${backupId}.dump.enc`, sha256: encDump.sha256, bytes: encDump.bytes },
        files: { file: `${filesKey}.tar.enc`, sha256: encFiles.sha256, bytes: encFiles.bytes, count: fileNames.length },
        journal: { file: `${journalKey}.jsonl.enc`, sha256: encJournal.sha256, bytes: encJournal.bytes, cut: journalCut },
        migrations,
        schema,
        retention: { classes: ['backup-snapshot', 'protective-journal'], expiresAt: expiresAt.toISOString() },
      };
      await writeFile(resolve(BACKUP_DIR, `${backupId}.json`), JSON.stringify(manifest, null, 2), {
        mode: 0o600,
        flag: 'wx',
      });

      const registerStarted = Date.now();
      const expires = new Date(expiresAt);
      await registerRetentionCopy(lock, {
        kind: 'protective-backup-dump',
        retentionClass: 'backup-snapshot',
        ownerId: null,
        storageKey: backupId,
        table: 'backup_manifest',
        rowId: backupId,
        expiresAt: expires,
      });
      await registerRetentionCopy(lock, {
        kind: 'protective-backup-files',
        retentionClass: 'backup-snapshot',
        ownerId: null,
        storageKey: filesKey,
        table: 'backup_manifest',
        rowId: backupId,
        expiresAt: expires,
      });
      await registerRetentionCopy(lock, {
        kind: 'protective-backup-journal',
        retentionClass: 'protective-journal',
        ownerId: null,
        storageKey: journalKey,
        table: 'backup_manifest',
        rowId: backupId,
        expiresAt: expires,
      });
      mark('register-retention', registerStarted);
      mark('total', started);
      console.log(
        JSON.stringify({
          event: 'backup-complete',
          backupId,
          journalCut: journalCut.cut,
          journalEvents: journalCut.count,
          fileCount: fileNames.length,
          expiresAt: expiresAt.toISOString(),
          timings,
        }),
      );
      return { backupId, journalCut, expiresAt: expiresAt.toISOString(), fileCount: fileNames.length, timings };
    } finally {
      await lock.query('SELECT pg_advisory_unlock($1)', [BACKUP_LOCK]).catch(() => undefined);
      lock.release();
    }
  } catch (error) {
    console.error(JSON.stringify({ event: 'backup-failed', backupId }));
    throw error;
  } finally {
    for (const path of staging.splice(0)) await rm(path, { force: true });
    await pool.end();
  }
}

async function writeTemp(path: string, bytes: Uint8Array): Promise<string> {
  const file = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC, 0o600);
  try {
    await file.writeFile(bytes);
  } finally {
    await file.close();
  }
  return path;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve('scripts/backup.ts')) {
  await createBackup();
}
