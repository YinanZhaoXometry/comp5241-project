import type { PoolClient } from 'pg';
import { z } from 'zod';
import { transaction } from '../../adapters/postgres/database';
import { uuid, type Identity } from '../../contracts/setup';
import { fail } from '../../platform/errors';
import { authorize } from '../identity-access/access';
import { parse } from '../materials-setup/service';
import { sweepExports } from '../setup-export/worker';

// S10 bounded retention over the explicit active-copy inventory. The registry
// (app.retention_registry) records every registered active copy with its
// retention class and expiry; the scheduler below drives enforcement that is
// not already wired elsewhere (the export sweep, the deletion reconciler),
// evaluates deadline status/alerts, expires content-free receipts, advances
// the synthetic ninety-day archive contract and cleans up its own receipts.
//
// Responsibilities stay separated exactly as P6 left them: the seven-day
// deletion purge is enforced by the deletion reconciler (reconcileCopies), the
// twenty-four-hour export purge by the export sweep (sweepExports) — this
// module records the classes, retries the sweeps, and alerts when a copy is
// past expiry without confirmed erasure. Alerts never restore access.
//
// Module write ownership is preserved: the scheduler deletes only rows in
// tables this module owns (deletion_preview expiry, the synthetic archive
// contract, its own registry rows). Copies registered by other modules are
// alerted when overdue, never blindly deleted from here.

// Content-free retention receipt ceiling (AD-4): even purged registry rows
// expire thirty days after the purge they record.
export const RECEIPT_RETENTION_DAYS = 30;
// Ninety-day post-archive contract: the notice is recorded at sixty days and
// the purge may only run after a recorded notice, at ninety days.
export const ARCHIVE_NOTICE_DAYS = 60;
export const ARCHIVE_PURGE_DAYS = 90;

export const RETENTION_CLASSES = {
  'export-artifact': {
    label: 'Personal export artifacts',
    days: 1,
    note: 'Twenty-four-hour export expiry; enforcement stays in the export sweep this scheduler drives.',
  },
  'deletion-active-purge': {
    label: 'Deletion active-copy purge deadline',
    days: 7,
    note: 'Deadline status and alerts only; the seven-day purge itself stays with the deletion reconciler.',
  },
  'metadata-receipt': {
    label: 'Content-free metadata and receipts',
    days: 30,
    note: 'AD-4 ceiling for content-free journals and receipts; this scheduler owns the deletion-preview expiry.',
  },
  'backup-snapshot': {
    label: 'Local backup snapshots (S13 class)',
    days: 30,
    note: 'Registered for S13\u2019s physical implementation; no backup exists in this story and class configuration alone is not backup evidence.',
  },
  'protective-journal': {
    label: 'Protective journal segments (S13 class)',
    days: 30,
    note: 'Registered for S13\u2019s physical implementation; no protective journal exists in this story.',
  },
  'course-archive': {
    label: 'Ninety-day course archive contract',
    days: 90,
    note: 'Synthetic fixture contract: a recorded notice and the export window precede the ninety-day purge.',
  },
} as const;
export type RetentionClassKey = keyof typeof RETENTION_CLASSES;
export const RETENTION_CLASS_KEYS = Object.keys(RETENTION_CLASSES) as RetentionClassKey[];

// Refuse unregistered derivative persistence: every derivative copy must name
// a registered retention class before it may be persisted, so no future type
// is silently omitted from deletion. Unknown classes fail closed; consumer
// epics extend RETENTION_CLASSES (and the migration CHECK) and rerun the same
// contract tests.
export function requireRetentionClass(key: string) {
  const found = (RETENTION_CLASSES as Record<string, (typeof RETENTION_CLASSES)[RetentionClassKey]>)[key];
  if (!found) fail('INVALID_INPUT');
  return { key, ...found };
}

