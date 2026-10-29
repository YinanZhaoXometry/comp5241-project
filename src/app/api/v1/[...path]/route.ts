import { auth } from "../../../../modules/identity-access/auth";
import { upload, getStudy, listStudies, savePlan, confirmPlan } from "../../../../modules/materials-setup/service";
import { removeRoot, dependenciesPreview, personalRemoval } from "../../../../modules/lifecycle-platform/service";
import { authenticated, trustedMutation, jsonBody, safeFailure, privateHeaders, protectedResponse, uploadCommand } from "../../../../platform/http";
import { fail } from "../../../../platform/errors";
import { getOperation, getOriginal, getPreview } from "../../../../modules/materials-setup/queries";
import { getHandoff } from "../../../../modules/materials-setup/handoff";
import { createBatch, addInputs, uploadSlot, acknowledge, controlSlot } from "../../../../modules/materials-setup/batches";
import { getDisclosure, decide, withdraw } from "../../../../modules/processing-consent/service";
import { getPreferences, savePreferences } from "../../../../modules/setup-preferences/service";
import { getCheckState, getBundleState, takeCheck, skipCheck, submitItem, finishCheck, flagUnclear } from "../../../../modules/setup-diagnostic/service";
import { listExports, requestExport, downloadExport } from "../../../../modules/setup-export/service";
import { requestAiDraft, getAiDraft, requestAiCheck } from "../../../../modules/ai-setup/service";
import { requestCourseGeneration, getCourse, submitRecall, submitPracticeCard, markItemDone, requestSupplements, getSupplements, requestWhyStep, getWhyState, getProvenance } from "../../../../modules/course-generation/service";
import { getAssessment, startTest, submitAttempt, startRetest, submitRetest, getSwitchDisclosure, switchCourseVersion, flagAssessmentItem } from "../../../../modules/assessment-progress/service";
import type { InputsCommand, SelectionCommand, ControlCommand } from "../../../../contracts/batches";
import type { SavePlan, Confirm, Command } from "../../../../contracts/setup";
import type { Decide, Withdraw } from "../../../../contracts/consent";
import type { SavePreferences } from "../../../../contracts/preferences";
import type { SubmitItem, FlagItem } from "../../../../contracts/diagnostic";

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
    if (path[0] === "studies" && path[2] === "course" && path[3] === "recall" && path.length === 4 && request.method === "POST") {
      return Response.json(await submitRecall(identity, path[1], await jsonBody(request)), { headers: privateHeaders });
    }
    // Epic-2 S5 per-card practice submission: one recall card of one ready
    // course version, with the learner-declared assisted flag. The canonical
    // answer and rationale are released only in this verb's typed feedback.
    if (path[0] === "studies" && path[2] === "course" && path[3] === "practice" && path.length === 4 && request.method === "POST") {
      return Response.json(await submitPracticeCard(identity, path[1], await jsonBody(request)), { headers: privateHeaders });
    }
    // Epic-2 S3 content-item tracker: explicit mark-done of ONE required item
    // of one ready course version (owner- and version-scoped, idempotent by
    // command envelope).
    if (path[0] === "studies" && path[2] === "course" && path[3] === "track" && path.length === 4 && request.method === "POST") {
      return Response.json(await markItemDone(identity, path[1], await jsonBody(request)), { headers: privateHeaders });
    }
    // Epic-2 S6 why exploration: GET serves one lesson's ladder of one ready
    // course version (?course=<uuid|version> optional selector, ?lesson=<0-7>
    // required); POST is the consent-gated "Go deeper" command. A request past
    // the server-computed evidence availability returns the honest exhaustion
    // verdict — 200 with zero dispatch — while an admitted step is 202.
    if (path[0] === "studies" && path[2] === "course" && path[3] === "why" && path.length === 4) {
      if (request.method === "GET") {
        const parameters = new URL(request.url).searchParams;
        const requested = parameters.get("course") ?? undefined;
        const lesson = parameters.get("lesson") ?? undefined;
        const why = await getWhyState(identity, path[1], requested, lesson);
        return protectedResponse(identity, path[1], why, request.signal, false, why.objectIds);
      }
      if (request.method === "POST") {
        const result = await requestWhyStep(identity, path[1], await jsonBody(request));
        return Response.json(result, { status: result.state === "exhausted" ? 200 : 202, headers: privateHeaders });
      }
    }
    if (path[0] === "studies" && path[2] === "check" && path.length >= 3 && path.length <= 5) {
      const rootId = path[1];
      if (path.length === 3 && request.method === "GET") return protectedResponse(identity, rootId, await getCheckState(identity, rootId), request.signal);
      if (path.length === 3 && request.method === "POST") return Response.json(await takeCheck(identity, rootId, await jsonBody(request) as Command), { headers: privateHeaders });
      if (path.length === 4 && path[3] === "skip" && request.method === "POST") return Response.json(await skipCheck(identity, rootId, await jsonBody(request) as Command), { headers: privateHeaders });
      if (path.length === 4 && request.method === "GET") return protectedResponse(identity, rootId, await getBundleState(identity, rootId, path[3]), request.signal);
      if (path.length === 5 && request.method === "POST") {
        const body = await jsonBody(request);
        const result = path[4] === "item" ? await submitItem(identity, rootId, path[3], body as SubmitItem)
          : path[4] === "finish" ? await finishCheck(identity, rootId, path[3], body as Command)
          : path[4] === "flag" ? await flagUnclear(identity, rootId, path[3], body as FlagItem) : null;
        if (result) return Response.json(result, { headers: privateHeaders });
      }
    }
    // Epic-3 story-1 scored-attempt tracer (shape of the check verbs above):
    // GET serves the owner-scoped assessment state (offered disclosure, open
    // attempt, graded result with history, derived roadmap node — never an
    // answer before that attempt is graded); POST starts (or re-offers) the
    // one required test; the submit verb grades the open attempt exactly
    // once against its at-start snapshot.
    if (path[0] === "studies" && path[2] === "assessment" && (path.length === 3 || (path.length === 5 && path[4] === "submit"))) {
      const rootId = path[1];
      if (path.length === 3 && request.method === "GET") {
        const assessment = await getAssessment(identity, rootId);
        return protectedResponse(identity, rootId, assessment, request.signal, false, assessment.objectIds);
      }
      if (path.length === 3 && request.method === "POST") return Response.json(await startTest(identity, rootId, await jsonBody(request) as Command), { headers: privateHeaders });
      if (request.method === "POST") return Response.json(await submitAttempt(identity, rootId, path[3], await jsonBody(request)), { headers: privateHeaders });
    }
    // Epic-3 story-2 targeted recovery: the retest verbs mirror the attempt
    // verbs above. POST starts a fresh same-demand retest of one
    // graded-failed attempt's declared open target groups (body names the
    // root attempt + target subset); the submit verb grades the open retest
    // exactly once, clearing each independently passing group in the same
    // transaction. The recovery ledger rides the existing assessment GET —
    // never an answer before that retest is graded.
    if (path[0] === "studies" && path[2] === "assessment" && path[3] === "retest" && (path.length === 4 || (path.length === 6 && path[5] === "submit"))) {
      const rootId = path[1];
      if (path.length === 4 && request.method === "POST") return Response.json(await startRetest(identity, rootId, await jsonBody(request)), { headers: privateHeaders });
      if (request.method === "POST") return Response.json(await submitRetest(identity, rootId, path[4], await jsonBody(request)), { headers: privateHeaders });
    }
    // Epic-3 story-4 explicit version switch (D1): GET serves the changed-
    // required-work disclosure between the studied release and the target
    // (?course=<uuid|version>, read-only); POST is the informed command —
    // the acknowledged change set must match the server-computed diff
    // exactly, and switching never erases prior awards.
    if (path[0] === "studies" && path[2] === "assessment" && path[3] === "switch" && path.length === 4) {
      const rootId = path[1];
      if (request.method === "GET") {
        const requested = new URL(request.url).searchParams.get("course") ?? undefined;
        const disclosure = await getSwitchDisclosure(identity, rootId, requested);
        return protectedResponse(identity, rootId, disclosure, request.signal, false, disclosure.objectIds);
      }
      if (request.method === "POST") return Response.json(await switchCourseVersion(identity, rootId, await jsonBody(request)), { headers: privateHeaders });
    }
    // Epic-3 story-5 evidence-linked guidance rides the assessment GET above
    // (no route of its own); the one-way unclear-item flag is the story's only
    // write: it records WITH the evidence and changes no outcome — Under-
    // review, pauses and corrections are entry 7's, not this verb's.
    if (path[0] === "studies" && path[2] === "assessment" && path[3] === "flag" && path.length === 4) {
      const rootId = path[1];
      if (request.method === "POST") return Response.json(await flagAssessmentItem(identity, rootId, await jsonBody(request)), { headers: privateHeaders });
    }
    if (path[0] === "studies" && path.length === 3 && path[2] === "dependencies" && request.method === "POST") {
      return Response.json(await dependenciesPreview(identity, path[1], await jsonBody(request)), { headers: privateHeaders });
    }
    if (path[0] === "studies" && path.length >= 2 && path.length <= 3) {
      const rootId = path[1]; const action = path[2];
      if (request.method === "GET") {
        if (action === "material") {
          const original = await getOriginal(identity, rootId);
          return protectedResponse(identity, rootId, original.bytes, request.signal, false, [original.objectId], true);
        }
        if (action === "handoff") {
          const handoff = await getHandoff(identity, rootId);
          return protectedResponse(identity, rootId, handoff, request.signal, false, handoff.objectIds);
        }
        const study = await getStudy(identity, rootId);
        const objects = [study.selection?.id, study.draft?.id, study.confirmed?.id, study.text !== null ? study.extractionId : null].filter((id): id is string => !!id);
        if (!action) return protectedResponse(identity, rootId, study, request.signal, false, objects);
        if (action === "text") return protectedResponse(identity, rootId, study.text ?? "", request.signal, true, objects);
        if (action === "plan") return protectedResponse(identity, rootId, { draft: study.draft, confirmed: study.confirmed }, request.signal, false, objects);
        if (action === "ai-draft") {
          const draft = await getAiDraft(identity, rootId);
          return protectedResponse(identity, rootId, draft, request.signal, false, draft.objectIds);
        }
        if (action === "ai-check") {
          const check = await getAiDraft(identity, rootId, "check");
          return protectedResponse(identity, rootId, check, request.signal, false, check.objectIds);
        }
        if (action === "course") {
          // Optional ?course=<uuid|version> resolves one specific ready
          // version (the prior-version read path); absent, the current view.
          const requested = new URL(request.url).searchParams.get("course") ?? undefined;
          const course = await getCourse(identity, rootId, requested);
          return protectedResponse(identity, rootId, course, request.signal, false, course.objectIds);
        }
        if (action === "supplements") {
          // Optional ?course=<uuid|version> mirrors the course read path: the
          // supplement state of one specific ready course version.
          const requested = new URL(request.url).searchParams.get("course") ?? undefined;
          const supplements = await getSupplements(identity, rootId, requested);
          return protectedResponse(identity, rootId, supplements, request.signal, false, supplements.objectIds);
        }
        if (action === "provenance") {
          // Epic-2 S7 versioned provenance handoff surface: optional
          // ?course=<uuid|version> pins one ready course version (immutable
          // block byte-stable across superseding revisions and derivative
          // growth); optional ?fields=<a,b> declares the consumer's intended
          // contract fields — a name outside the contract (answers, attempts)
          // is INVALID_INPUT before anything is read. EVERY value of a
          // repeated ?fields= parameter is joined into the declaration, so no
          // non-contract name can hide behind a first valid one.
          const parameters = new URL(request.url).searchParams;
          const requested = parameters.get("course") ?? undefined;
          const fieldValues = parameters.getAll("fields");
          const fields = fieldValues.length ? fieldValues.join(",") : undefined;
          const provenance = await getProvenance(identity, rootId, requested, fields);
          return protectedResponse(identity, rootId, provenance, request.signal, false, provenance.objectIds);
        }
      }
      if (request.method === "POST") {
        const body = await jsonBody(request);
        const result = action === "plan" ? await savePlan(identity, rootId, body as SavePlan)
          : action === "confirmation" ? await confirmPlan(identity, rootId, body as Confirm)
          : action === "removal" ? await removeRoot(identity, rootId, body as Command)
          : action === "ai-draft" ? await requestAiDraft(identity, rootId, body)
          : action === "ai-check" ? await requestAiCheck(identity, rootId, body)
          : action === "course" ? await requestCourseGeneration(identity, rootId, body)
          : action === "supplements" ? await requestSupplements(identity, rootId, body) : null;
        if (result) return Response.json(result, { status: action === "ai-draft" || action === "ai-check" || action === "course" || action === "supplements" ? 202 : 200, headers: privateHeaders });
      }
    }
    if (path[0] === "preferences" && path.length === 1) {
      if (request.method === "GET") return Response.json(await getPreferences(identity), { headers: privateHeaders });
      if (request.method === "PUT") return Response.json(await savePreferences(identity, await jsonBody(request) as SavePreferences), { headers: privateHeaders });
    }
    if (path[0] === "exports" && path.length === 1) {
      if (request.method === "GET") return Response.json(await listExports(identity), { headers: privateHeaders });
      if (request.method === "POST") return Response.json(await requestExport(identity, await jsonBody(request)), { status: 202, headers: privateHeaders });
    }
    if (path[0] === "exports" && path.length === 3 && path[2] === "download" && request.method === "GET") {
      // return await: a bare return would settle outside this try block, and
      // the denied download's rejection would escape safeFailure as a 500.
      return await downloadExport(identity, path[1], request.signal);
    }
    if (path[0] === "personal" && path.length === 2 && path[1] === "removal" && request.method === "POST") {
      return Response.json(await personalRemoval(identity, await jsonBody(request)), { headers: privateHeaders });
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
export const PUT = handle;