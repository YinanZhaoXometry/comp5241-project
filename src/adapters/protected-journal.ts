import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { uuid } from '../contracts/setup';
import { canonical } from '../contracts/export';
import { fail } from '../platform/errors';

// S13 independent bounded protective journal: storage, completeness proof and
// replay. The journal records content-free post-snapshot protective
// transitions (deletions, consent withdrawals, session revocations) so a
// restored older snapshot can be reconciled before any traffic, job or egress.
// Append happens inside the CALLER'S transaction: a failed journal append
// rolls the protective transition back too, so there is never a transition
// without a durable journal record (no false success).
//
// This is an adapter: it imports no module and is reachable only from modules,
// scripts and tests — never from client components. replayJournal is restore
// machinery: no runtime traffic path calls it; its writes replicate exactly
// the owning modules' own transitions (removeRoot/personalRemoval tombstones,
// withdraw's decision row, session expiry through the auth fence trigger) so
// the reconciled state is the state the owning modules would have produced.

export const PROTECTIVE_JOURNAL_SCHEMA_VERSION = 1;

const hex64 = z.string().regex(/^[0-9a-f]{64}$/u);
const eventArrays = {
  rootIds: z.array(uuid).max(1000),
  objectIds: z.array(uuid).max(100000),
  sessionIds: z.array(uuid).max(10000),
};

// Pinned event shape v1. Receipts are strictly content-free replay fields;
// z.strictObject rejects any additional key, so the journal cannot become a
// shadow content store.
const deletionReceipt = z.strictObject({ scope: z.enum(['root', 'personal']), commandKey: uuid.optional() });
const consentWithdrawalReceipt = z.strictObject({
  commandKey: uuid,
  configurationId: uuid,
  disclosureVersion: z.number().int().positive(),
  requestHash: hex64,
});
const sessionRevocationReceipt = z.strictObject({
  scope: z.enum(['sessions', 'all']),
  reason: z.enum(['operator', 'restore']).optional(),
});
// Fixture-only types (no live producer module yet): an empty receipt marked
// with the literal fixture flag. Replay records them without pretending any
// feature exists.
const fixtureReceipt = z.strictObject({ fixture: z.literal(true) });

export const protectiveEventSchema = z.discriminatedUnion('eventType', [
  z.strictObject({ eventType: z.literal('deletion'), ownerId: uuid, ...eventArrays, receipt: deletionReceipt }),
  z.strictObject({
    eventType: z.literal('consent-withdrawal'),
    ownerId: uuid,
    ...eventArrays,
    receipt: consentWithdrawalReceipt,
  }),
  z.strictObject({
    eventType: z.literal('session-revocation'),
    ownerId: uuid.nullable(),
    ...eventArrays,
    receipt: sessionRevocationReceipt,
  }),
  z.strictObject({ eventType: z.literal('role-revocation'), ownerId: uuid, ...eventArrays, receipt: fixtureReceipt }),
  z.strictObject({
    eventType: z.literal('enrollment-revocation'),
    ownerId: uuid,
    ...eventArrays,
    receipt: fixtureReceipt,
  }),
  z.strictObject({
    eventType: z.literal('publication-withdrawal'),
    ownerId: uuid,
    ...eventArrays,
    receipt: fixtureReceipt,
  }),
]);
export type ProtectiveEvent = z.infer<typeof protectiveEventSchema>;
export type ProtectiveEventType = ProtectiveEvent['eventType'];

type Inserted = { id: string; seq: number };
const INSERT = `INSERT INTO app.protective_journal(id,schema_version,event_type,owner_id,root_ids,object_ids,session_ids,receipt)
  VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING seq`;

function parseEvent(raw: ProtectiveEvent): ProtectiveEvent {
  try {
    return protectiveEventSchema.parse(raw);
  } catch (error) {
    if (error instanceof z.ZodError) fail('INVALID_INPUT');
    throw error;
  }
}

// Re-validate an exported row against the pinned event shape: only the event
// keys are checked (id/seq/recordedAt are transport fields), but any extra or
// malformed receipt key still fails closed.
function eventShapeOf(row: JournalExportRow): ProtectiveEvent {
  return parseEvent({
    eventType: row.eventType,
    ownerId: row.ownerId,
    rootIds: row.rootIds,
    objectIds: row.objectIds,
    sessionIds: row.sessionIds,
    receipt: row.receipt,
  } as unknown as ProtectiveEvent);
}