export type RetentionCopy = {
  /** Store identifier chosen by the registering module (e.g. 'export-request'). */
  kind: string;
  retentionClass: RetentionClassKey;
  /** NULL for system-scope copies (S13 backup/journal classes). */
  ownerId: string | null;
  /** Physical private-storage key, and/or a content-free row locator. */
  storageKey?: string | null;
  table?: string | null;
  rowId?: string | null;
  expiresAt: Date;
};

// The registry check other modules call when registering a derivative copy:
// it refuses an unregistered class (INVALID_INPUT) and upserts one idempotent
// content-free inventory row per copy. A purged registry row is never
// resurrected by a late duplicate registration; the guarded upsert refreshes
// only still-active rows.
export async function registerRetentionCopy(client: PoolClient, copy: RetentionCopy): Promise<string> {
  const retentionClass = requireRetentionClass(copy.retentionClass).key;
  if (!copy.storageKey && !(copy.table && copy.rowId)) fail('INVALID_INPUT');
  const locator = copy.storageKey ?? `${copy.table}#${copy.rowId}`;
  const inserted = await client.query<{ id: string }>(
    `INSERT INTO app.retention_registry(id,owner_id,kind,retention_class,storage_key,table_name,row_id,expires_at)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (kind, COALESCE(storage_key::text, table_name || '#' || row_id)) DO UPDATE
       SET expires_at=EXCLUDED.expires_at, updated_at=clock_timestamp()
       WHERE app.retention_registry.state='active'
     RETURNING id`,
    [
      crypto.randomUUID(),
      copy.ownerId,
      copy.kind,
      retentionClass,
      copy.storageKey ?? null,
      copy.table ?? null,
      copy.rowId ?? null,
      copy.expiresAt,
    ],
  );
  if (inserted.rows[0]) return inserted.rows[0].id;
  // Conflict with an existing row: a still-active row kept its identity (only
  // the expiry moved); a purged row stays purged. Return the existing identity.
  const found = await client.query<{ id: string }>(
    'SELECT id FROM app.retention_registry WHERE kind=$1 AND COALESCE(storage_key::text, table_name || \'#\' || row_id)=$2',
    [copy.kind, locator],
  );
  if (!found.rows[0]) fail('RETRYABLE_FAILURE');
  return found.rows[0].id;
}

// Completes the inventory for the known built-in stores: copies persisted
// before the registry existed (or whose registration could not run) are
// registered here rather than silently omitted from deletion. Copies of
// unknown/future stores are covered by requireRetentionClass instead:
// persisting them without a registered class is refused.
async function syncRetentionInventory(client: PoolClient) {
  await client.query(
    `INSERT INTO app.retention_registry(id,owner_id,kind,retention_class,storage_key,table_name,row_id,expires_at)
     SELECT gen_random_uuid(), e.owner_id, 'export-request', 'export-artifact', e.artifact_key, 'export_request', e.id::text, e.expires_at
     FROM app.export_request e
     WHERE e.state='ready' AND e.artifact_key IS NOT NULL AND e.expires_at IS NOT NULL AND e.expires_at>clock_timestamp()
     ON CONFLICT (kind, COALESCE(storage_key::text, table_name || '#' || row_id)) DO NOTHING`,
  );
  await client.query(
    `INSERT INTO app.retention_registry(id,owner_id,kind,retention_class,storage_key,table_name,row_id,expires_at)
     SELECT gen_random_uuid(), d.owner_id, 'deletion-request', 'deletion-active-purge', NULL, 'deletion_request', d.id::text, d.deadline_at
     FROM app.deletion_request d
     WHERE d.state='pending'
     ON CONFLICT (kind, COALESCE(storage_key::text, table_name || '#' || row_id)) DO NOTHING`,
  );
  await client.query(
    `INSERT INTO app.retention_registry(id,owner_id,kind,retention_class,storage_key,table_name,row_id,expires_at)
     SELECT gen_random_uuid(), p.owner_id, 'deletion-preview', 'metadata-receipt', NULL, 'deletion_preview', p.id::text, p.expires_at
     FROM app.deletion_preview p
     WHERE p.expires_at>clock_timestamp()
     ON CONFLICT (kind, COALESCE(storage_key::text, table_name || '#' || row_id)) DO NOTHING`,
  );
}

