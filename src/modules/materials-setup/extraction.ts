import { createHash } from "node:crypto";
import { transaction } from "../../adapters/postgres/database";
import * as files from "../../adapters/private-files";
import { extractDocument } from "../../adapters/document-extractor";
import { metadataSchema, reasons } from "../../contracts/documents";
import { uuid } from "../../contracts/setup";
import { authorize } from "../identity-access/access";
import * as lifecycle from "../lifecycle-platform/repository";
import { operation, operationIdentity, setOperation, failedOperation } from "../lifecycle-platform/operations";
import { errorCode, fail } from "../../platform/errors";
import * as repository from "./repository";
import { touchSource } from "./batches";

export async function runExtraction(operationId: string, extract?: (input: string) => Promise<string>) {
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
      await lifecycle.assertObjects(client, identity.userId, [material.original_id]);
      return { job, format: material.format, originalId: material.original_id, originalKey: await repository.copyKey(client, material.original_id) };
    });
    if (!claim) return;
    // No transaction, credentials or network in the isolated copier.
    const bytes = await files.readBinary(claim.originalKey);
    const result = extract ? { text: await extract(new TextDecoder("utf-8", { fatal: true }).decode(bytes)), metadata: metadataSchema.parse({ format: claim.format, parser: "bounded-documents-v2", warnings: [], locations: [{ unit: "lines", source: "UTF-8 source", first: 1, last: 1, start: 0, end: bytes.length }] }) } : await extractDocument(bytes, claim.format);
    const { text, metadata } = result;
    const stored = await files.storeExtracted(key!, text);
    await transaction(async client => {
      const principal = await authorize(client, identity, claim.job.epoch);
      const root = await lifecycle.scopedRoot(client, identity.userId, claim.job.rootId);
      const current = await operation(client, operationId);
      if (root.generation !== claim.job.generation || principal.epoch !== claim.job.epoch || !current || current.attemptId !== attemptId || current.state !== "extracting") fail("FORBIDDEN_OR_NOT_FOUND");
      const id = await lifecycle.registerObject(client, root.id, "extraction", [claim.originalId], key);
      await repository.insertExtraction(client, id, root.id, createHash("sha256").update(text).digest("hex"), metadata);
      if (stored.length > 0) await setOperation(client, operationId, "preview");
      await touchSource(client, root.id);
      await lifecycle.unstage(client, key!);
    });
  } catch (error) {
    const canceled = ["UNAUTHENTICATED", "FORBIDDEN_OR_NOT_FOUND"].includes(errorCode(error));
    const reason = typeof error === "object" && error !== null && "reason" in error && reasons.includes(error.reason as typeof reasons[number]) ? error.reason as typeof reasons[number] : "service";
    await failedOperation(operationId, attemptId, canceled, reason);
    if (!canceled && reason === "service") throw new Error("Extraction requires retry");
  } finally {
    if (key) await transaction(async client => {
      const exists = await client.query("SELECT 1 FROM app.lifecycle_object WHERE storage_key=$1", [key]);
      if (!exists.rowCount) await files.erase(key!);
      await lifecycle.unstage(client, key!);
    });
  }
}