import type { PoolClient } from 'pg';
import type { Command, Identity, Receipt } from '../../contracts/setup';
import { fail } from '../../platform/errors';

export type Root = {
  id: string;
  owner_id: string;
  generation: number;
  deleted_at: Date | null;
  cleanup_state: string;
};
export async function scopedRoot(
  client: PoolClient,
  ownerId: string,
  rootId: string,
  includeDeleted = false,
) {
  const result = await client.query<Root>(
    'SELECT * FROM app.lifecycle_root WHERE id=$1 AND owner_id=$2 FOR UPDATE',
    [rootId, ownerId],
  );
  const root = result.rows[0];
  if (!root || (!includeDeleted && root.deleted_at))
    fail('FORBIDDEN_OR_NOT_FOUND');
  return root;
}
export async function createRoot(
  client: PoolClient,
  ownerId: string,
  rootId: string,
) {
  await client.query(
    'INSERT INTO app.lifecycle_root(id,owner_id) VALUES($1,$2)',
    [rootId, ownerId],
  );
}
export async function objectsActive(
  client: PoolClient,
  ownerId: string,
  ids: string[],
) {
  ids = [...new Set(ids)];
  if (!ids.length) return true;
  const result = await client.query<{ valid: boolean }>(
    `WITH RECURSIVE ancestors AS (
    SELECT * FROM app.lifecycle_object WHERE id=ANY($1::uuid[])
    UNION SELECT p.* FROM app.lifecycle_object p JOIN ancestors c ON p.id=ANY(c.parent_ids)
  ) SELECT (SELECT count(*) FROM app.lifecycle_object WHERE id=ANY($1::uuid[]))=cardinality($1::uuid[]) AND NOT EXISTS (
    SELECT 1 FROM ancestors a JOIN app.lifecycle_root r ON r.id=a.root_id WHERE r.owner_id<>$2 OR r.deleted_at IS NOT NULL OR a.invalidated_at IS NOT NULL
    OR EXISTS(SELECT 1 FROM unnest(a.parent_ids) parent WHERE NOT EXISTS(SELECT 1 FROM app.lifecycle_object p WHERE p.id=parent))
  ) AS valid`,
    [ids, ownerId],
  );
  return result.rows[0].valid;
}
export async function assertObjects(
  client: PoolClient,
  ownerId: string,
  ids: string[],
) {
  if (!(await objectsActive(client, ownerId, ids)))
    fail('FORBIDDEN_OR_NOT_FOUND');
}
export async function registerObject(
  client: PoolClient,
  rootId: string,
  kind: 'original' | 'extraction' | 'selection' | 'plan',
  parents: string[],
  key?: string,
) {
  const root = await client.query<Root>(
    'SELECT * FROM app.lifecycle_root WHERE id=$1 FOR UPDATE',
    [rootId],
  );
  if (!root.rows[0] || root.rows[0].deleted_at) fail('FORBIDDEN_OR_NOT_FOUND');
  await assertObjects(client, root.rows[0].owner_id, parents);
  const id = crypto.randomUUID();
  await client.query(
    'INSERT INTO app.lifecycle_object(id,root_id,kind,parent_ids,storage_key) VALUES($1,$2,$3,$4,$5)',
    [id, rootId, kind, parents, key ?? null],
  );
  return id;
}
export async function stage(client: PoolClient, ownerId: string) {
  const key = crypto.randomUUID();
  await client.query(
    'INSERT INTO app.lifecycle_staging(key,owner_id) VALUES($1,$2)',
    [key, ownerId],
  );
  return key;
}
export async function unstage(client: PoolClient, key: string) {
  await client.query('DELETE FROM app.lifecycle_staging WHERE key=$1', [key]);
}
export async function replay(
  client: PoolClient,
  ownerId: string,
  command: Command,
  action: string,
  hash: string,
): Promise<Receipt | undefined> {
  const found = await client.query<{
    action: string;
    request_hash: string;
    result: Receipt;
    root_id: string;
  }>('SELECT * FROM app.command_receipt WHERE owner_id=$1 AND command_key=$2', [
    ownerId,
    command.commandKey,
  ]);
  if (!found.rows[0]) return;
  if (found.rows[0].action !== action || found.rows[0].request_hash !== hash)
    fail('CONFLICT');
  await scopedRoot(client, ownerId, found.rows[0].root_id, action === 'delete');
  if (action !== 'delete')
    await assertObjects(
      client,
      ownerId,
      [
        found.rows[0].result.planRevisionId,
        found.rows[0].result.selectionId,
      ].filter((id): id is string => !!id),
    );
  return found.rows[0].result;
}
export async function receipt(
  client: PoolClient,
  identity: Identity,
  command: Command,
  action: string,
  hash: string,
  result: Receipt,
) {
  await client.query(
    'INSERT INTO app.command_receipt(owner_id,command_key,action,request_hash,root_id,result) VALUES($1,$2,$3,$4,$5,$6)',
    [identity.userId, command.commandKey, action, hash, result.rootId, result],
  );
  return result;
}