async function append(client: PoolClient, event: ProtectiveEvent): Promise<Inserted> {
  const parsed = parseEvent(event);
  const id = crypto.randomUUID();
  const rows = await client.query<{ seq: string }>(INSERT, [
    id,
    PROTECTIVE_JOURNAL_SCHEMA_VERSION,
    parsed.eventType,
    parsed.ownerId ?? null,
    parsed.rootIds,
    parsed.objectIds,
    parsed.sessionIds,
    JSON.stringify(parsed.receipt),
  ]);
  if (!rows.rows[0]) fail('RETRYABLE_FAILURE');
  return { id, seq: Number(rows.rows[0].seq) };
}

// Hook helpers (the exact call sites the merged S3/S9 modules gain via the
// integrator). Each runs inside the caller's open transaction.

export function journalDeletion(
  client: PoolClient,
  event: {
    ownerId: string;
    rootIds: string[];
    objectIds: string[];
    receipt: { scope: 'root' | 'personal'; commandKey?: string };
  },
) {
  return append(client, { sessionIds: [], ...event, eventType: 'deletion' });
}

export function journalConsentWithdrawal(
  client: PoolClient,
  event: {
    ownerId: string;
    sessionId: string;
    receipt: { commandKey: string; configurationId: string; disclosureVersion: number; requestHash: string };
  },
) {
  return append(client, {
    eventType: 'consent-withdrawal',
    ownerId: event.ownerId,
    rootIds: [],
    objectIds: [],
    sessionIds: [event.sessionId],
    receipt: event.receipt,
  });
}

export function journalSessionRevocation(
  client: PoolClient,
  event: {
    ownerId: string | null;
    sessionIds: string[];
    receipt: { scope: 'sessions' | 'all'; reason?: 'operator' | 'restore' };
  },
) {
  return append(client, { rootIds: [], objectIds: [], ...event, eventType: 'session-revocation' });
}

// Explicit adapter fixtures for the types without live modules (delivery-checks
// S13): they exercise append/completeness/replay interface behavior only and
// are always labeled synthetic. No feature implementation is pretended.
export function protectiveEventFixture(
  eventType: 'role-revocation' | 'enrollment-revocation' | 'publication-withdrawal',
  ownerId: string,
): ProtectiveEvent {
  return { eventType, ownerId, rootIds: [], objectIds: [], sessionIds: [], receipt: { fixture: true } };
}

export function journalFixtureEvent(client: PoolClient, event: ReturnType<typeof protectiveEventFixture>) {
  return append(client, event);
}

// The full ordered journal export (backup input). Rows are content-free.
export type JournalExportRow = {
  id: string;
  seq: number;
  schemaVersion: number;
  eventType: ProtectiveEventType;
  ownerId: string | null;
  rootIds: string[];
  objectIds: string[];
  sessionIds: string[];
  receipt: unknown;
  recordedAt: string;
};

type JournalDbRow = {
  id: string;
  seq: string;
  schema_version: number;
  event_type: ProtectiveEventType;
  owner_id: string | null;
  root_ids: string[];
  object_ids: string[];
  session_ids: string[];
  receipt: unknown;
  recorded_at: Date;
};

export function toExportRow(row: JournalDbRow): JournalExportRow {
  return {
    id: row.id,
    seq: Number(row.seq),
    schemaVersion: row.schema_version,
    eventType: row.event_type,
    ownerId: row.owner_id,
    rootIds: row.root_ids ?? [],
    objectIds: row.object_ids ?? [],
    sessionIds: row.session_ids ?? [],
    receipt: row.receipt ?? {},
    recordedAt: row.recorded_at.toISOString(),
  };
}

export async function readProtectiveJournal(client: PoolClient): Promise<JournalExportRow[]> {
  const rows = await client.query<JournalDbRow>(
    `SELECT id,seq,schema_version,event_type,owner_id,root_ids,object_ids,session_ids,receipt,recorded_at
     FROM app.protective_journal ORDER BY seq`,
  );
  return rows.rows.map(toExportRow);
}

// Canonical digest over the export: stable across processes so the backup
// manifest's cut (count + digest) can be re-proven at restore time.
export function journalDigest(rows: JournalExportRow[]): string {
  const hash = createHash('sha256');
  for (const row of rows) hash.update(canonical(row)).update('\n');
  return hash.digest('hex');
}

