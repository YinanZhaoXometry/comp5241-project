import { createHash } from "node:crypto";
import { ZodError } from "zod";
import { commandSchema, savePlanSchema, confirmSchema, uuid, hasControl, type Command, type Identity, type SavePlan, type Confirm, type ExtractionJob } from "../../contracts/setup";
import { transaction } from "../../adapters/postgres/database";
import { enqueue } from "../../adapters/queue";
import * as files from "../../adapters/private-files";
import { authorize } from "../identity-access/access";
import * as lifecycle from "../lifecycle-platform/repository";
import { createOperation, operation } from "../lifecycle-platform/operations";
import { fail } from "../../platform/errors";
import * as repository from "./repository";

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
  return transaction(async client => {
    await authorize(client, identity);
    await lifecycle.scopedRoot(client, identity.userId, rootId);
    const item = await repository.material(client, rootId);
    const found = await client.query<{ id: string }>("SELECT id FROM app.operation WHERE root_id=$1", [rootId]);
    const status = await operation(client, found.rows[0].id);
    const text = item.extraction_id ? await files.read(await repository.copyKey(client, item.extraction_id)) : null;
    return { rootId, filename: item.filename, revision: item.revision, extractionId: item.extraction_id, text,
      draft: await repository.planRevision(client, item.draft_id), confirmed: await repository.planRevision(client, item.confirmed_id),
      operation: { id: status!.operationId, state: status!.state, pending: Date.now() - status!.createdAt.getTime() >= 120000 && ["queued", "extracting"].includes(status!.state) } };
  });
}
export async function listStudies(identity: Identity) {
  return transaction(async client => {
    await authorize(client, identity);
    const result = await client.query<{ rootId: string; filename: string; revision: number; state: string; confirmed: boolean; cleanupState: string }>(`SELECT r.id AS "rootId", COALESCE(m.filename,'Removed material') AS filename, COALESCE(m.revision,0) AS revision,
      CASE WHEN r.deleted_at IS NOT NULL THEN 'deleted' ELSE o.state END AS state,
      m.confirmed_id IS NOT NULL AS confirmed, r.cleanup_state AS "cleanupState"
      FROM app.lifecycle_root r LEFT JOIN app.material m ON m.id=r.id LEFT JOIN app.operation o ON o.root_id=r.id WHERE r.owner_id=$1 ORDER BY r.created_at DESC LIMIT 100`, [identity.userId]);
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
    const item = await repository.material(client, rootId);
    if (item.revision !== command.expectedRevision || item.extraction_id !== command.extractionId) fail("CONFLICT");
    const id = await lifecycle.registerObject(client, rootId, "plan", [command.extractionId]);
    await repository.insertPlan(client, id, rootId, command.extractionId, command.plan);
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
    const item = await repository.material(client, rootId);
    if (item.revision !== command.expectedRevision || item.draft_id !== command.planRevisionId) fail("CONFLICT");
    await repository.confirmRevision(client, rootId, command.planRevisionId);
    return lifecycle.receipt(client, identity, command, "confirm-plan", hash, { rootId, planRevisionId: command.planRevisionId, revision: item.revision + 1, state: "confirmed" });
  });
}
export type Study = Awaited<ReturnType<typeof getStudy>>;