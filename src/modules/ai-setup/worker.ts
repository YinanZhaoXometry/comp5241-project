import type { PgBoss } from "pg-boss";
import { AI_DRAFT_QUEUE, aiDraftJobSchema, type AiDraftJob } from "../../contracts/ai-setup";
import { textCompletionRequestSchema, type TextCompletionPort } from "../../contracts/ai-provider";
import { transaction } from "../../adapters/postgres/database";
import * as files from "../../adapters/private-files";
import { createLiveCompletion, AI_BUDGET } from "../../adapters/ai-live";
import { copyKey } from "../materials-setup/repository";
import { preferenceRow } from "../setup-preferences/repository";
import { settleDispatch } from "../processing-consent/service";
import { authorize } from "../identity-access/access";
import * as lifecycle from "../lifecycle-platform/repository";
import { errorCode } from "../../platform/errors";
import { buildDraftMessages, parseDraftOutput } from "./generation";
import * as repository from "./repository";

export { AI_DRAFT_QUEUE };

type Claim = { goal: string; topic: string; excerpts: { name: string; text: string }[]; admissionId: string };

// One attempt, no retry loops (mirroring the adapter's maxRetries: 0): the
// request row is the single durable record and lands in an honest terminal
// state on every path. The provider result is persisted ONLY after
// settleDispatch re-checked consent, withdrawal and lineage fences under the
// recorded identity — a rejected-late result is discarded, never stored.
export async function runAiDraft(job: AiDraftJob, completion?: () => TextCompletionPort | null): Promise<void> {
  const identity = { userId: job.ownerId, sessionId: job.sessionId };
  const failRequest = async (code: string) => {
    await transaction(client => repository.markFailed(client, job.requestId, code))
      .catch(() => console.error(JSON.stringify({ event: "ai-draft-terminal-pending", requestId: job.requestId })));
  };
  // Phase 1 — re-read the SAME pinned sources under the recorded owner. Any
  // fence (revoked session, deleted root, invalidated lineage) or an honest
  // unreadable source ends the request without a dispatch.
  let claim: Claim | null | "fenced";
  try {
    claim = await transaction(async client => {
      await authorize(client, identity);
      const request = await repository.draftById(client, identity.userId, job.requestId);
      if (!request || request.status !== "pending") return null; // already settled by a duplicate delivery
      await lifecycle.scopedRoot(client, identity.userId, job.rootId);
      const objectIds = request.object_ids ?? [];
      if (!(await lifecycle.objectsActive(client, identity.userId, objectIds))) return "fenced" as const;
      const preference = await preferenceRow(client, identity.userId);
      const excerpts = [];
      for (const extractionId of objectIds.slice(1)) {
        const found = await client.query<{ filename: string }>(
          "SELECT b.filename FROM app.selection_source s JOIN app.batch_slot b ON b.id=s.slot_id WHERE s.extraction_id=$1 ORDER BY b.position LIMIT 1",
          [extractionId],
        );
        excerpts.push({ name: found.rows[0]?.filename ?? "selected source", text: await files.readExtracted(await copyKey(client, extractionId)) });
      }
      return { goal: preference?.goal ?? "", topic: preference?.topic ?? "", excerpts, admissionId: request.admission_id };
    });
  } catch (error) {
    const code = errorCode(error);
    await failRequest(code === "UNAUTHENTICATED" || code === "FORBIDDEN_OR_NOT_FOUND" ? "rejected-late" : "processing-blocked");
    return;
  }
  if (claim === null) return;
  if (claim === "fenced") { await failRequest("rejected-late"); return; }
  // Phase 2 — one bounded completion through the injected port (production
  // default: the live owner-admitted endpoint; absent configuration fails
  // honestly as provider-unavailable).
  const port = completion ? completion() : await createLiveCompletion();
  if (!port) {
    console.error(JSON.stringify({ event: "ai-draft-provider-missing", requestId: job.requestId }));
    await failRequest("provider-unavailable");
    return;
  }
  const request = textCompletionRequestSchema.safeParse({ messages: buildDraftMessages(claim), maxOutputTokens: AI_BUDGET.maxOutputTokens });
  if (!request.success) { await failRequest("invalid-input"); return; }
  const outcome = await port.complete(request.data);
  if (!outcome.ok) { await failRequest(outcome.error.code); return; }
  const draft = parseDraftOutput(outcome.text);
  if (!draft.ok) { await failRequest("invalid-output"); return; }
  // Phase 3 — settlement before persistence: the existing machinery re-checks
  // everything; only an ACCEPTED settle may store the result and the ledger.
  try {
    const settled = await settleDispatch(identity, claim.admissionId);
    if (settled.outcome !== "accepted") { await failRequest("rejected-late"); return; }
    await transaction(async client => {
      await repository.markReady(client, job.requestId, draft.result, outcome.provenance.returnedModel, outcome.usage);
      await repository.insertLedger(client, job.ownerId, job.requestId, outcome.usage);
    });
  } catch (error) {
    const code = errorCode(error);
    await failRequest(code === "UNAUTHENTICATED" || code === "FORBIDDEN_OR_NOT_FOUND" ? "rejected-late" : "processing-blocked");
  }
}

// One-line worker registration for src/worker/main.ts, mirroring workExports:
// consumes the queue with single-job batches. The queue policy matches
// migrate.ts exactly (a mismatched createQueue would kill the worker at boot).
export async function workAiDrafts(boss: PgBoss, completion?: () => TextCompletionPort | null): Promise<void> {
  await boss.createQueue(AI_DRAFT_QUEUE, { retryLimit: 0, expireInSeconds: 120, retentionSeconds: 86400 });
  await boss.work<AiDraftJob>(AI_DRAFT_QUEUE, { batchSize: 1, pollingIntervalSeconds: 1 }, async jobs => {
    for (const job of jobs) {
      const envelope = aiDraftJobSchema.parse(job.data);
      if (envelope.requestId !== job.id) throw new Error("Invalid job identity");
      await runAiDraft(envelope, completion);
      console.log(JSON.stringify({ event: "ai-draft-processed", requestId: envelope.requestId }));
    }
  });
}