export type JournalExpectation = { cut: number; count: number; digest: string };

// Fail-closed completeness proof for the independent journal copy: exactly the
// contiguous sequence 1..cut, the expected count, the expected digest, and
// every row matching the pinned event shape. Any mismatch refuses the restore
// — a partial journal may name revocations the restored snapshot would
// otherwise resurrect, so it must never be replayed as if complete.
export function verifyJournalCompleteness(rows: JournalExportRow[], expected: JournalExpectation): void {
  // The cut's count and canonical digest prove the export is exactly the
  // journal content at cut time (any truncation, duplication or mutation
  // breaks the digest). Sequence values are required strictly increasing but
  // NOT contiguous: a rolled-back append burns a bigserial value, so gaps are
  // normal and must not fail an honest journal.
  if (expected.count === 0) {
    if (rows.length !== 0 || expected.cut !== 0 || journalDigest(rows) !== expected.digest)
      fail('RETRYABLE_FAILURE');
    return;
  }
  if (rows.length !== expected.count || expected.count < 1) fail('RETRYABLE_FAILURE');
  let previous = 0;
  for (const row of rows) {
    if (row.seq <= previous) fail('RETRYABLE_FAILURE');
    previous = row.seq;
    eventShapeOf(row);
  }
  if (rows[rows.length - 1].seq !== expected.cut) fail('RETRYABLE_FAILURE');
  if (journalDigest(rows) !== expected.digest) fail('RETRYABLE_FAILURE');
}

// Import the independently stored copy into the restored database. Rows the
// dump already contains replay as no-ops (same id → skipped); a seq collision
// with a DIFFERENT id is corruption and aborts the restore.
export async function importJournalRows(client: PoolClient, rows: JournalExportRow[]): Promise<number> {
  let imported = 0;
  for (const row of rows) {
    eventShapeOf(row);
    const inserted = await client.query(
      `INSERT INTO app.protective_journal(id,schema_version,event_type,owner_id,root_ids,object_ids,session_ids,receipt,recorded_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (id) DO NOTHING`,
      [
        row.id,
        row.schemaVersion,
        row.eventType,
        row.ownerId,
        row.rootIds,
        row.objectIds,
        row.sessionIds,
        JSON.stringify(row.receipt ?? {}),
        row.recordedAt,
      ],
    );
    imported += inserted.rowCount ?? 0;
  }
  return imported;
}

export type ReplaySummary = { reconciled: number; unchanged: number; fixtureNoOp: number; events: number };

