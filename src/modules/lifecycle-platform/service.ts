import { transaction } from "../../adapters/postgres/database";
import type { PoolClient } from "pg";
import * as files from "../../adapters/private-files";
import { transactionQueue, EXTRACTION_QUEUE, transactionDb } from "../../adapters/queue";
import { commandSchema, uuid, type Command, type Identity } from "../../contracts/setup";
import { authorize } from "../identity-access/access";
import { purgeMaterial, purgeObjects } from "../materials-setup/repository";
import { touchSource } from "../materials-setup/batches";
import { parse, requestHash } from "../../platform/commands";
import { fail } from "../../platform/errors";
import { deliverPendingJournalEvents, journalDeletion } from "../../adapters/protected-journal";
import * as repository from "./repository";
import { failedOperation } from "./operations";
import { denyDerivatives, purgeDerivatives, type DeletionScope } from "./derivatives";
import {
  personalPreviewSchema,
  previewRequestSchema,
  previewRoot,
  previewPersonal,
  rootPreviewResponse,
  personalPreviewResponse,
  type DependencyPreview,
} from "./dependencies";

export async function removeRoot(identity: Identity, rawId: string, raw: Command) {
  const rootId = parse(uuid, rawId);
  const command = parse(commandSchema, raw);
  let scope: DeletionScope = { ownerId: identity.userId, rootIds: [rootId], objectIds: [], personal: false };
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
    const roots = await repository.relatedRoots(client, rootId);
    await client.query("UPDATE app.lifecycle_root SET deleted_at=COALESCE(deleted_at,clock_timestamp()),generation=generation+1,cleanup_state='pending' WHERE id=ANY($1::uuid[])", [roots]);
    const affected = await client.query<{ id: string }>(`WITH RECURSIVE affected AS (
      SELECT id FROM app.lifecycle_object WHERE root_id=ANY($1::uuid[])
      UNION SELECT c.id FROM app.lifecycle_object c JOIN affected a ON a.id=ANY(c.parent_ids)
    ) UPDATE app.lifecycle_object SET invalidated_at=clock_timestamp() WHERE id IN(SELECT id FROM affected) RETURNING id`, [roots]);
    scope = { ownerId: identity.userId, rootIds: roots, objectIds: affected.rows.map(row => row.id), personal: false };
    // S13 hook: journal the deletion atomically with the tombstone commit.
    await journalDeletion(client, {
      ownerId: identity.userId,
      rootIds: roots,
      objectIds: scope.objectIds,
      receipt: { scope: "root" },
    });
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
  // S13 hook: best-effort independent-store delivery (journal row is durable).
  try { await transaction(client => deliverPendingJournalEvents(client)); }
  catch { console.error(JSON.stringify({ event: "journal-delivery-pending", rootId })); }
  // Registered derivative ports deny before the accepted request returns. The
  // lineage invalidation above has already committed, so a failing port never
  // restores access; the reconciler retries port deny/purge until it succeeds.
  try { await transaction(client => denyDerivatives(client, scope)); }
  catch { console.error(JSON.stringify({ event: "derivative-deny-pending", rootId })); }
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
    await purgeDerivatives(client, { ownerId, rootIds: [rootId], objectIds: ids, personal: false });
    await client.query("DELETE FROM app.lifecycle_object WHERE id=ANY($1::uuid[])", [ids]);
    await client.query("UPDATE app.lifecycle_root SET cleanup_state='purged' WHERE id=$1", [rootId]);
  });
}

export const personalRemovalSchema = commandSchema;

export async function dependenciesPreview(identity: Identity, rawId: string | null, raw: unknown): Promise<DependencyPreview> {
  parse(previewRequestSchema, raw);
  return transaction(async client => {
    await authorize(client, identity);
    if (rawId === null) return personalPreview(identity, client);
    const rootId = parse(uuid, rawId);
    // A deleted root has nothing left to preview; the fence denies it.
    await repository.scopedRoot(client, identity.userId, rootId);
    const preview = await previewRoot(client, identity.userId, rootId);
    await repository.insertDeletionPreview(client, identity.userId, rootId, "root", preview.categories);
    return rootPreviewResponse(rootId, preview);
  });
}

