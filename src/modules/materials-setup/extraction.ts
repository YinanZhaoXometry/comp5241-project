import { createHash } from "node:crypto";
import { transaction } from "../../adapters/postgres/database";
import * as files from "../../adapters/private-files";
import { extractTxt } from "../../adapters/txt-extractor";
import { uuid } from "../../contracts/setup";
import { authorize } from "../identity-access/access";
import * as lifecycle from "../lifecycle-platform/repository";
import { operation, operationIdentity, setOperation, failedOperation } from "../lifecycle-platform/operations";
import { errorCode, fail } from "../../platform/errors";
import * as repository from "./repository";

export async function runExtraction(operationId: string, extract: (input: string) => Promise<string> = extractTxt) {
  uuid.parse(operationId);
  const owner = await operationIdentity(operationId);
  if (!owner) return;
  const identity = { userId: owner.owner_id, sessionId: owner.session_id };
  let attemptId: string | undefined;
  let key: string | undefined;
  try {
    const claim = await transaction(async client => {
      const principal = await authorize(client, identity);
      const job = await operation(client, operationId);
      if (!job || ["preview", "canceled", "permanent-failed"].includes(job.state)) return;
      const root = await lifecycle.scopedRoot(client, identity.userId, job.rootId);
      if (root.generation !== job.generation || principal.epoch !== job.epoch) fail("FORBIDDEN_OR_NOT_FOUND");
      if (job.leaseUntil && job.leaseUntil.getTime() > Date.now()) return;
      attemptId = crypto.randomUUID();
      await setOperation(client, operationId, "extracting", attemptId);
      const material = await repository.material(client, job.rootId);
      key = await lifecycle.stage(client, identity.userId);
      return { job, originalId: material.original_id, originalKey: await repository.copyKey(client, material.original_id) };
    });
    if (!claim) return;
    // No transaction, credentials or network in the isolated copier.
    const text = await extract(await files.read(claim.originalKey));
    const stored = await files.store(key!, new Blob([text]).stream());
    await transaction(async client => {
      const principal = await authorize(client, identity, claim.job.epoch);
      const root = await lifecycle.scopedRoot(client, identity.userId, claim.job.rootId);
      const current = await operation(client, operationId);
      if (root.generation !== claim.job.generation || principal.epoch !== claim.job.epoch || !current || current.attemptId !== attemptId || current.state !== "extracting") fail("FORBIDDEN_OR_NOT_FOUND");
      const id = await lifecycle.registerObject(client, root.id, "extraction", [claim.originalId], key);
      await repository.insertExtraction(client, id, root.id, createHash("sha256").update(text).digest("hex"));
      if (stored.length > 0) await setOperation(client, operationId, "preview");
      await lifecycle.unstage(client, key!);
    });
  } catch (error) {
    const canceled = ["UNAUTHENTICATED", "FORBIDDEN_OR_NOT_FOUND"].includes(errorCode(error));
    await failedOperation(operationId, attemptId, canceled);
    if (!canceled) throw new Error("Extraction requires retry");
  } finally {
    if (key) await transaction(async client => {
      const exists = await client.query("SELECT 1 FROM app.lifecycle_object WHERE storage_key=$1", [key]);
      if (!exists.rowCount) await files.erase(key!);
      await lifecycle.unstage(client, key!);
    });
  }
}