// Restore-path reconciliation in seq order, idempotent by construction:
// pre-snapshot events already reflected in the dump converge to no-ops, while
// post-snapshot events re-apply the owning modules' protective transitions.
// Every statement is guarded (COALESCE, state checks) and nothing here can
// restore access — it can only deny.
export async function replayJournal(client: PoolClient, rows: JournalExportRow[]): Promise<ReplaySummary> {
  const summary: ReplaySummary = { reconciled: 0, unchanged: 0, fixtureNoOp: 0, events: rows.length };
  for (const row of rows) {
    const event = eventShapeOf(row);
    if (event.eventType === 'deletion') {
      // Mirror removeRoot/personalRemoval: tombstone the owner's roots (a
      // purged root never regresses to pending), invalidate the recorded
      // objects, cancel unfinished operations. Missing rows were already
      // purged before the snapshot — the restore cannot resurrect them.
      const roots = await client.query<{ id: string }>(
        `UPDATE app.lifecycle_root
         SET deleted_at=COALESCE(deleted_at,clock_timestamp()),generation=generation+1,
             cleanup_state=CASE WHEN cleanup_state='purged' THEN 'purged' ELSE 'pending' END
         WHERE id=ANY($1::uuid[]) AND owner_id=$2 RETURNING id`,
        [event.rootIds, event.ownerId],
      );
      await client.query(
        `UPDATE app.lifecycle_object o SET invalidated_at=COALESCE(o.invalidated_at,clock_timestamp())
         WHERE o.id=ANY($1::uuid[])
           AND EXISTS (SELECT 1 FROM app.lifecycle_root r WHERE r.id=o.root_id AND r.owner_id=$2)`,
        [event.objectIds, event.ownerId],
      );
      if (roots.rows.length) {
        await client.query(
          `UPDATE app.operation SET state='canceled',lease_until=NULL,updated_at=clock_timestamp()
           WHERE root_id=ANY($1::uuid[]) AND state IN ('queued','extracting','retryable-failed')`,
          [event.rootIds],
        );
        summary.reconciled += 1;
      } else {
        summary.unchanged += 1;
      }
    } else if (event.eventType === 'consent-withdrawal') {
      // Mirror withdraw: the restored snapshot must not resurrect consent that
      // was withdrawn after it was taken. A missing configuration row means
      // the restored schema cannot hold the decision — fail closed.
      const configuration = await client.query('SELECT 1 FROM app.processor_configuration WHERE id=$1', [
        event.receipt.configurationId,
      ]);
      if (!configuration.rowCount) fail('RETRYABLE_FAILURE');
      const inserted = await client.query(
        `INSERT INTO app.processing_decision(owner_id,command_key,configuration_id,disclosure_version,decision,request_hash,session_id)
         VALUES($1,$2,$3,$4,'withdrawn',$5,$6) ON CONFLICT (owner_id,command_key) DO NOTHING`,
        [
          event.ownerId,
          event.receipt.commandKey,
          event.receipt.configurationId,
          event.receipt.disclosureVersion,
          event.receipt.requestHash,
          event.sessionIds[0] ?? crypto.randomUUID(),
        ],
      );
      if (inserted.rowCount) summary.reconciled += 1;
      else summary.unchanged += 1;
    } else if (event.eventType === 'session-revocation') {
      // Sessions expire through the auth fence trigger, which bumps the
      // principal epoch and with it every queued job's authorization basis.
      const updated =
        event.receipt.scope === 'all'
          ? await client.query(
              'UPDATE auth.session SET "expiresAt"=clock_timestamp() WHERE "expiresAt">clock_timestamp()',
            )
          : await client.query(
              'UPDATE auth.session SET "expiresAt"=clock_timestamp() WHERE id=ANY($1::uuid[]) AND "expiresAt">clock_timestamp()',
              [event.sessionIds],
            );
      if (updated.rowCount) summary.reconciled += 1;
      else summary.unchanged += 1;
    } else {
      // Fixture types without live modules: recorded, never pretended.
      summary.fixtureNoOp += 1;
    }
  }
  return summary;
}

// ---- Independently stored journal copy -------------------------------------
//
// The database journal table alone cannot survive the disaster it protects
// against: an event appended AFTER a snapshot must be replailable even when
// the live database is gone. Deliveries therefore mirror every committed event
// to an independent store OUTSIDE the database (a content-free JSONL with its
// own completeness state under .local/, 0600, never committed). Delivery is
// best-effort and idempotent: a failed delivery is logged as pending and the
// next backup (or delivery) re-syncs the tail from the durable table, so a
// delivery failure never claims success and never loses an event that a
// backup later proves. The store is NOT the snapshot artifacts: snapshot
// expiry never deletes it (it is the continuation the next restore needs).

export const PROTECTIVE_JOURNAL_FILE = resolve('.local/protective-journal.jsonl');
export const PROTECTIVE_JOURNAL_STATE = resolve('.local/protective-journal-state.json');
// AD-4 content-free receipt ceiling (P7's 'protective-journal' 30-day class):
// delivered file segments older than this are pruned on delivery. The database
// table itself is append-only by trigger; its rows are the durability layer,
// the file is the independent copy.
const PRUNE_DAYS = 30;

export type JournalState = JournalExpectation & { schemaVersion: 1 };

type JournalStore = {
  /** False when neither file has ever been written. */
  present: boolean;
  /** null when the store exists but cannot be parsed — never trusted. */
  rows: JournalExportRow[] | null;
  state: JournalState | null;
};

async function readJournalStore(): Promise<JournalStore> {
  let state: JournalState | null = null;
  try {
    state = JSON.parse(await readFile(PROTECTIVE_JOURNAL_STATE, 'utf8')) as JournalState;
  } catch {
    state = null;
  }
  let text: string;
  try {
    text = await readFile(PROTECTIVE_JOURNAL_FILE, 'utf8');
  } catch {
    return { present: state !== null, rows: state ? null : [], state };
  }
  if (!state) return { present: true, rows: null, state: null };
  try {
    const rows = text
      .split('\n')
      .filter(line => line.trim())
      .map(line => JSON.parse(line) as JournalExportRow);
    return { present: true, rows, state };
  } catch {
    return { present: true, rows: null, state };
  }
}