// Shared by the dependencies route (personal scope) and the personal-removal
// preview body; journals content-free counts only.
async function personalPreview(identity: Identity, client: PoolClient) {
  const preview = await previewPersonal(client, identity.userId);
  await repository.insertDeletionPreview(client, identity.userId, null, "personal", preview.categories);
  return personalPreviewResponse(preview);
}

// Personal receipt: current protective state, content-free. "overdue" is
// derived at read time (visibility only); P7's scheduler owns enforcement and
// operator alerts. Nothing here ever restores access.
function personalReceipt(record: repository.DeletionRequestRecord) {
  const overdue = record.state === "pending" && record.deadline_at.getTime() <= Date.now();
  return {
    requestId: record.id,
    commandKey: record.command_key,
    state: record.state === "purged" ? "purged" : overdue ? "overdue" : "pending",
    acceptedAt: record.accepted_at.toISOString(),
    deadlineAt: record.deadline_at.toISOString(),
    purgedAt: record.purged_at?.toISOString() ?? null,
  };
}

export async function personalRemoval(identity: Identity, raw: unknown) {
  // U8 preview: same route, explicit preview body, no destructive effect and
  // no deletion record — the accepted delete needs a full command instead.
  if (personalPreviewSchema.safeParse(raw).success) {
    return transaction(async client => {
      await authorize(client, identity);
      return personalPreview(identity, client);
    });
  }
  const command = parse(personalRemovalSchema, raw);
  if (command.expectedRevision !== 0) fail("CONFLICT");
  const hash = requestHash({ personal: true, command });
  // Phase 1 commits the durable denial first: if the protective journal write
  // below fails, affected use stays denied and the client retries (U8).
  const denial = await transaction(async client => {
    await authorize(client, identity);
    const existing = await repository.deletionRequest(client, identity.userId, command.commandKey);
    if (existing) {
      if (existing.request_hash !== hash) fail("CONFLICT");
      return null;
    }
    const roots = (await client.query<{ id: string }>("SELECT id FROM app.lifecycle_root WHERE owner_id=$1 ORDER BY id FOR UPDATE", [identity.userId])).rows.map(row => row.id);
    const affected = await client.query<{ id: string }>(`WITH RECURSIVE affected AS (
      SELECT id FROM app.lifecycle_object WHERE root_id=ANY($1::uuid[])
      UNION SELECT c.id FROM app.lifecycle_object c JOIN affected a ON a.id=ANY(c.parent_ids)
    ) UPDATE app.lifecycle_object SET invalidated_at=COALESCE(invalidated_at,clock_timestamp()) WHERE id IN(SELECT id FROM affected) RETURNING id`, [roots]);
    // All-ancestor lineage fences stay authoritative: no owner-wide deletion
    // flag exists — only per-root tombstones plus object invalidation.
    await client.query("UPDATE app.lifecycle_root SET deleted_at=COALESCE(deleted_at,clock_timestamp()),generation=generation+1,cleanup_state=CASE WHEN cleanup_state='purged' THEN 'purged' ELSE 'pending' END WHERE owner_id=$1", [identity.userId]);
    const jobs = await client.query<{ id: string }>("UPDATE app.operation SET state='canceled',lease_until=NULL,updated_at=clock_timestamp() WHERE owner_id=$1 RETURNING id", [identity.userId]);
    for (const job of jobs.rows) await transactionQueue(client).cancel(EXTRACTION_QUEUE, job.id, { db: transactionDb(client) });
    await client.query("UPDATE app.batch_slot SET removed=true WHERE root_id=ANY($1::uuid[])", [roots]);
    for (const id of roots) await touchSource(client, id);
    // S13 hook: journal the personal deletion atomically with the durable denial.
    await journalDeletion(client, {
      ownerId: identity.userId,
      rootIds: roots,
      objectIds: affected.rows.map(row => row.id),
      receipt: { scope: "personal" },
    });
    const preview = await previewPersonal(client, identity.userId);
    return { id: crypto.randomUUID(), roots, objectIds: affected.rows.map(row => row.id), categories: preview.categories };
  });
  if (!denial) {
    const record = await transaction(client => repository.deletionRequest(client, identity.userId, command.commandKey));
    if (!record) fail("RETRYABLE_FAILURE");
    return personalReceipt(record);
  }
  try {
    await transaction(async client => {
      await repository.insertDeletionRequest(client, identity.userId, denial.id, command.commandKey, hash, denial.categories);
      await repository.insertDeletionPreview(client, identity.userId, null, "personal", denial.categories);
    });
  } catch {
    // Denial above is durable; the journal write failed, so surface the
    // retryable pending error instead of claiming the request was accepted.
    console.error(JSON.stringify({ event: "deletion-journal-pending" }));
    fail("RETRYABLE_FAILURE");
  }
  const scope: DeletionScope = { ownerId: identity.userId, rootIds: denial.roots, objectIds: denial.objectIds, personal: true };
  // S13 hook: best-effort independent-store delivery.
  try { await transaction(client => deliverPendingJournalEvents(client)); }
  catch { console.error(JSON.stringify({ event: "journal-delivery-pending", requestId: denial.id })); }
  try { await transaction(client => denyDerivatives(client, scope)); }
  catch { console.error(JSON.stringify({ event: "derivative-deny-pending", requestId: denial.id })); }
  try { await purgePersonal(identity.userId); } catch { /* Reconciler retries pending cleanup. */ }
  const record = await transaction(client => repository.deletionRequest(client, identity.userId, command.commandKey));
  if (!record) fail("RETRYABLE_FAILURE");
  return personalReceipt(record);
}

