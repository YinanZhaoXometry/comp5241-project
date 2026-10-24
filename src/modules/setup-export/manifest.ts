import type { PoolClient } from 'pg';
import {
  lifecycleCategories,
  type ExportCategory,
  type ManifestEntry,
  type SkippedCategory,
} from '../../contracts/export';

// The export snapshot is captured with the caller's single transaction: every
// SELECT below runs on one PoolClient inside one BEGIN/COMMIT window, so a
// concurrent edit either lands entirely before or entirely after the capture.
// File hashes are added later by the builder (storage objects are immutable),
// which keeps the transaction read-only and short.

export type CapturedFile = { objectId: string; key: string; category: 'originals' | 'extractions' };
export type CapturedPayload = { name: string; value: unknown };
export type Capture = {
  capturedAt: string;
  entries: ManifestEntry[];
  files: CapturedFile[];
  payloads: CapturedPayload[];
  objectIds: string[];
  skipped: SkippedCategory[];
};

type ObjectRow = {
  objectId: string;
  rootId: string;
  kind: 'original' | 'extraction' | 'selection' | 'plan';
  parents: string[];
  storageKey: string | null;
  createdAt: Date;
  metadata: unknown;
  textHash: string | null;
  excluded: unknown;
  manifestRevision: number | null;
  plan: unknown;
  extractionId: string | null;
  selectionId: string | null;
  fileName: string | null;
};

function iso(value: Date): string {
  return value.toISOString();
}

async function tableColumns(client: PoolClient, table: string): Promise<Set<string> | null> {
  const found = await client.query<{ column_name: string }>(
    "SELECT column_name FROM information_schema.columns WHERE table_schema='app' AND table_name=$1 ORDER BY ordinal_position",
    [table],
  );
  return found.rowCount ? new Set(found.rows.map((item) => item.column_name)) : null;
}

