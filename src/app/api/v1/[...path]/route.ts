import { auth } from "../../../../modules/identity-access/auth";
import { upload, getStudy, listStudies, savePlan, confirmPlan } from "../../../../modules/materials-setup/service";
import { removeRoot } from "../../../../modules/lifecycle-platform/service";
import { authenticated, trustedMutation, jsonBody, safeFailure, privateHeaders, protectedResponse, uploadCommand } from "../../../../platform/http";
import { fail } from "../../../../platform/errors";
import { getOperation, getOriginal, getPreview } from "../../../../modules/materials-setup/queries";
import { createBatch, addInputs, uploadSlot, acknowledge, controlSlot } from "../../../../modules/materials-setup/batches";
import { getDisclosure, decide, withdraw } from "../../../../modules/processing-consent/service";
import type { InputsCommand, SelectionCommand, ControlCommand } from "../../../../contracts/batches";
import type { SavePlan, Confirm, Command } from "../../../../contracts/setup";
import type { Decide, Withdraw } from "../../../../contracts/consent";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
type Context = { params: Promise<{ path: string[] }> };
async function handle(request: Request, context: Context) {
  try {
    const { path } = await context.params;
    if (request.method !== "GET") trustedMutation(request);
    if (path[0] === "auth") {
      const action = path.slice(1).join("/");
      const allowed = request.method === "GET" ? ["get-session"] : ["sign-in/email", "sign-out", "get-session", "revoke-sessions"];
      if (!allowed.includes(action)) fail("FORBIDDEN_OR_NOT_FOUND");
      // Read-only session lookup bypasses rate-limit writes; POST endpoints retain
      // Better Auth's shared database limiter and origin protection.
      if (request.method === "GET") {
        const session = await auth().api.getSession({ headers: request.headers, query: { disableCookieCache: true } });
        return Response.json(session ? { user: { id: session.user.id, name: session.user.name }, needsRefresh: "needsRefresh" in session && session.needsRefresh } : null, { headers: privateHeaders });
      }
      const body = await jsonBody(request);
      const response = await auth().handler(new Request(request.url, { method: "POST", headers: request.headers, body: JSON.stringify(body) }));
      for (const [key, value] of Object.entries(privateHeaders)) response.headers.set(key, value);
      if (response.status === 429) fail("RATE_LIMITED");
      if (!response.ok && action === "sign-in/email") fail("UNAUTHENTICATED");
      if (response.ok && action === "sign-in/email") return Response.json({ ok: true }, { headers: response.headers });
      return response;
    }
    const identity = await authenticated(request);
    if (path[0] === "batches" && path.length === 1 && request.method === "POST") {
      return Response.json(await createBatch(identity, await jsonBody(request) as InputsCommand), { status: 201, headers: privateHeaders });
    }
    if (path[0] === "batches" && path.length === 3 && request.method === "POST") {
      const body = await jsonBody(request);
      const result = path[2] === "inputs" ? await addInputs(identity, path[1], body as InputsCommand)
        : path[2] === "selection" ? await acknowledge(identity, path[1], body as SelectionCommand) : null;
      if (result) return Response.json(result, { headers: privateHeaders });
    }
    if (path[0] === "batches" && path[2] === "slots" && path.length >= 4 && path.length <= 5 && request.method === "POST") {
      const result = path.length === 4 ? await uploadSlot(identity, path[1], path[3], uploadCommand(request, true), request.body!)
        : path[4] === "control" ? await controlSlot(identity, path[1], path[3], await jsonBody(request) as ControlCommand) : null;
      if (result) return Response.json(result, { status: path.length === 4 ? 202 : 200, headers: privateHeaders });
    }
    if (path[0] === "sources" && path.length === 3 && request.method === "GET") {
      const preview = await getPreview(identity, path[1], path[2]);
      return protectedResponse(identity, preview.rootId, preview, request.signal, false, [preview.extractionId]);
    }
    if (path[0] === "studies" && path.length === 1) {
      if (request.method === "GET") return Response.json(await listStudies(identity), { headers: privateHeaders });
      if (request.method === "POST") {
        const command = uploadCommand(request);
        let filename: string;
        try { filename = decodeURIComponent(request.headers.get("x-filename") ?? ""); } catch { fail("INVALID_INPUT"); }
        const receipt = await upload(identity, command, filename, request.body!);
        return Response.json(receipt, { status: 202, headers: privateHeaders });
      }
    }
    if (path[0] === "operations" && path.length === 2 && request.method === "GET") {
      const result = await getOperation(identity, path[1]);
      return protectedResponse(identity, result.rootId, result, request.signal);
    }
    if (path[0] === "studies" && path.length >= 2 && path.length <= 3) {
      const rootId = path[1]; const action = path[2];
      if (request.method === "GET") {
        if (action === "material") {
          const original = await getOriginal(identity, rootId);
          return protectedResponse(identity, rootId, original.bytes, request.signal, false, [original.objectId], true);
        }
        const study = await getStudy(identity, rootId);
        const objects = [study.selection?.id, study.draft?.id, study.confirmed?.id, study.text !== null ? study.extractionId : null].filter((id): id is string => !!id);
        if (!action) return protectedResponse(identity, rootId, study, request.signal, false, objects);
        if (action === "text") return protectedResponse(identity, rootId, study.text ?? "", request.signal, true, objects);
        if (action === "plan") return protectedResponse(identity, rootId, { draft: study.draft, confirmed: study.confirmed }, request.signal, false, objects);
      }
      if (request.method === "POST") {
        const body = await jsonBody(request);
        const result = action === "plan" ? await savePlan(identity, rootId, body as SavePlan)
          : action === "confirmation" ? await confirmPlan(identity, rootId, body as Confirm)
          : action === "removal" ? await removeRoot(identity, rootId, body as Command) : null;
        if (result) return Response.json(result, { headers: privateHeaders });
      }
    }
    if (path[0] === "processing" && path.length === 1 && request.method === "GET") {
      return Response.json(await getDisclosure(identity), { headers: privateHeaders });
    }
    if (path[0] === "processing" && path.length === 2 && request.method === "POST") {
      const body = await jsonBody(request);
      const result = path[1] === "decision" ? await decide(identity, body as Decide)
        : path[1] === "withdrawal" ? await withdraw(identity, body as Withdraw) : null;
      if (result) return Response.json(result, { headers: privateHeaders });
    }
    fail("FORBIDDEN_OR_NOT_FOUND");
  } catch (error) { return safeFailure(error); }
}
export const GET = handle;
export const POST = handle;