export async function purgePersonal(ownerId: string) {
  const pending = await transaction(client => client.query<{ id: string }>("SELECT id FROM app.lifecycle_root WHERE owner_id=$1 AND cleanup_state='pending'", [ownerId]));
  for (const root of pending.rows) await purgeRoot(ownerId, root.id);
}

// Marks a whole-personal deletion purged once every root is purged and every
// registered port has completed its idempotent deny/purge. Overdue visibility
// is derived at read time; enforcement/alerting is P7's scheduler.
async function completePersonalPurge(ownerId: string, requestId: string) {
  await transaction(async client => {
    const roots = (await client.query<{ id: string }>("SELECT id FROM app.lifecycle_root WHERE owner_id=$1 ORDER BY id FOR UPDATE", [ownerId])).rows.map(row => row.id);
    const request = await client.query<{ state: string }>("SELECT state FROM app.deletion_request WHERE id=$1 AND owner_id=$2 FOR UPDATE", [requestId, ownerId]);
    if (!request.rows[0] || request.rows[0].state === "purged") return;
    await denyDerivatives(client, { ownerId, rootIds: roots, objectIds: [], personal: true });
    const unpurged = (await client.query<{ count: number }>("SELECT count(*)::int AS count FROM app.lifecycle_root WHERE owner_id=$1 AND cleanup_state<>'purged'", [ownerId])).rows[0].count;
    if (unpurged) return;
    await purgeDerivatives(client, { ownerId, rootIds: roots, objectIds: [], personal: true });
    await repository.markDeletionPurged(client, requestId);
  });
}
export async function reconcileDeletions() {
  const pending = await transaction(client => client.query<{ id: string; owner_id: string }>("SELECT id,owner_id FROM app.deletion_request WHERE state='pending'"));
  for (const request of pending.rows) {
    try { await completePersonalPurge(request.owner_id, request.id); }
    catch { console.error(JSON.stringify({ event: "deletion-purge-pending", requestId: request.id })); }
  }
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
  await reconcileDeletions();
}