async function markPurged(client: PoolClient, registryId: string) {
  await client.query(
    "UPDATE app.retention_registry SET state='purged',purged_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=$1",
    [registryId],
  );
}

async function alertCopy(client: PoolClient, registryId: string) {
  await client.query(
    'UPDATE app.retention_registry SET alerted_at=COALESCE(alerted_at,clock_timestamp()),updated_at=clock_timestamp() WHERE id=$1',
    [registryId],
  );
}

// Export artifacts (24h): the sweep driven above is the enforcer; this pass
// confirms erasure against the export row (artifact_key is nulled only after a
// successful erase) and alerts when a copy is past expiry without that proof.
async function evaluateExportCopies() {
  await transaction(async client => {
    const due = await client.query<{ id: string; row_id: string; alerted_at: Date | null }>(
      `SELECT id,row_id,alerted_at FROM app.retention_registry
       WHERE retention_class='export-artifact' AND state='active' AND expires_at<=clock_timestamp()
       ORDER BY expires_at LIMIT 200 FOR UPDATE SKIP LOCKED`,
    );
    for (const copy of due.rows) {
      const request = await client.query<{ state: string; artifact_key: string | null }>(
        'SELECT state,artifact_key FROM app.export_request WHERE id=$1',
        [copy.row_id],
      );
      const row = request.rows[0];
      const erased =
        !row ||
        (!['ready', 'queued', 'running'].includes(row.state) && !row.artifact_key);
      if (erased) {
        await markPurged(client, copy.id);
        continue;
      }
      if (!copy.alerted_at) {
        await alertCopy(client, copy.id);
        console.error(JSON.stringify({ event: 'retention-copy-overdue', kind: 'export-request', retentionClass: 'export-artifact' }));
      }
    }
  });
}

// Seven-day deletion deadline: registry records the class; this pass derives
// overdue status and records one alert per request. The purge itself stays the
// deletion reconciler's job and an alert never restores access.
async function evaluateDeletionDeadlines() {
  await transaction(async client => {
    const due = await client.query<{ id: string; row_id: string; alerted_at: Date | null }>(
      `SELECT id,row_id,alerted_at FROM app.retention_registry
       WHERE retention_class='deletion-active-purge' AND state='active' AND expires_at<=clock_timestamp()
       ORDER BY expires_at LIMIT 200 FOR UPDATE SKIP LOCKED`,
    );
    for (const copy of due.rows) {
      const request = await client.query<{ state: string }>(
        'SELECT state FROM app.deletion_request WHERE id=$1',
        [copy.row_id],
      );
      const row = request.rows[0];
      if (!row || row.state === 'purged') {
        await markPurged(client, copy.id);
        continue;
      }
      if (!copy.alerted_at) {
        await alertCopy(client, copy.id);
        console.error(JSON.stringify({ event: 'retention-deadline-overdue', requestId: copy.row_id }));
      }
    }
  });
}