// Pinned derivative tables are enumerated by name and skipped with an honest
// label when the corresponding package has not landed in this deployment.
export async function captureManifest(
  client: PoolClient,
  ownerId: string,
): Promise<Capture> {
  const stamp = await client.query<{ now: Date }>('SELECT clock_timestamp() AS now');
  const capturedAt = iso(stamp.rows[0].now);
  const entries: ManifestEntry[] = [];
  const files: CapturedFile[] = [];
  const payloads: CapturedPayload[] = [];
  const skipped: SkippedCategory[] = [];

  const objects = await client.query<ObjectRow>(
    `SELECT o.id AS "objectId", o.root_id AS "rootId", o.kind, o.parent_ids AS parents, o.storage_key AS "storageKey",
      o.created_at AS "createdAt", e.metadata, e.text_hash AS "textHash",
      sr.excluded, sr.manifest_revision AS "manifestRevision",
      p.plan, p.extraction_id AS "extractionId", p.selection_id AS "selectionId",
      COALESCE(m.filename, s.filename) AS "fileName"
     FROM app.lifecycle_object o
     JOIN app.lifecycle_root r ON r.id = o.root_id
     LEFT JOIN app.extraction_revision e ON e.id = o.id
     LEFT JOIN app.selection_revision sr ON sr.id = o.id
     LEFT JOIN app.plan_revision p ON p.id = o.id
     LEFT JOIN app.material m ON m.id = o.root_id
     LEFT JOIN app.batch_slot s ON s.root_id = o.root_id
     WHERE r.owner_id=$1 AND r.deleted_at IS NULL AND o.invalidated_at IS NULL
       AND o.kind IN ('original','extraction','selection','plan')
     ORDER BY o.created_at, o.id`,
    [ownerId],
  );
  for (const item of objects.rows) {
    const base = {
      objectId: item.objectId,
      rootId: item.rootId,
      storageKey: item.storageKey,
      parents: item.parents ?? [],
      createdAt: iso(item.createdAt),
    };
    if (item.kind === 'original') {
      entries.push({ category: 'originals', fileName: item.fileName ?? undefined, ...base });
      if (item.storageKey) files.push({ objectId: item.objectId, key: item.storageKey, category: 'originals' });
    } else if (item.kind === 'extraction') {
      entries.push({ category: 'extractions', metadata: { metadata: item.metadata, textHash: item.textHash }, ...base });
      if (item.storageKey) files.push({ objectId: item.objectId, key: item.storageKey, category: 'extractions' });
    } else if (item.kind === 'selection') {
      entries.push({ category: 'selections', metadata: { manifestRevision: item.manifestRevision }, ...base });
      payloads.push({ name: `selections/${item.objectId}.json`, value: { excluded: item.excluded, manifestRevision: item.manifestRevision } });
    } else {
      entries.push({ category: 'plans', metadata: { extractionId: item.extractionId, selectionId: item.selectionId }, ...base });
      payloads.push({ name: `plans/${item.objectId}.json`, value: { plan: item.plan, extractionId: item.extractionId, selectionId: item.selectionId } });
    }
  }

  const confirmations = await client.query<{ planId: string; rootId: string; confirmedAt: Date }>(
    `SELECT pc.plan_id AS "planId", pc.root_id AS "rootId", pc.confirmed_at AS "confirmedAt"
     FROM app.plan_confirmation pc
     JOIN app.lifecycle_object lo ON lo.id = pc.plan_id
     JOIN app.lifecycle_root r ON r.id = lo.root_id
     WHERE r.owner_id=$1 AND lo.invalidated_at IS NULL AND r.deleted_at IS NULL
     ORDER BY pc.confirmed_at, pc.plan_id`,
    [ownerId],
  );
  for (const item of confirmations.rows) {
    entries.push({
      category: 'confirmations',
      objectId: item.planId,
      rootId: item.rootId,
      storageKey: null,
      parents: [item.planId],
      createdAt: iso(item.confirmedAt),
      metadata: { confirmedAt: iso(item.confirmedAt) },
    });
    payloads.push({ name: `confirmations/${item.planId}.json`, value: { rootId: item.rootId, confirmedAt: iso(item.confirmedAt) } });
  }

  await captureReceiptTable(client, ownerId, 'processing_decision', 'processing-decisions', 'processing/processing-decisions.json', { entries, payloads, skipped });
  await captureReceiptTable(client, ownerId, 'dispatch_admission', 'dispatch-admissions', 'processing/dispatch-admissions.json', { entries, payloads, skipped });
  await captureDiagnostics(client, ownerId, { entries, payloads, skipped });

  return {
    capturedAt,
    entries,
    files,
    payloads,
    objectIds: entries.filter((entry) => (lifecycleCategories as readonly string[]).includes(entry.category)).map((entry) => entry.objectId),
    skipped,
  };
}

type CaptureSink = { entries: ManifestEntry[]; payloads: CapturedPayload[]; skipped: SkippedCategory[] };

async function captureReceiptTable(
  client: PoolClient,
  ownerId: string,
  table: 'processing_decision' | 'dispatch_admission',
  category: ExportCategory,
  payloadName: string,
  sink: CaptureSink,
) {
  const columns = await tableColumns(client, table);
  if (!columns) {
    sink.skipped.push({ category, reason: `Table app.${table} is not present in this deployment` });
    return;
  }
  if (!columns.has('owner_id')) {
    sink.skipped.push({ category, reason: `Table app.${table} has no owner column; this export version cannot inventory it` });
    return;
  }
  const rows = await client.query<Record<string, unknown>>(
    `SELECT * FROM app.${table} WHERE owner_id=$1 ORDER BY 1 LIMIT 10000`,
    [ownerId],
  );
  for (const [index, item] of rows.rows.entries()) {
    sink.entries.push({
      category,
      objectId: typeof item.command_key === 'string' ? item.command_key : typeof item.id === 'string' ? item.id : `row-${index}`,
      rootId: typeof item.root_id === 'string' ? item.root_id : null,
      storageKey: null,
      parents: [],
      createdAt: item.created_at instanceof Date ? iso(item.created_at) : new Date(0).toISOString(),
      metadata: item,
    });
  }
  sink.payloads.push({ name: payloadName, value: { table: `app.${table}`, rows: rows.rows } });
}

