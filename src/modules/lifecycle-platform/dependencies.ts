import { z } from 'zod';
import type { PoolClient } from 'pg';
import { tableReady, previewDerivatives, type DeletionScope, type PortCategory } from './derivatives';
import { relatedRoots } from './repository';

// S9 dependency preview: content-free per-category counts of everything an
// accepted deletion would revoke, shown before any destructive action with
// cancellation as the safe default (U8). Counts only — no material text,
// plan content or answer text is read, returned or journaled.

export const previewRequestSchema = z.strictObject({ schemaVersion: z.literal(1) });
export const personalPreviewSchema = z.strictObject({
  schemaVersion: z.literal(1),
  preview: z.literal(true),
});

export type DependencyCategory = PortCategory;
export type DependencyPreview = {
  scope: 'root' | 'personal';
  rootId: string | null;
  studies: number;
  categories: DependencyCategory[];
  deadlineDays: number;
  note: string;
};

const ROOT_NOTE =
  'Unrelated material roots and instructor-controlled records are not selected. Already downloaded bytes cannot be recalled.';
const PERSONAL_NOTE =
  'Every study under your account is selected; unrelated users and instructor-controlled records are not. Already downloaded bytes and prior disclosed external processing cannot be recalled. Active copies purge within seven days.';

// Transitive roots, then the recursive object set (A+B derivatives live on
// other roots but invalidate transitively through parent lineage).
async function affectedKinds(client: PoolClient, rootIds: string[]) {
  if (!rootIds.length) return new Map<string, number>();
  const kinds = await client.query<{ kind: string; count: number }>(
    `WITH RECURSIVE affected AS (
    SELECT * FROM app.lifecycle_object WHERE root_id=ANY($1::uuid[])
    UNION SELECT c.* FROM app.lifecycle_object c JOIN affected a ON a.id=ANY(c.parent_ids)
  ) SELECT kind,count(*)::int AS count FROM affected GROUP BY kind`,
    [rootIds],
  );
  return new Map(kinds.rows.map(row => [row.kind, row.count]));
}
async function affectedConfirmations(client: PoolClient, rootIds: string[]) {
  if (!rootIds.length) return 0;
  const rows = await client.query<{ count: number }>(
    `WITH RECURSIVE affected AS (
    SELECT id FROM app.lifecycle_object WHERE root_id=ANY($1::uuid[])
    UNION SELECT c.id FROM app.lifecycle_object c JOIN affected a ON a.id=ANY(c.parent_ids)
  ) SELECT count(*)::int AS count FROM app.plan_confirmation WHERE plan_id IN (SELECT id FROM affected)`,
    [rootIds],
  );
  return rows.rows[0].count;
}
async function affectedOperations(client: PoolClient, rootIds: string[]) {
  if (!rootIds.length) return 0;
  const rows = await client.query<{ count: number }>(
    "SELECT count(*)::int AS count FROM app.operation WHERE root_id=ANY($1::uuid[]) AND state IN ('queued','extracting','retryable-failed')",
    [rootIds],
  );
  return rows.rows[0].count;
}
// P1 pin: app.processing_decision / app.dispatch_admission, read-only here,
// guarded on absence because P1's migration is not on this branch.
async function ownerRecords(
  client: PoolClient,
  table: string,
  ownerId: string,
): Promise<number> {
  if (!(await tableReady(client, table, ['owner_id']))) return 0;
  const rows = await client.query<{ count: number }>(
    `SELECT count(*)::int AS count FROM ${table} WHERE owner_id=$1`,
    [ownerId],
  );
  return rows.rows[0].count;
}

async function categoriesFor(
  client: PoolClient,
  ownerId: string,
  rootIds: string[],
  personal: boolean,
): Promise<DependencyCategory[]> {
  const kinds = await affectedKinds(client, rootIds);
  const categories: DependencyCategory[] = [
    { key: 'studies', label: 'Material roots selected', count: rootIds.length },
    { key: 'originals', label: 'Original files', count: kinds.get('original') ?? 0 },
    { key: 'extractions', label: 'Extracted text revisions', count: kinds.get('extraction') ?? 0 },
    { key: 'selections', label: 'Acknowledged source selections', count: kinds.get('selection') ?? 0 },
    { key: 'plans', label: 'Manual plan revisions', count: kinds.get('plan') ?? 0 },
    { key: 'confirmations', label: 'Confirmed plans', count: await affectedConfirmations(client, rootIds) },
    { key: 'operations', label: 'Extraction operations to cancel', count: await affectedOperations(client, rootIds) },
  ];
  if (personal) {
    categories.push(
      {
        key: 'processing-decisions',
        label: 'Processing decisions',
        count: await ownerRecords(client, 'app.processing_decision', ownerId),
      },
      {
        key: 'dispatch-admissions',
        label: 'Dispatch admission receipts',
        count: await ownerRecords(client, 'app.dispatch_admission', ownerId),
      },
    );
  }
  const scope: DeletionScope = { ownerId, rootIds, objectIds: [], personal };
  categories.push(...(await previewDerivatives(client, scope)));
  return categories;
}

export async function previewRoot(client: PoolClient, ownerId: string, rootId: string) {
  // Same transitive set the deletion tombstones (root plus its batch's slots).
  const rootIds = await relatedRoots(client, rootId);
  return { rootIds, categories: await categoriesFor(client, ownerId, rootIds, false) };
}
export async function previewPersonal(client: PoolClient, ownerId: string) {
  const roots = await client.query<{ id: string }>(
    'SELECT id FROM app.lifecycle_root WHERE owner_id=$1',
    [ownerId],
  );
  const rootIds = roots.rows.map(row => row.id);
  return { rootIds, categories: await categoriesFor(client, ownerId, rootIds, true) };
}

export function rootPreviewResponse(rootId: string, preview: { rootIds: string[]; categories: DependencyCategory[] }): DependencyPreview {
  return {
    scope: 'root',
    rootId,
    studies: preview.rootIds.length,
    categories: preview.categories,
    deadlineDays: 7,
    note: ROOT_NOTE,
  };
}
export function personalPreviewResponse(preview: { rootIds: string[]; categories: DependencyCategory[] }): DependencyPreview {
  return {
    scope: 'personal',
    rootId: null,
    studies: preview.rootIds.length,
    categories: preview.categories,
    deadlineDays: 7,
    note: PERSONAL_NOTE,
  };
}
