import type { PgBoss } from "pg-boss";
import { COURSE_QUEUE, courseJobSchema, courseContentSchema, type CourseJob } from "../../contracts/courses";
import { textCompletionRequestSchema, type TextCompletionPort } from "../../contracts/ai-provider";
import type { Plan } from "../../contracts/setup";
import { transaction } from "../../adapters/postgres/database";
import * as files from "../../adapters/private-files";
import { AI_BUDGET } from "../../adapters/ai-live";
import { copyKey, planRevision } from "../materials-setup/repository";
import { preferenceRow } from "../setup-preferences/repository";
import { settleDispatch } from "../processing-consent/service";
import { authorize } from "../identity-access/access";
import * as lifecycle from "../lifecycle-platform/repository";
import { errorCode } from "../../platform/errors";
import { buildCourseMessages, createSyntheticCourseCompletion, parseCourseOutput } from "./generation";
import * as repository from "./repository";

export { COURSE_QUEUE };

type Claim = {
  planRevisionId: string;
  selectionId: string;
  goal: string;
  topic: string;
  excerpts: { name: string; text: string }[];
  sources: { extractionId: string; filename: string }[];
  admissionId: string;
  plan: Plan;
};

// One attempt, no retry loops (the queue's retryLimit is 0): the course row is
// the single durable record and lands in an honest terminal state on every
// path. The processor result is persisted ONLY after settleDispatch re-checked
// consent, withdrawal and lineage fences under the recorded identity — a
// rejected-late result is discarded, never stored. The default processor is
// the LOCAL SYNTHETIC FIXTURE (this entry admits no external dispatch;
// createLiveCompletion is deliberately not referenced here — gate F-A owns
// live admission).
export async function runCourseGeneration(job: CourseJob, completion?: () => TextCompletionPort): Promise<void> {
  const identity = { userId: job.ownerId, sessionId: job.sessionId };
  const failRequest = async (code: string) => {
    await transaction(client => repository.markFailed(client, job.requestId, code))
      .catch(() => console.error(JSON.stringify({ event: "course-generation-terminal-pending", requestId: job.requestId })));
  };
  // Phase 1 — re-read the SAME pinned sources under the recorded owner. Any
  // fence (revoked session, deleted root, invalidated lineage) or an honest
  // unreadable source ends the request without any dispatch.
  let claim: Claim | null | "fenced";
  try {
    claim = await transaction(async client => {
      await authorize(client, identity);
      const request = await repository.courseById(client, identity.userId, job.requestId);
      if (!request || request.status !== "pending") return null; // already settled by a duplicate delivery
      await lifecycle.scopedRoot(client, identity.userId, job.rootId);
      const objectIds = request.object_ids ?? [];
      if (!(await lifecycle.objectsActive(client, identity.userId, objectIds))) return "fenced" as const;
      const confirmed = await planRevision(client, request.plan_revision_id);
      if (!confirmed) return "fenced" as const;
      const sources = (await client.query<{ extractionId: string; filename: string }>(
        'SELECT x.extraction_id AS "extractionId",b.filename FROM app.selection_source x JOIN app.batch_slot b ON b.id=x.slot_id WHERE x.selection_id=$1 ORDER BY b.position',
        [request.selection_id],
      )).rows;
      const excerpts = [];
      for (const source of sources) {
        excerpts.push({ name: source.filename, text: await files.readExtracted(await copyKey(client, source.extractionId)) });
      }
      const preference = await preferenceRow(client, identity.userId);
      return {
        planRevisionId: request.plan_revision_id,
        selectionId: request.selection_id,
        goal: preference?.goal ?? "",
        topic: preference?.topic ?? "",
        excerpts,
        sources,
        admissionId: request.admission_id,
        plan: confirmed.plan,
      };
    });
  } catch (error) {
    const code = errorCode(error);
    await failRequest(code === "UNAUTHENTICATED" || code === "FORBIDDEN_OR_NOT_FOUND" ? "rejected-late" : "processing-blocked");
    return;
  }
  if (claim === null) return;
  if (claim === "fenced") { await failRequest("rejected-late"); return; }
  // Phase 2 — one bounded completion through the port. Production default is
  // the deterministic local synthetic fixture (pure over its own input
  // messages, zero-token usage); tests inject fakes the same way runAiDraft's
  // completion parameter does.
  const port = (completion ? completion() : createSyntheticCourseCompletion());
  const messages = buildCourseMessages({ goal: claim.goal, topic: claim.topic, plan: claim.plan, excerpts: claim.excerpts });
  const request = textCompletionRequestSchema.safeParse({ messages, maxOutputTokens: AI_BUDGET.maxOutputTokens });
  if (!request.success) { await failRequest("invalid-input"); return; }
  const outcome = await port.complete(request.data);
  if (!outcome.ok) { await failRequest(outcome.error.code); return; }
  // Parse BEFORE settling: an unparseable or out-of-bounds draft fails
  // honestly without consuming the admission — retryable via a new command.
  const parsed = parseCourseOutput(outcome.text, { plan: claim.plan, sources: claim.sources });
  if (!parsed.ok) { await failRequest("invalid-output"); return; }
  const content = courseContentSchema.parse(parsed.content);
  // Phase 3 — settlement before persistence: the existing machinery re-checks
  // everything; only an ACCEPTED settle may store any effect. The single
  // transaction registers the 'course' lifecycle object (root lock also
  // serializes version assignment), supersedes prior versions, stores the
  // course/objective/source lineage, marks ready and appends the one
  // content-free zero-token ledger row.
  try {
    const settled = await settleDispatch(identity, claim.admissionId);
    if (settled.outcome !== "accepted") { await failRequest("rejected-late"); return; }
    await transaction(async client => {
      const objectId = await lifecycle.registerObject(client, job.rootId, "course", [claim.planRevisionId]);
      const version = (await repository.readyCount(client, job.rootId)) + 1;
      await repository.supersedePrior(client, job.rootId, job.requestId);
      await repository.markReady(client, job.requestId, { content, model: outcome.provenance.returnedModel, usage: outcome.usage, version, objectId });
      await repository.insertObjectives(client, job.requestId, content.objectives);
      const seen = new Set<string>();
      const sources: Array<{ position: number; extractionId: string; filename: string }> = [];
      for (const [position, source] of claim.sources.entries()) {
        if (seen.has(source.extractionId)) continue;
        seen.add(source.extractionId);
        sources.push({ position, extractionId: source.extractionId, filename: source.filename });
      }
      for (const section of content.sections) {
        if (seen.has(section.sourceRef.extractionId)) continue;
        seen.add(section.sourceRef.extractionId);
        sources.push({ position: sources.length, extractionId: section.sourceRef.extractionId, filename: section.sourceRef.filename });
      }
      await repository.insertSources(client, job.requestId, sources);
      await repository.insertLedgerRow(client, job.ownerId, outcome.usage);
    });
  } catch (error) {
    const code = errorCode(error);
    await failRequest(code === "UNAUTHENTICATED" || code === "FORBIDDEN_OR_NOT_FOUND" ? "rejected-late" : "processing-blocked");
  }
}

// One-line worker registration for src/worker/main.ts, mirroring workAiDrafts:
// consumes the queue with single-job batches. The queue policy matches
// migrate.ts exactly (a mismatched createQueue would kill the worker at boot).
export async function workCourseGenerations(boss: PgBoss, completion?: () => TextCompletionPort): Promise<void> {
  await boss.createQueue(COURSE_QUEUE, { retryLimit: 0, expireInSeconds: 120, retentionSeconds: 86400 });
  await boss.work<CourseJob>(COURSE_QUEUE, { batchSize: 1, pollingIntervalSeconds: 1 }, async jobs => {
    for (const job of jobs) {
      const envelope = courseJobSchema.parse(job.data);
      if (envelope.requestId !== job.id) throw new Error("Invalid job identity");
      await runCourseGeneration(envelope, completion);
      console.log(JSON.stringify({ event: "course-generation-processed", requestId: envelope.requestId }));
    }
  });
}
