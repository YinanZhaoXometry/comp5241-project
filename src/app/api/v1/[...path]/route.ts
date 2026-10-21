import { auth } from "../../../../modules/identity-access/auth";
import { upload, getStudy, listStudies, savePlan, confirmPlan } from "../../../../modules/materials-setup/service";
import { removeRoot } from "../../../../modules/lifecycle-platform/service";
import { authenticated, trustedMutation, jsonBody, safeFailure, privateHeaders, protectedResponse, uploadCommand } from "../../../../platform/http";
import { fail } from "../../../../platform/errors";
import { getOperation, getOriginal } from "../../../../modules/materials-setup/queries";
import type { SavePlan, Confirm, Command } from "../../../../contracts/setup";

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
        if (action === "material") return protectedResponse(identity, rootId, await getOriginal(identity, rootId), request.signal, true);
        const study = await getStudy(identity, rootId);
        if (!action) return protectedResponse(identity, rootId, study, request.signal);
        if (action === "text") return protectedResponse(identity, rootId, study.text ?? "", request.signal, true);
        if (action === "plan") return protectedResponse(identity, rootId, { draft: study.draft, confirmed: study.confirmed }, request.signal);
      }
      if (request.method === "POST") {
        const body = await jsonBody(request);
        const result = action === "plan" ? await savePlan(identity, rootId, body as SavePlan)
          : action === "confirmation" ? await confirmPlan(identity, rootId, body as Confirm)
          : action === "removal" ? await removeRoot(identity, rootId, body as Command) : null;
        if (result) return Response.json(result, { headers: privateHeaders });
      }
    }
    fail("FORBIDDEN_OR_NOT_FOUND");
  } catch (error) { return safeFailure(error); }
}
export const GET = handle;
export const POST = handle;