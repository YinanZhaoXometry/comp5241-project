import { uuid, type Identity } from "../../contracts/setup";
import { transaction } from "../../adapters/postgres/database";
import { readBinary, readExtracted } from "../../adapters/private-files";
import { authorize } from "../identity-access/access";
import { scopedRoot, assertObjects } from "../lifecycle-platform/repository";
import { operation } from "../lifecycle-platform/operations";
import { fail } from "../../platform/errors";
import { material, copyKey } from "./repository";
import { parse } from "../../platform/commands";

export async function getOriginal(identity: Identity, rawId: string) {
  const rootId = parse(uuid, rawId);
  return transaction(async client => {
    await authorize(client, identity); await scopedRoot(client, identity.userId, rootId);
    const item = await material(client, rootId);
    await assertObjects(client, identity.userId, [item.original_id]);
    return { bytes: await readBinary(await copyKey(client, item.original_id)), objectId: item.original_id };
  });
}
export async function getPreview(identity: Identity, rawId: string, rawExtractionId: string) {
  const rootId = parse(uuid, rawId); const extractionId = parse(uuid, rawExtractionId);
  return transaction(async client => {
    await authorize(client, identity); await scopedRoot(client, identity.userId, rootId);
    await assertObjects(client, identity.userId, [extractionId]);
    const item = await material(client, rootId);
    if (item.extraction_id !== extractionId) fail("CONFLICT");
    return { rootId, extractionId, text: await readExtracted(await copyKey(client, extractionId)) };
  });
}
export async function getOperation(identity: Identity, rawId: string) {
  const operationId = parse(uuid, rawId);
  return transaction(async client => {
    await authorize(client, identity);
    const item = await operation(client, operationId);
    if (!item || item.ownerId !== identity.userId) fail("FORBIDDEN_OR_NOT_FOUND");
    await scopedRoot(client, identity.userId, item.rootId);
    return { operationId, rootId: item.rootId, state: item.state, pending: Date.now() - item.createdAt.getTime() >= 120000 && ["queued", "extracting"].includes(item.state) };
  });
}