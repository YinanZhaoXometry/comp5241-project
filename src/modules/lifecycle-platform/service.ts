import { transaction } from "../../adapters/postgres/database";
import * as files from "../../adapters/private-files";
import { transactionQueue, EXTRACTION_QUEUE, transactionDb } from "../../adapters/queue";
import { commandSchema, uuid, type Command, type Identity } from "../../contracts/setup";
import { authorize } from "../identity-access/access";
import { material, purgeMaterial } from "../materials-setup/repository";
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
    const item = await material(client, rootId);
    if (item.revision !== command.expectedRevision) fail("CONFLICT");
    await client.query("UPDATE app.lifecycle_root SET deleted_at=clock_timestamp(),generation=generation+1,cleanup_state='pending' WHERE id=$1", [rootId]);
    const jobs = await client.query<{ id: string }>("UPDATE app.operation SET state='canceled',lease_until=NULL,updated_at=clock_timestamp() WHERE root_id=$1 RETURNING id", [rootId]);
    for (const job of jobs.rows) await transactionQueue(client).cancel(EXTRACTION_QUEUE, job.id, { db: transactionDb(client) });
    return repository.receipt(client, identity, command, "delete", hash, { rootId, revision: item.revision + 1, state: "pending" });
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
    const copies = await client.query<{ storage_key: string | null }>("SELECT storage_key FROM app.lifecycle_object WHERE root_id=$1", [rootId]);
    for (const copy of copies.rows) if (copy.storage_key) await files.erase(copy.storage_key);
    await purgeMaterial(client, rootId);
    await client.query("DELETE FROM app.lifecycle_object WHERE root_id=$1", [rootId]);
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