// Content-free metadata/receipts (30d): the deletion-preview journal expiry is
// owned here (its table comment assigns the sweep to this module). Registry
// rows for other modules' registered receipts are alerted when overdue, never
// deleted blindly — the owning module's sweep enforces and this pass follows.
async function expireMetadataReceipts() {
  await transaction(async client => {
    const expired = await client.query<{ id: string }>(
      'DELETE FROM app.deletion_preview WHERE expires_at<=clock_timestamp() RETURNING id',
    );
    for (const row of expired.rows) {
      await client.query(
        `UPDATE app.retention_registry SET state='purged',purged_at=clock_timestamp(),updated_at=clock_timestamp()
         WHERE kind='deletion-preview' AND row_id=$1 AND state='active'`,
        [row.id],
      );
    }
    const overdue = await client.query<{ id: string; kind: string; alerted_at: Date | null }>(
      `SELECT id,kind,alerted_at FROM app.retention_registry
       WHERE retention_class='metadata-receipt' AND state='active' AND expires_at<=clock_timestamp()
         AND kind<>'deletion-preview' ORDER BY expires_at LIMIT 200 FOR UPDATE SKIP LOCKED`,
    );
    for (const copy of overdue.rows) {
      if (copy.alerted_at) continue;
      await alertCopy(client, copy.id);
      console.error(JSON.stringify({ event: 'retention-copy-overdue', kind: copy.kind, retentionClass: 'metadata-receipt' }));
    }
  });
}

// Ninety-day post-archive contract (synthetic fixtures only): record the
// notice at sixty days, and at ninety days purge — deleting the synthetic
// course-controller record — but only after a recorded notice, so notices and
// the export window provably precede every purge.
async function advanceArchiveContracts() {
  await transaction(async client => {
    const notices = await client.query<{ id: string }>(
      `UPDATE app.archive_contract SET state='notice',noticed_at=clock_timestamp()
       WHERE noticed_at IS NULL AND notice_due_at<=clock_timestamp()
       RETURNING id`,
    );
    for (const row of notices.rows) {
      console.log(JSON.stringify({ event: 'archive-notice-recorded', archiveId: row.id, synthetic: true }));
    }
    const due = await client.query<{ id: string; noticed_at: Date | null }>(
      'SELECT id,noticed_at FROM app.archive_contract WHERE purge_due_at<=clock_timestamp() ORDER BY purge_due_at LIMIT 200 FOR UPDATE SKIP LOCKED',
    );
    for (const row of due.rows) {
      // Defensive: the CHECK keeps notice_due_at < purge_due_at and the notice
      // pass above runs first, so this branch should be unreachable — a purge
      // without a recorded notice must never run.
      if (!row.noticed_at) {
        console.error(JSON.stringify({ event: 'archive-purge-blocked-no-notice', archiveId: row.id, synthetic: true }));
        continue;
      }
      await client.query('DELETE FROM app.archive_contract WHERE id=$1', [row.id]);
      await client.query(
        `UPDATE app.retention_registry SET state='purged',purged_at=clock_timestamp(),updated_at=clock_timestamp()
         WHERE kind='course-archive' AND row_id=$1 AND state='active'`,
        [row.id],
      );
      console.log(JSON.stringify({ event: 'archive-purged', archiveId: row.id, synthetic: true }));
    }
  });
}

// Receipt cleanup: registry rows are content-free receipts themselves and
// expire thirty days after the purge they record (AD-4).
async function cleanupPurgedReceipts() {
  await transaction(async client => {
    await client.query(
      `DELETE FROM app.retention_registry
       WHERE state='purged' AND purged_at<=clock_timestamp()-($1::int * interval '1 day')`,
      [RECEIPT_RETENTION_DAYS],
    );
  });
}

// The bounded-retention scheduler. Safe to run repeatedly and concurrently:
// every step is idempotent (guarded upserts, FOR UPDATE SKIP LOCKED, guarded
// terminal writes) and one failing class never blocks the others — a failed
// step is logged as pending and retried on the next run.
export async function reconcileRetention(): Promise<void> {
  // Retry the 24h export enforcement first so evaluation below sees its result.
  try { await sweepExports(); }
  catch { console.error(JSON.stringify({ event: 'retention-export-sweep-pending' })); }
  const steps: [string, () => Promise<void>][] = [
    ['retention-inventory-pending', () => transaction(syncRetentionInventory)],
    ['retention-export-evaluation-pending', evaluateExportCopies],
    ['retention-deadline-evaluation-pending', evaluateDeletionDeadlines],
    ['retention-receipt-expiry-pending', expireMetadataReceipts],
    ['retention-archive-pending', advanceArchiveContracts],
    ['retention-receipt-cleanup-pending', cleanupPurgedReceipts],
  ];
  for (const [pending, step] of steps) {
    try { await step(); }
    catch { console.error(JSON.stringify({ event: pending })); }
  }
}

