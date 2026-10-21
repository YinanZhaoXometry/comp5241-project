import { uuid, type Identity } from "../../contracts/setup";
import { transaction } from "../../adapters/postgres/database";
import { read } from "../../adapters/private-files";
import { authorize } from "../identity-access/access";
import { scopedRoot } from "../lifecycle-platform/repository";
import { operation } from "../lifecycle-platform/operations";
import { fail } from "../../platform/errors";
import { material, copyKey } from "./repository";
import { parse } from "./service";

export async function getOriginal(identity: Identity, rawId: string) {
  const rootId = parse(uuid, rawId);
  return transaction(async client => {
    await authorize(client, identity); await scopedRoot(client, identity.userId, rootId);
    return read(await copyKey(client, (await material(client, rootId)).original_id));
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