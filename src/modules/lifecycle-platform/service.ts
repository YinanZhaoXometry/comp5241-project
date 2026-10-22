import { transaction } from "../../adapters/postgres/database";
import * as files from "../../adapters/private-files";
import { transactionQueue, EXTRACTION_QUEUE, transactionDb } from "../../adapters/queue";
import { commandSchema, uuid, type Command, type Identity } from "../../contracts/setup";
import { authorize } from "../identity-access/access";
import { purgeMaterial, purgeObjects } from "../materials-setup/repository";
import { touchSource } from "../materials-setup/batches";
import { parse, requestHash } from "../materials-setup/service";
import { fail } from "../../platform/errors";
import * as repository from "./repository";
import { failedOperation } from "./operations";

export async function removeRoot(identity: Identity, rawId: string, raw: Command) {
  const rootId = parse(uuid, rawId);
  const command = parse(commandSchema, raw);
  const result = await transaction(async client => {
    await authorize(client, identity);
    const root = await repository.scopedRoot(client, identity.userId, rootId, true);
    const hash = requestHash({ rootId, command });
    const repeated = await repository.replay(client, identity.userId, command, "delete", hash);
    if (repeated) return repeated;
    if (root.deleted_at) fail("CONFLICT");
    const batch = await client.query<{ revision: number }>("SELECT revision FROM app.study_batch WHERE id=$1", [rootId]);
    const item = batch.rows[0] ?? (await client.query<{ revision: number }>("SELECT revision FROM app.material WHERE id=$1", [rootId])).rows[0] ?? { revision: 0 };
    if (item.revision !== command.expectedRevision) fail("CONFLICT");
    const roots = [rootId, ...(await client.query<{ root_id: string }>("SELECT root_id FROM app.batch_slot WHERE batch_id=$1 AND root_id<>$1", [rootId])).rows.map(row => row.root_id)];
    await client.query("UPDATE app.lifecycle_root SET deleted_at=COALESCE(deleted_at,clock_timestamp()),generation=generation+1,cleanup_state='pending' WHERE id=ANY($1::uuid[])", [roots]);
    await client.query(`WITH RECURSIVE affected AS (
      SELECT id FROM app.lifecycle_object WHERE root_id=ANY($1::uuid[])
      UNION SELECT c.id FROM app.lifecycle_object c JOIN affected a ON a.id=ANY(c.parent_ids)
    ) UPDATE app.lifecycle_object SET invalidated_at=clock_timestamp() WHERE id IN(SELECT id FROM affected)`, [roots]);
    await client.query("UPDATE app.batch_slot SET removed=true WHERE root_id=ANY($1::uuid[])", [roots]);
    for (const id of roots) await touchSource(client, id);
    const jobs = await client.query<{ id: string }>("UPDATE app.operation SET state='canceled',lease_until=NULL,updated_at=clock_timestamp() WHERE root_id=ANY($1::uuid[]) RETURNING id", [roots]);
    for (const job of jobs.rows) await transactionQueue(client).cancel(EXTRACTION_QUEUE, job.id, { db: transactionDb(client) });
    // touchSource runs once per slot root, so the pre-loop revision undershoots
    // by N; re-read the affected batch (the deleted batch root, or the parent
    // batch of a deleted slot material) so the token matches its final value.
    const final = await client.query<{ revision: number }>("SELECT revision FROM app.study_batch WHERE id=$1 OR id IN (SELECT batch_id FROM app.batch_slot WHERE root_id=$1) ORDER BY id<>$1 LIMIT 1", [rootId]);
    const revision = final.rows[0]?.revision ?? item.revision + 1;
    return repository.receipt(client, identity, command, "delete", hash, { rootId, revision, state: "pending" });
  });
  // Revocation is already durable. Cleanup failure must not restore access.
  try { await purgeRoot(identity.userId, rootId); } catch { /* Worker retries registered pending cleanup. */ }
  return result;
}

export async function purgeRoot(ownerId: string, rootId: string) {
  await transaction(async client => {
    const root = await repository.scopedRoot(client, ownerId, rootId, true);
    if (!root.deleted_at || root.cleanup_state === "purged") return;
    // A crash can leave an owner's unregistered output under a staging lease.
    // Without root-level staging lineage, conservatively remain pending rather
    // than claim every copy is erased. Other roots remain readable/usable.
    if ((await client.query("SELECT 1 FROM app.lifecycle_staging WHERE owner_id=$1 LIMIT 1", [ownerId])).rowCount) return;
    const copies = await client.query<{ id: string; storage_key: string | null }>(`WITH RECURSIVE affected AS (
      SELECT * FROM app.lifecycle_object WHERE root_id=$1
      UNION SELECT c.* FROM app.lifecycle_object c JOIN affected a ON a.id=ANY(c.parent_ids)
    ) SELECT id,storage_key FROM affected`, [rootId]);
    for (const copy of copies.rows) if (copy.storage_key) await files.erase(copy.storage_key);
    const ids = copies.rows.map(row => row.id);
    await purgeObjects(client, ids);
    await purgeMaterial(client, rootId);
    await client.query("DELETE FROM app.lifecycle_object WHERE id=ANY($1::uuid[])", [ids]);
    await client.query("UPDATE app.lifecycle_root SET cleanup_state='purged' WHERE id=$1", [rootId]);
  });
}

export async function reconcileCopies() {
  const pending = await transaction(client => client.query<{ id: string; owner_id: string }>("SELECT id,owner_id FROM app.lifecycle_root WHERE cleanup_state='pending'"));
  for (const root of pending.rows) {
    try { await purgeRoot(root.owner_id, root.id); }
    catch { console.error(JSON.stringify({ event: "purge-pending", rootId: root.id })); }
  }
  const staged = await transaction(client => client.query<{ key: string }>("SELECT key FROM app.lifecycle_staging WHERE lease_until<clock_timestamp()"));
  for (const copy of staged.rows) {
    try { await transaction(async client => {
      if (!(await client.query("SELECT 1 FROM app.lifecycle_staging WHERE key=$1 AND lease_until<clock_timestamp() FOR UPDATE SKIP LOCKED", [copy.key])).rowCount) return;
      const registered = await client.query("SELECT 1 FROM app.lifecycle_object WHERE storage_key=$1", [copy.key]);
      if (!registered.rowCount) await files.erase(copy.key);
      await repository.unstage(client, copy.key);
    }); } catch { console.error(JSON.stringify({ event: "staging-cleanup-pending" })); }
  }
  // A killed process never runs its catch. Reconcile the durable queue's terminal
  // result after supervision instead of advertising an extraction forever.
  const unfinished = await transaction(client => client.query<{ id: string; attempt_id: string | null }>("SELECT id,attempt_id FROM app.operation WHERE state IN ('queued','extracting','retryable-failed')"));
  for (const item of unfinished.rows) {
    const job = await transaction(client => transactionQueue(client).getJobById(EXTRACTION_QUEUE, item.id, { db: transactionDb(client) }));
    if (!job || job.state === "failed" || job.state === "cancelled") await failedOperation(item.id, item.attempt_id ?? undefined, job?.state === "cancelled");
  }
}