export const archiveFixtureSchema = z.strictObject({
  schemaVersion: z.literal(1),
  courseController: z.string().min(1).max(200),
});

// Synthetic fixture ONLY (delivery-checks S10): creates a ninety-day
// post-archive notice/export/purge contract with synthetic course-controller
// records. This is not an instructor enrollment/authoring integration and must
// not be presented as epic-5 work; consumer epics extend this contract and
// rerun the same tests against their real integrations.
export async function createCourseArchiveFixture(identity: Identity, raw: unknown) {
  const input = parse(archiveFixtureSchema, raw);
  return transaction(async client => {
    await authorize(client, identity);
    const created = await client.query<{ id: string; notice_due_at: Date; purge_due_at: Date }>(
      `INSERT INTO app.archive_contract(id,owner_id,course_controller,source,archived_at,notice_due_at,purge_due_at)
       VALUES($1,$2,$3,'synthetic-fixture',clock_timestamp(),
              clock_timestamp()+($4::int * interval '1 day'),
              clock_timestamp()+($5::int * interval '1 day'))
       RETURNING id,notice_due_at,purge_due_at`,
      [crypto.randomUUID(), identity.userId, input.courseController, ARCHIVE_NOTICE_DAYS, ARCHIVE_PURGE_DAYS],
    );
    const row = created.rows[0];
    await registerRetentionCopy(client, {
      kind: 'course-archive',
      retentionClass: 'course-archive',
      ownerId: identity.userId,
      table: 'archive_contract',
      rowId: row.id,
      expiresAt: row.purge_due_at,
    });
    return {
      archiveId: row.id,
      noticeDueAt: row.notice_due_at.toISOString(),
      purgeDueAt: row.purge_due_at.toISOString(),
    };
  });
}

export type ArchiveExportReceipt = {
  archiveId: string;
  exportedAt: string;
  receipt: { schemaVersion: 1; synthetic: true; courseController: string };
};

// Learner-initiated export inside the archive window: refused before the
// notice is recorded (CONFLICT) and after the purge (the contract row is gone,
// so the fence denies). Duplicate calls replay the recorded receipt.
export async function exportCourseArchive(identity: Identity, rawId: string): Promise<ArchiveExportReceipt> {
  const archiveId = uuid.parse(rawId);
  return transaction(async client => {
    await authorize(client, identity);
    const found = await client.query<{
      owner_id: string;
      course_controller: string;
      noticed_at: Date | null;
      exported_at: Date | null;
      export_receipt: ArchiveExportReceipt['receipt'] | null;
    }>(
      'SELECT owner_id,course_controller,noticed_at,exported_at,export_receipt FROM app.archive_contract WHERE id=$1 FOR UPDATE',
      [archiveId],
    );
    const row = found.rows[0];
    if (!row || row.owner_id !== identity.userId) fail('FORBIDDEN_OR_NOT_FOUND');
    if (row.exported_at && row.export_receipt) {
      return { archiveId, exportedAt: row.exported_at.toISOString(), receipt: row.export_receipt };
    }
    if (!row.noticed_at) fail('CONFLICT');
    const receipt: ArchiveExportReceipt['receipt'] = {
      schemaVersion: 1,
      synthetic: true,
      courseController: row.course_controller,
    };
    const updated = await client.query<{ exported_at: Date }>(
      "UPDATE app.archive_contract SET state='exported',exported_at=clock_timestamp(),export_receipt=$2 WHERE id=$1 RETURNING exported_at",
      [archiveId, JSON.stringify(receipt)],
    );
    return { archiveId, exportedAt: updated.rows[0].exported_at.toISOString(), receipt };
  });
}
