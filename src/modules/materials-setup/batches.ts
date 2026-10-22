import type { PoolClient } from "pg";
import { inputsSchema, selectionSchema, controlSchema, type InputsCommand, type SelectionCommand, type ControlCommand } from "../../contracts/batches";
import { commandSchema, uuid, type Command, type Identity, type ExtractionJob } from "../../contracts/setup";
import { documentFormat, type Format, type ExtractionMetadata, type ExtractionReason } from "../../contracts/documents";
import { transaction } from "../../adapters/postgres/database";
import * as files from "../../adapters/private-files";
import { enqueue, transactionQueue, transactionDb, EXTRACTION_QUEUE } from "../../adapters/queue";
import { authorize } from "../identity-access/access";
import * as lifecycle from "../lifecycle-platform/repository";
import { createOperation } from "../lifecycle-platform/operations";
import { parse, requestHash } from "../../platform/commands";
import { planRevision } from "./repository";
import { fail } from "../../platform/errors";

export type Batch = { id: string; revision: number; manifest_revision: number; selection_id: string | null; draft_id: string | null; confirmed_id: string | null; legacy: boolean };
export type Slot = { slotId: string; rootId: string; filename: string; mime: string; format: Format; byteLength: number; revision: number; state: string; extractionId: string | null; operationId: string | null; pending: boolean; reason: ExtractionReason | null; metadata: ExtractionMetadata | null };
export async function batchRow(client: PoolClient, id: string) {
  const found = await client.query<Batch>("SELECT * FROM app.study_batch WHERE id=$1 FOR UPDATE", [id]);
  if (!found.rows[0]) fail("FORBIDDEN_OR_NOT_FOUND"); return found.rows[0];
}
export async function slots(client: PoolClient, id: string) {
  const result = await client.query<Slot>(`SELECT s.id AS "slotId",s.root_id AS "rootId",s.filename,s.mime,s.format,s.byte_length AS "byteLength",
    CASE WHEN s.removed OR r.deleted_at IS NOT NULL THEN 'removed' ELSE COALESCE(o.state,'awaiting-upload') END AS state,
    CASE WHEN r.deleted_at IS NULL THEN m.extraction_id END AS "extractionId",o.id AS "operationId",o.failure_reason AS reason,e.metadata,COALESCE(m.revision,0) AS revision,
    COALESCE(clock_timestamp()-o.created_at>=interval '120 seconds' AND o.state IN ('queued','extracting'),false) AS pending
    FROM app.batch_slot s JOIN app.lifecycle_root r ON r.id=s.root_id LEFT JOIN app.material m ON m.id=s.root_id
    LEFT JOIN app.operation o ON o.root_id=s.root_id LEFT JOIN app.extraction_revision e ON e.id=m.extraction_id
    WHERE s.batch_id=$1 ORDER BY s.position`, [id]);
  return result.rows;
}
async function add(client: PoolClient, identity: Identity, id: string, inputs: InputsCommand["inputs"]) {
  const current = await slots(client, id);
  if (current.filter(s => s.state !== "removed").length + inputs.length > 10) fail("INVALID_INPUT");
  for (const [index, input] of inputs.entries()) {
    let format: Format;
    try { format = documentFormat(input.filename, input.mime); } catch { fail("INVALID_INPUT"); }
    if ((await client.query("SELECT 1 FROM app.batch_slot WHERE id=$1", [input.slotId])).rowCount) fail("CONFLICT");
    const rootId = crypto.randomUUID(); await lifecycle.createRoot(client, identity.userId, rootId);
    await client.query("INSERT INTO app.batch_slot(id,batch_id,position,root_id,filename,mime,format,byte_length) VALUES($1,$2,$3,$4,$5,$6,$7,$8)", [input.slotId, id, current.length + index, rootId, input.filename, input.mime, format, input.byteLength]);
  }
}
export async function createBatch(identity: Identity, raw: InputsCommand) {
  const command = parse(inputsSchema, raw); if (command.expectedRevision !== 0) fail("CONFLICT");
  return transaction(async client => {
    const principal = await authorize(client, identity); if (principal.role !== "learner") fail("FORBIDDEN_OR_NOT_FOUND");
    const hash = requestHash(command); const replay = await lifecycle.replay(client, identity.userId, command, "create-batch", hash); if (replay) return replay;
    const id = crypto.randomUUID(); await lifecycle.createRoot(client, identity.userId, id);
    await client.query("INSERT INTO app.study_batch(id) VALUES($1)", [id]); await add(client, identity, id, command.inputs);
    return lifecycle.receipt(client, identity, command, "create-batch", hash, { rootId: id, revision: 0 });
  });
}
export async function addInputs(identity: Identity, rawId: string, raw: InputsCommand) {
  const id = parse(uuid, rawId); const command = parse(inputsSchema, raw);
  return transaction(async client => {
    await authorize(client, identity); await lifecycle.scopedRoot(client, identity.userId, id);
    const hash = requestHash({ id, command }); const replay = await lifecycle.replay(client, identity.userId, command, "add-inputs", hash); if (replay) return replay;
    const batch = await batchRow(client, id); if (batch.revision !== command.expectedRevision) fail("CONFLICT");
    await add(client, identity, id, command.inputs); await touchManifest(client, id);
    return lifecycle.receipt(client, identity, command, "add-inputs", hash, { rootId: id, revision: batch.revision + 1 });
  });
}
export async function touchManifest(client: PoolClient, id: string) {
  await client.query("UPDATE app.study_batch SET revision=revision+1,manifest_revision=manifest_revision+1,selection_id=NULL WHERE id=$1", [id]);
}
export async function touchSource(client: PoolClient, rootId: string) {
  await client.query("UPDATE app.study_batch SET revision=revision+1,manifest_revision=manifest_revision+1,selection_id=NULL WHERE id IN (SELECT batch_id FROM app.batch_slot WHERE root_id=$1)", [rootId]);
}
export async function uploadSlot(identity: Identity, rawId: string, rawSlotId: string, raw: Command, input: ReadableStream<Uint8Array>) {
  const id = parse(uuid, rawId); const slotId = parse(uuid, rawSlotId); const command = parse(commandSchema, raw);
  if (command.expectedRevision !== 0) fail("CONFLICT");
  const key = await transaction(async client => {
    await authorize(client, identity); await lifecycle.scopedRoot(client, identity.userId, id);
    const current = (await slots(client, id)).find(s => s.slotId === slotId && s.state !== "removed"); if (!current) fail("FORBIDDEN_OR_NOT_FOUND");
    if ((await client.query("SELECT 1 FROM app.lifecycle_staging WHERE owner_id=$1", [identity.userId])).rowCount! >= 3) fail("RATE_LIMITED");
    return lifecycle.stage(client, identity.userId);
  });
  try {
    const stored = await files.storeBinary(key, input);
    return await transaction(async client => {
      const principal = await authorize(client, identity); await lifecycle.scopedRoot(client, identity.userId, id);
      const hash = requestHash({ id, slotId, command, hash: stored.hash }); const replay = await lifecycle.replay(client, identity.userId, command, "slot-upload", hash); if (replay) return replay;
      const slot = (await slots(client, id)).find(s => s.slotId === slotId); if (!slot || slot.state === "removed") fail("FORBIDDEN_OR_NOT_FOUND");
      await lifecycle.scopedRoot(client, identity.userId, slot.rootId);
      if (slot.state !== "awaiting-upload") fail("CONFLICT"); if (stored.length !== slot.byteLength) fail("INVALID_INPUT");
      // Same owner-level pending-extraction cap as the v1 singleton upload; the
      // per-batch ten-slot limit does not bound concurrent work across batches.
      const pending = await client.query<{ count: number }>("SELECT count(*)::int AS count FROM app.operation WHERE owner_id=$1 AND state IN ('queued','extracting')", [identity.userId]);
      if (pending.rows[0].count >= 10) fail("RATE_LIMITED");
      const original = await lifecycle.registerObject(client, slot.rootId, "original", [], key);
      await client.query("INSERT INTO app.material(id,filename,original_id,byte_length,format) VALUES($1,$2,$3,$4,$5)", [slot.rootId, slot.filename, original, stored.length, slot.format]);
      const job: ExtractionJob = { schemaVersion: 1, operationId: crypto.randomUUID(), rootId: slot.rootId, ownerId: identity.userId, sessionId: identity.sessionId, generation: 0, epoch: principal.epoch };
      await createOperation(client, job); await enqueue(client, job); await touchManifest(client, id); await lifecycle.unstage(client, key);
      return lifecycle.receipt(client, identity, command, "slot-upload", hash, { rootId: id, operationId: job.operationId, revision: (await batchRow(client, id)).revision });
    });
  } finally {
    await transaction(async client => {
      if (!(await client.query("SELECT 1 FROM app.lifecycle_object WHERE storage_key=$1", [key])).rowCount) await files.erase(key);
      await lifecycle.unstage(client, key);
    });
  }
}
export async function acknowledge(identity: Identity, rawId: string, raw: SelectionCommand) {
  const id = parse(uuid, rawId); const command = parse(selectionSchema, raw);
  return transaction(async client => {
    await authorize(client, identity); await lifecycle.scopedRoot(client, identity.userId, id);
    const hash = requestHash({ id, command }); const replay = await lifecycle.replay(client, identity.userId, command, "acknowledge", hash); if (replay) return replay;
    const batch = await batchRow(client, id); const current = (await slots(client, id)).filter(slot => slot.state !== "removed");
    if (batch.revision !== command.expectedRevision || current.length !== command.selected.length + command.excluded.length) fail("CONFLICT");
    for (const slot of current) {
      const selected = command.selected.find(s => s.slotId === slot.slotId);
      const excluded = command.excluded.find(s => s.slotId === slot.slotId);
      if (selected ? slot.state !== "preview" || selected.extractionId !== slot.extractionId : excluded?.state !== slot.state) fail("CONFLICT");
    }
    const selectionId = await lifecycle.registerObject(client, id, "selection", command.selected.map(s => s.extractionId));
    await client.query("INSERT INTO app.selection_revision(id,batch_id,manifest_revision,excluded) VALUES($1,$2,$3,$4)", [selectionId, id, batch.manifest_revision, JSON.stringify(command.excluded)]);
    for (const selected of command.selected) await client.query("INSERT INTO app.selection_source(selection_id,slot_id,root_id,extraction_id) VALUES($1,$2,$3,$4)", [selectionId, selected.slotId, current.find(s => s.slotId === selected.slotId)!.rootId, selected.extractionId]);
    await client.query("UPDATE app.study_batch SET selection_id=$2,revision=revision+1 WHERE id=$1", [id, selectionId]);
    return lifecycle.receipt(client, identity, command, "acknowledge", hash, { rootId: id, selectionId, revision: batch.revision + 1 });
  });
}
export async function getBatch(identity: Identity, rawId: string) {
  const id = parse(uuid, rawId);
  return transaction(async client => {
    await authorize(client, identity); await lifecycle.scopedRoot(client, identity.userId, id);
    const batch = await batchRow(client, id); const current = await slots(client, id);
    const selection = batch.selection_id && await lifecycle.objectsActive(client, identity.userId, [batch.selection_id]) ? (await client.query<{ id: string; excluded: SelectionCommand["excluded"] }>("SELECT id,excluded FROM app.selection_revision WHERE id=$1", [batch.selection_id])).rows[0] : null;
    const sources = selection ? (await client.query<{ slotId: string; rootId: string; extractionId: string }>('SELECT x.slot_id AS "slotId",x.root_id AS "rootId",x.extraction_id AS "extractionId" FROM app.selection_source x JOIN app.batch_slot s ON s.id=x.slot_id WHERE selection_id=$1 ORDER BY s.position', [selection.id])).rows : [];
    const draft = batch.draft_id && await lifecycle.objectsActive(client, identity.userId, [batch.draft_id]) ? await planRevision(client, batch.draft_id) : null;
    const confirmed = batch.confirmed_id && await lifecycle.objectsActive(client, identity.userId, [batch.confirmed_id]) ? await planRevision(client, batch.confirmed_id) : null;
    return { rootId: id, filename: current.map(s => s.filename).join(", "), revision: batch.revision, manifestRevision: batch.manifest_revision, slots: current, selection: selection ? { ...selection, sources } : null, draft, confirmed, needsAcknowledgment: !selection, legacy: batch.legacy };
  });
}
export async function controlSlot(identity: Identity, rawId: string, rawSlotId: string, raw: ControlCommand) {
  const id = parse(uuid, rawId); const slotId = parse(uuid, rawSlotId); const command = parse(controlSchema, raw);
  return transaction(async client => {
    const principal = await authorize(client, identity); await lifecycle.scopedRoot(client, identity.userId, id);
    const hash = requestHash({ id, slotId, command }); const replay = await lifecycle.replay(client, identity.userId, command, "control-slot", hash); if (replay) return replay;
    const batch = await batchRow(client, id); const slot = (await slots(client, id)).find(s => s.slotId === slotId);
    if (batch.revision !== command.expectedRevision) fail("CONFLICT"); if (!slot || slot.state === "removed") fail("FORBIDDEN_OR_NOT_FOUND");
    if (command.action === "remove") fail("INVALID_INPUT"); // Removal uses the root lifecycle command, including transitive purge.
    if (!slot.operationId || (command.action === "cancel" ? !["queued", "extracting", "retryable-failed"].includes(slot.state) : !["canceled", "retryable-failed", "permanent-failed"].includes(slot.state))) fail("CONFLICT");
    const root = await lifecycle.scopedRoot(client, identity.userId, slot.rootId);
    await client.query("UPDATE app.lifecycle_root SET generation=generation+1 WHERE id=$1", [slot.rootId]);
    if (command.action === "cancel") {
      await transactionQueue(client).cancel(EXTRACTION_QUEUE, slot.operationId, { db: transactionDb(client) });
      await client.query("UPDATE app.operation SET state='canceled',attempt_id=NULL,lease_until=NULL,updated_at=clock_timestamp() WHERE id=$1", [slot.operationId]);
    } else {
      await transactionQueue(client).deleteJob(EXTRACTION_QUEUE, slot.operationId, { db: transactionDb(client) });
      const job: ExtractionJob = { schemaVersion: 1, operationId: slot.operationId, rootId: slot.rootId, ownerId: identity.userId, sessionId: identity.sessionId, generation: root.generation + 1, epoch: principal.epoch };
      await client.query("UPDATE app.operation SET state='queued',generation=$2,session_id=$3,epoch=$4,attempt_id=NULL,lease_until=NULL,failure_reason=NULL,created_at=clock_timestamp(),updated_at=clock_timestamp() WHERE id=$1", [slot.operationId, job.generation, identity.sessionId, principal.epoch]);
      await enqueue(client, job);
    }
    await touchManifest(client, id);
    return lifecycle.receipt(client, identity, command, "control-slot", hash, { rootId: id, operationId: slot.operationId, revision: batch.revision + 1 });
  });
}