async function writeJournalStore(rows: JournalExportRow[]): Promise<void> {
  await mkdir(resolve('.local'), { recursive: true, mode: 0o700 });
  const state: JournalState = {
    schemaVersion: 1,
    cut: rows.length ? rows[rows.length - 1].seq : 0,
    count: rows.length,
    digest: journalDigest(rows),
  };
  await writeFile(`${PROTECTIVE_JOURNAL_FILE}.tmp`, rows.map(row => JSON.stringify(row)).join('\n'), {
    mode: 0o600,
  });
  await rename(`${PROTECTIVE_JOURNAL_FILE}.tmp`, PROTECTIVE_JOURNAL_FILE);
  await writeFile(`${PROTECTIVE_JOURNAL_STATE}.tmp`, JSON.stringify(state), { mode: 0o600 });
  await rename(`${PROTECTIVE_JOURNAL_STATE}.tmp`, PROTECTIVE_JOURNAL_STATE);
}

// Mirrors every committed journal event into the independent store. Idempotent
// (already-delivered ids are skipped) and safe to run repeatedly; call it in
// its own transaction after a protective transition commits, and at every
// backup so the embedded copy heals any pending delivery.
export async function deliverPendingJournalEvents(client: PoolClient): Promise<number> {
  const committed = await readProtectiveJournal(client);
  const store = await readJournalStore();
  const delivered = new Set((store.rows ?? []).map(row => row.id));
  const merged = [...(store.rows ?? [])];
  let added = 0;
  for (const row of committed) {
    if (delivered.has(row.id)) continue;
    merged.push(row);
    added += 1;
  }
  if (added || !store.present) await writeJournalStore(merged);
  return added;
}

// AD-4 pruning of the independent copy: content-free segments older than the
// thirty-day ceiling leave the store. Returns the number of rows pruned.
export async function pruneProtectiveJournalFile(now = new Date()): Promise<number> {
  const store = await readJournalStore();
  if (!store.rows) return 0;
  const cutoff = now.getTime() - PRUNE_DAYS * 24 * 3600 * 1000;
  const kept = store.rows.filter(row => Date.parse(row.recordedAt) >= cutoff);
  if (kept.length === store.rows.length) return 0;
  await writeJournalStore(kept);
  return store.rows.length - kept.length;
}

export type JournalInput = { rows: JournalExportRow[]; source: 'independent' | 'embedded' };

// Restore-time journal resolution, fail-closed: prefer the independent store
// (it may contain post-snapshot events the embedded copy predates), require it
// to verify against its own completeness state AND to cover the embedded
// copy's prefix, and refuse the restore when completeness cannot be proved.
// A missing store with an empty embedded cut is a fresh system; falling back
// to the embedded copy alone is an explicit operator revalidation, because
// post-snapshot revocations would then be unknown.
export async function resolveJournalInput(
  embedded: JournalExportRow[],
  embeddedCut: JournalExpectation,
  options: { allowEmbeddedJournalFallback?: boolean } = {},
): Promise<JournalInput> {
  const store = await readJournalStore();
  const emptyEmbedded = embeddedCut.count === 0 && embedded.length === 0;
  if (!emptyEmbedded) verifyJournalCompleteness(embedded, embeddedCut);
  if (store.rows && store.state) {
    verifyJournalCompleteness(store.rows, store.state);
    if (embeddedCut.count > 0) {
      if (store.rows.length < embeddedCut.count) {
        console.error(JSON.stringify({ event: 'journal-store-shorter-than-snapshot' }));
        fail('RETRYABLE_FAILURE');
      }
      if (journalDigest(store.rows.slice(0, embeddedCut.count)) !== journalDigest(embedded)) {
        console.error(JSON.stringify({ event: 'journal-store-prefix-mismatch' }));
        fail('RETRYABLE_FAILURE');
      }
    }
    return { rows: store.rows, source: 'independent' };
  }
  if (emptyEmbedded) return { rows: embedded, source: 'embedded' };
  if (options.allowEmbeddedJournalFallback) {
    console.error(
      JSON.stringify({
        event: 'journal-embedded-fallback',
        note: 'Independent journal store unusable; restoring with snapshot-time coverage only. Post-snapshot revocations are unknown.',
      }),
    );
    return { rows: embedded, source: 'embedded' };
  }
  console.error(JSON.stringify({ event: 'journal-store-unusable', embeddedEvents: embeddedCut.count }));
  fail('RETRYABLE_FAILURE');
}