const diagnosticTables = [
  { table: 'diagnostic_bundle', payload: 'diagnostics/diagnostic-bundles.json' },
  { table: 'diagnostic_item', payload: 'diagnostics/diagnostic-items.json' },
  { table: 'diagnostic_evidence', payload: 'diagnostics/diagnostic-evidence.json' },
] as const;

async function captureDiagnostics(client: PoolClient, ownerId: string, sink: CaptureSink) {
  const bundleColumns = await tableColumns(client, 'diagnostic_bundle');
  const bundleOwned = !!bundleColumns?.has('owner_id');
  const bundleIds = bundleOwned
    ? (await client.query<{ id: string }>('SELECT id FROM app.diagnostic_bundle WHERE owner_id=$1 ORDER BY 1 LIMIT 10000', [ownerId])).rows.map((item) => item.id)
    : [];
  for (const part of diagnosticTables) {
    const category: ExportCategory = 'diagnostic-evidence';
    const columns = await tableColumns(client, part.table);
    if (!columns) {
      sink.skipped.push({ category, reason: `Table app.${part.table} is not present in this deployment` });
      continue;
    }
    let rows: Record<string, unknown>[];
    if (columns.has('owner_id')) {
      rows = (await client.query<Record<string, unknown>>(`SELECT * FROM app.${part.table} WHERE owner_id=$1 ORDER BY 1 LIMIT 10000`, [ownerId])).rows;
    } else if (part.table !== 'diagnostic_bundle' && columns.has('bundle_id') && bundleIds.length) {
      rows = (await client.query<Record<string, unknown>>(`SELECT * FROM app.${part.table} WHERE bundle_id=ANY($1::uuid[]) ORDER BY 1 LIMIT 10000`, [bundleIds])).rows;
    } else {
      // The item-bank tables (answer ids, rationales, the bank itself) are not
      // owner content; owners receive their diagnostic evidence, not the key.
      sink.skipped.push({ category, reason: `Deliberately excluded: app.${part.table} holds the diagnostic item bank (answer keys and rationales), which is not owner content; owner diagnostic evidence is exported separately` });
      continue;
    }
    for (const [index, item] of rows.entries()) {
      sink.entries.push({
        category,
        objectId: typeof item.id === 'string' ? item.id : `row-${index}`,
        rootId: typeof item.root_id === 'string' ? item.root_id : null,
        storageKey: null,
        parents: typeof item.bundle_id === 'string' ? [item.bundle_id] : [],
        createdAt: item.created_at instanceof Date ? iso(item.created_at) : new Date(0).toISOString(),
        metadata: item,
      });
    }
    sink.payloads.push({ name: part.payload, value: { table: `app.${part.table}`, rows } });
  }
}

// Owner-scoped active counts for the pre-request category preview.
export async function activeCounts(client: PoolClient, ownerId: string) {
  const objects = await client.query<{ kind: string; count: number }>(
    `SELECT o.kind, count(*)::int AS count FROM app.lifecycle_object o
     JOIN app.lifecycle_root r ON r.id=o.root_id
     WHERE r.owner_id=$1 AND r.deleted_at IS NULL AND o.invalidated_at IS NULL
       AND o.kind IN ('original','extraction','selection','plan') GROUP BY o.kind`,
    [ownerId],
  );
  const confirmations = await client.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM app.plan_confirmation pc
     JOIN app.lifecycle_object lo ON lo.id = pc.plan_id
     JOIN app.lifecycle_root r ON r.id = lo.root_id
     WHERE r.owner_id=$1 AND lo.invalidated_at IS NULL AND r.deleted_at IS NULL`,
    [ownerId],
  );
  const byKind = new Map(objects.rows.map((item) => [item.kind, item.count]));
  return {
    originals: byKind.get('original') ?? 0,
    extractions: byKind.get('extraction') ?? 0,
    selections: byKind.get('selection') ?? 0,
    plans: byKind.get('plan') ?? 0,
    confirmations: confirmations.rows[0]?.count ?? 0,
  };
}

export async function tablePresent(client: PoolClient, table: string): Promise<boolean> {
  return !!(await tableColumns(client, table));
}
