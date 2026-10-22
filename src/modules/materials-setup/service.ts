import { createHash } from "node:crypto";
import { ZodError } from "zod";
import { commandSchema, savePlanSchema, confirmSchema, uuid, hasControl, type Command, type Identity, type SavePlan, type Confirm, type ExtractionJob } from "../../contracts/setup";
import { transaction } from "../../adapters/postgres/database";
import { enqueue } from "../../adapters/queue";
import * as files from "../../adapters/private-files";
import { authorize } from "../identity-access/access";
import * as lifecycle from "../lifecycle-platform/repository";
import { createOperation } from "../lifecycle-platform/operations";
import { fail } from "../../platform/errors";
import * as repository from "./repository";
import { preferenceRevision } from "./handoff";
import { getBatch, batchRow } from "./batches";

export function requestHash(value: unknown) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
export function parse<T>(parser: { parse: (value: unknown) => T }, value: unknown): T {
  try { return parser.parse(value); } catch (error) { if (error instanceof ZodError) fail("INVALID_INPUT"); throw error; }
}
export async function upload(identity: Identity, raw: Command, filename: string, input: ReadableStream<Uint8Array>) {
  const command = parse(commandSchema, raw);
  if (command.expectedRevision !== 0 || filename.length > 184 || !/\.txt$/iu.test(filename) || hasControl(filename) || /[/\\\t\r\n]/u.test(filename)) fail("INVALID_INPUT");
  const key = await transaction(async client => {
    const principal = await authorize(client, identity);
    if (principal.role !== "learner") fail("FORBIDDEN_OR_NOT_FOUND");
    const counts = await client.query<{ count: number }>("SELECT count(*)::int AS count FROM app.lifecycle_staging WHERE owner_id=$1", [identity.userId]);
    if (counts.rows[0].count >= 3) fail("RATE_LIMITED");
    return lifecycle.stage(client, identity.userId);
  });
  let committed = false;
  try {
    const stored = await files.store(key, input);
    const hash = requestHash({ command, filename, hash: stored.hash });
    return await transaction(async client => {
      const principal = await authorize(client, identity);
      const repeated = await lifecycle.replay(client, identity.userId, command, "upload", hash);
      if (repeated) return { receipt: repeated, inserted: false };
      const pending = await client.query<{ count: number }>("SELECT count(*)::int AS count FROM app.operation WHERE owner_id=$1 AND state IN ('queued','extracting')", [identity.userId]);
      if (pending.rows[0].count >= 10) fail("RATE_LIMITED");
      const rootId = crypto.randomUUID();
      await lifecycle.createRoot(client, identity.userId, rootId);
      const originalId = await lifecycle.registerObject(client, rootId, "original", [], key);
      await repository.createMaterial(client, rootId, filename, originalId, stored.length);
      await client.query("INSERT INTO app.study_batch(id) VALUES($1)", [rootId]);
      await client.query("INSERT INTO app.batch_slot(id,batch_id,position,root_id,filename,mime,format,byte_length) VALUES($1,$1,0,$1,$2,'text/plain','txt',$3)", [rootId, filename, stored.length]);
      const job: ExtractionJob = { schemaVersion: 1, operationId: crypto.randomUUID(), rootId, ownerId: identity.userId, sessionId: identity.sessionId, generation: 0, epoch: principal.epoch };
      await createOperation(client, job);
      await enqueue(client, job);
      const result = await lifecycle.receipt(client, identity, command, "upload", hash, { rootId, operationId: job.operationId, revision: 0 });
      await lifecycle.unstage(client, key);
      // This flag is set after transaction commit below, not before COMMIT.
      return { receipt: result, inserted: true };
    }).then(result => {
      committed = result.inserted;
      return result.receipt;
    });
  } finally {
    if (!committed) {
      // A lost COMMIT response is reconciled against the registered key before unlink.
      await transaction(async client => {
        const copy = await client.query("SELECT 1 FROM app.lifecycle_object WHERE storage_key=$1", [key]);
        if (!copy.rowCount) await files.erase(key);
        await lifecycle.unstage(client, key);
      });
    }
  }
}
export async function getStudy(identity: Identity, rawId: string) {
  const rootId = parse(uuid, rawId);
  const batch = await getBatch(identity, rootId);
  return transaction(async client => {
    await authorize(client, identity);
    await lifecycle.scopedRoot(client, identity.userId, rootId);
    await lifecycle.assertObjects(client, identity.userId, [batch.selection?.id, batch.draft?.id, batch.confirmed?.id].filter((id): id is string => !!id));
    const singleton = batch.slots.length === 1 && batch.slots[0].rootId === rootId;
    const source = batch.slots.find(slot => slot.extractionId && batch.selection?.sources.some(s => s.extractionId === slot.extractionId)) ?? batch.slots.find(slot => slot.extractionId);
    if (source?.extractionId) await lifecycle.assertObjects(client, identity.userId, [source.extractionId]);
    const text = singleton && source?.extractionId ? await files.readExtracted(await repository.copyKey(client, source.extractionId)) : null;
    // Only a singleton batch has one real operation row; multi-slot aggregate
    // state would be fictional, so consumers poll `slots` for those.
    const slot = batch.slots[0];
    const operation = singleton && slot.operationId ? { id: slot.operationId, state: slot.state, pending: slot.pending } : null;
    return { ...batch, extractionId: source?.extractionId ?? null, text, operation };
  });
}
export async function listStudies(identity: Identity) {
  return transaction(async client => {
    await authorize(client, identity);
    const result = await client.query<{ rootId: string; filename: string; revision: number; state: string; confirmed: boolean; cleanupState: string }>(`SELECT r.id AS "rootId", COALESCE((SELECT string_agg(s.filename,', ' ORDER BY position) FROM app.batch_slot s WHERE s.batch_id=b.id),'Removed material') AS filename,b.revision,
      CASE WHEN r.deleted_at IS NOT NULL THEN 'deleted' ELSE 'saved' END AS state,
      b.confirmed_id IS NOT NULL AS confirmed,r.cleanup_state AS "cleanupState"
      FROM app.lifecycle_root r JOIN app.study_batch b ON b.id=r.id WHERE r.owner_id=$1 ORDER BY r.created_at DESC LIMIT 100`, [identity.userId]);
    return result.rows;
  });
}
export async function savePlan(identity: Identity, rawId: string, raw: SavePlan) {
  const rootId = parse(uuid, rawId); const command = parse(savePlanSchema, raw);
  return transaction(async client => {
    await authorize(client, identity); await lifecycle.scopedRoot(client, identity.userId, rootId);
    const hash = requestHash({ rootId, command });
    const repeated = await lifecycle.replay(client, identity.userId, command, "save-plan", hash);
    if (repeated) return repeated;
    const item = await batchRow(client, rootId);
    if (item.revision !== command.expectedRevision || !item.selection_id || (command.selectionId !== item.selection_id && !(item.legacy && !command.selectionId))) fail("CONFLICT");
    const selection = await client.query("SELECT 1 FROM app.selection_revision s JOIN app.selection_source x ON x.selection_id=s.id WHERE s.id=$1 AND s.batch_id=$2 AND s.manifest_revision=$3 AND x.extraction_id=$4", [item.selection_id, rootId, item.manifest_revision, command.extractionId]);
    if (!selection.rowCount) fail("CONFLICT");
    await lifecycle.assertObjects(client, identity.userId, [item.selection_id]);
    const id = await lifecycle.registerObject(client, rootId, "plan", [item.selection_id]);
    // Record the preference revision this draft is saved against (P2 pin); a later
    // goal/topic change then conflicts when confirming this older draft.
    await repository.insertPlan(client, id, rootId, command.extractionId, command.plan, item.selection_id, await preferenceRevision(client, identity.userId));
    return lifecycle.receipt(client, identity, command, "save-plan", hash, { rootId, planRevisionId: id, revision: item.revision + 1 });
  });
}
export async function confirmPlan(identity: Identity, rawId: string, raw: Confirm) {
  const rootId = parse(uuid, rawId); const command = parse(confirmSchema, raw);
  return transaction(async client => {
    await authorize(client, identity); await lifecycle.scopedRoot(client, identity.userId, rootId);
    const hash = requestHash({ rootId, command });
    const repeated = await lifecycle.replay(client, identity.userId, command, "confirm-plan", hash);
    if (repeated) return repeated;
    const item = await batchRow(client, rootId);
    const draft = await repository.planRevision(client, item.draft_id);
    if (item.revision !== command.expectedRevision || item.draft_id !== command.planRevisionId || !item.selection_id || draft?.selectionId !== item.selection_id) fail("CONFLICT");
    // P2 pin: a goal/topic preference change after this draft was saved invalidates
    // confirming the older draft. Guarded both ways: drafts saved before the column
    // existed and owners without a preference row carry NULL and skip the check —
    // legacy history is never erased and stays confirmable.
    const recorded = (await client.query<{ preference_revision: number | null }>("SELECT preference_revision FROM app.plan_revision WHERE id=$1", [command.planRevisionId])).rows[0]?.preference_revision;
    const current = await preferenceRevision(client, identity.userId);
    if (recorded !== null && recorded !== undefined && current !== null && recorded !== current) fail("CONFLICT");
    await lifecycle.assertObjects(client, identity.userId, [command.planRevisionId]);
    await repository.confirmRevision(client, rootId, command.planRevisionId);
    return lifecycle.receipt(client, identity, command, "confirm-plan", hash, { rootId, planRevisionId: command.planRevisionId, revision: item.revision + 1, state: "confirmed" });
  });
}
export type Study = Awaited<ReturnType<typeof getStudy>>;