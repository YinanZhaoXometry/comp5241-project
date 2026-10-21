import { commandSchema, MAX_BYTES, type Identity } from "../contracts/setup";
import { config } from "./config";
import { fail, errorCode, messages } from "./errors";
import { identify, authorize } from "../modules/identity-access/access";
import { transaction } from "../adapters/postgres/database";
import { scopedRoot } from "../modules/lifecycle-platform/repository";

export const privateHeaders = { "Cache-Control": "no-store, private", "X-Content-Type-Options": "nosniff", Vary: "Cookie" };
export function trustedMutation(request: Request) {
  if (request.headers.get("origin") !== config().origin || request.headers.get("sec-fetch-site") === "cross-site") fail("FORBIDDEN_OR_NOT_FOUND");
}
export async function jsonBody(request: Request): Promise<unknown> {
  if (!request.headers.get("content-type")?.startsWith("application/json")) fail("INVALID_INPUT");
  const reader = request.body?.getReader();
  if (!reader) fail("INVALID_INPUT");
  const chunks: Uint8Array[] = []; let length = 0;
  try {
    while (true) {
      const part = await reader.read(); if (part.done) break;
      length += part.value.length;
      if (length > 32768) { await reader.cancel(); fail("INVALID_INPUT"); }
      chunks.push(part.value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch { fail("INVALID_INPUT"); } finally { reader.releaseLock(); }
}
export function uploadCommand(request: Request) {
  const revision = request.headers.get("x-expected-revision");
  const parsed = commandSchema.safeParse({ schemaVersion: Number(request.headers.get("x-schema-version")), commandKey: request.headers.get("idempotency-key"), expectedRevision: revision === null ? NaN : Number(revision) });
  if (!parsed.success || !request.body || !request.headers.get("content-type")?.startsWith("text/plain")) fail("INVALID_INPUT");
  if (Number(request.headers.get("content-length")) > MAX_BYTES) fail("INVALID_INPUT");
  return parsed.data;
}
export function safeFailure(error: unknown, requestId = crypto.randomUUID()) {
  const code = errorCode(error);
  const statuses = { UNAUTHENTICATED: 401, FORBIDDEN_OR_NOT_FOUND: 404, INVALID_INPUT: 400, CONFLICT: 409, RATE_LIMITED: 429, RETRYABLE_FAILURE: 503 };
  return Response.json({ error: { code, message: messages[code], requestId, retryable: code === "RETRYABLE_FAILURE" || code === "RATE_LIMITED" } }, { status: statuses[code], headers: privateHeaders });
}
export async function authenticated(request: Request) {
  const identity = await identify(request.headers);
  await transaction(client => authorize(client, identity));
  return identity;
}
// The only streaming response path. Reauthorize every controlled 16KiB chunk;
// cancel stops transmission. Bytes already delivered cannot be recalled.
export function protectedResponse(identity: Identity, rootId: string, value: unknown, signal: AbortSignal, text = false) {
  const bytes = new TextEncoder().encode(text ? String(value) : JSON.stringify(value));
  let offset = 0;
  return new Response(new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        if (signal.aborted) { controller.close(); return; }
        await transaction(async client => { await authorize(client, identity); await scopedRoot(client, identity.userId, rootId); });
        if (offset >= bytes.length) { controller.close(); return; }
        controller.enqueue(bytes.slice(offset, offset + 16384)); offset += 16384;
      } catch { controller.error(new Error("This item is unavailable")); }
    },
  }, { highWaterMark: 0 }), { headers: { ...privateHeaders, "Content-Type": text ? "text/plain; charset=utf-8" : "application/json" } });
}