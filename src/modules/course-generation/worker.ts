import type { PgBoss } from "pg-boss";
import { COURSE_QUEUE, SUPPLEMENT_QUEUE, courseJobSchema, courseContentV2Schema, storedCourseContent, supplementJobSchema, type CourseContentV2, type CourseGap, type CourseJob, type SupplementJob } from "../../contracts/courses";
import { textCompletionRequestSchema, type TextCompletionPort } from "../../contracts/ai-provider";
import type { BoundedFetchPort } from "../../adapters/source-fetch";
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
import {
  FIXTURE_FETCH_ALLOWLIST,
  buildProposalMessages,
  createFixtureFetchPort,
  createSyntheticProposalCompletion,
  deriveGaps,
  parseProposalOutput,
  verifySupplement,
} from "./supplements";
import * as repository from "./repository";

export { COURSE_QUEUE, SUPPLEMENT_QUEUE };

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
  const content = courseContentV2Schema.parse(parsed.content);
  // Phase 3 — settlement before persistence: the existing machinery re-checks
  // everything; only an ACCEPTED settle may store any effect. The single
  // transaction CLAIMS the pending→ready transition FIRST: a row that already
  // reached a terminal state after phase 1 (e.g. a stranded row marked failed
  // 'timeout' by a new command) returns no claim and NOTHING is written — no
  // lifecycle object, no content, no ledger row. The claim plus the root lock
  // also serialize version assignment.
  try {
    const settled = await settleDispatch(identity, claim.admissionId);
    if (settled.outcome !== "accepted") { await failRequest("rejected-late"); return; }
    await transaction(async client => {
      const claimed = await repository.claimReady(client, job.requestId);
      if (!claimed) return; // terminal state raced this delivery: persist nothing
      const objectId = await lifecycle.registerObject(client, job.rootId, "course", [claim.planRevisionId]);
      const version = (await repository.readyCount(client, job.rootId, job.requestId)) + 1;
      await repository.supersedePrior(client, job.rootId, job.requestId);
      await repository.completeReady(client, job.requestId, { content, model: outcome.provenance.returnedModel, usage: outcome.usage, version, objectId });
      await repository.insertObjectives(client, job.requestId, content.objectives);
      const seen = new Set<string>();
      const sources: Array<{ position: number; extractionId: string; filename: string }> = [];
      for (const [position, source] of claim.sources.entries()) {
        if (seen.has(source.extractionId)) continue;
        seen.add(source.extractionId);
        sources.push({ position, extractionId: source.extractionId, filename: source.filename });
      }
      for (const lesson of content.lessons) {
        for (const section of lesson.sections) {
          if (seen.has(section.sourceRef.extractionId)) continue;
          seen.add(section.sourceRef.extractionId);
          sources.push({ position: sources.length, extractionId: section.sourceRef.extractionId, filename: section.sourceRef.filename });
        }
      }
      if (content.enrichment && !seen.has(content.enrichment.sourceRef.extractionId)) {
        sources.push({ position: sources.length, extractionId: content.enrichment.sourceRef.extractionId, filename: content.enrichment.sourceRef.filename });
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

// ---------------------------------------------------------------------------
// Epic-2 S2 supplement phase. One attempt (retryLimit 0): the request row is
// the single durable record and lands in an honest terminal state on every
// path. Pipeline order is the plan's contract: fenced re-read → ONE proposal
// completion → per-candidate bounded fetch (fixture default, zero egress) →
// VERIFY BEFORE SETTLE → settleDispatch → single-transaction persist + ledger.
// The proposal is an untrusted suggestion and the fetch is untrusted content:
// a supplement persists only when deterministic code verified the claimed
// passage inside the fetched bytes, and only an ACCEPTED settle may store any
// effect — a rejected-late result is discarded, never stored.
// ---------------------------------------------------------------------------

type SupplementClaim = {
  admissionId: string;
  courseId: string;
  courseObjectId: string;
  lessonTitle: string;
  gaps: CourseGap[];
  outcomes: string[];
  sections: CourseContentV2["lessons"][number]["sections"];
};

export async function runSupplementFetch(
  job: SupplementJob,
  completion?: () => TextCompletionPort,
  fetchPort?: () => BoundedFetchPort,
): Promise<void> {
  const identity = { userId: job.ownerId, sessionId: job.sessionId };
  const failRequest = async (code: string) => {
    await transaction(client => repository.markSupplementFailed(client, job.requestId, code))
      .catch(() => console.error(JSON.stringify({ event: "supplement-terminal-pending", requestId: job.requestId })));
  };
  // Phase 1 — fenced re-read of the SAME pinned course under the recorded
  // owner. Any fence (revoked session, deleted root, invalidated lineage) or
  // an unready/missing course ends the request without any dispatch.
  let claim: SupplementClaim | null | "fenced";
  try {
    claim = await transaction(async client => {
      await authorize(client, identity);
      const request = await repository.supplementRequestById(client, identity.userId, job.requestId);
      if (!request || request.status !== "pending") return null; // already settled by a duplicate delivery
      await lifecycle.scopedRoot(client, identity.userId, job.rootId);
      const objectIds = request.object_ids ?? [];
      if (!(await lifecycle.objectsActive(client, identity.userId, objectIds))) return "fenced" as const;
      const course = await repository.readyCourseById(client, identity.userId, job.rootId, job.courseId);
      if (!course || !course.content || !course.object_id) return "fenced" as const;
      const settledContent = storedCourseContent(course.content);
      if (!settledContent) return "fenced" as const;
      const confirmed = await planRevision(client, course.plan_revision_id);
      if (!confirmed) return "fenced" as const;
      return {
        admissionId: request.admission_id,
        courseId: course.id,
        courseObjectId: course.object_id,
        // The supplement pass explains the course's lessons: the primary
        // lesson title heads the prompt and the sections flatten in sequence
        // order (a wrapped legacy course contributes its single list).
        lessonTitle: settledContent.lessons[0].title,
        gaps: deriveGaps(confirmed.plan, settledContent),
        outcomes: confirmed.plan.outcomes,
        sections: settledContent.lessons.flatMap(lesson => lesson.sections),
      };
    });
  } catch (error) {
    const code = errorCode(error);
    await failRequest(code === "UNAUTHENTICATED" || code === "FORBIDDEN_OR_NOT_FOUND" ? "rejected-late" : "processing-blocked");
    return;
  }
  if (claim === null) return;
  if (claim === "fenced") { await failRequest("rejected-late"); return; }
  // Phase 2 — one bounded proposal completion through the port. Production
  // default is the deterministic local synthetic fixture (zero-token, no I/O);
  // a live proposal processor stays deferred to gate F-A.
  const port = (completion ? completion() : createSyntheticProposalCompletion());
  const messages = buildProposalMessages({
    lessonTitle: claim.lessonTitle,
    gaps: claim.gaps,
    outcomes: claim.outcomes,
    sections: claim.sections,
    allowlist: FIXTURE_FETCH_ALLOWLIST,
  });
  const request = textCompletionRequestSchema.safeParse({ messages, maxOutputTokens: AI_BUDGET.maxOutputTokens });
  if (!request.success) { await failRequest("invalid-input"); return; }
  const outcome = await port.complete(request.data);
  if (!outcome.ok) { await failRequest(outcome.error.code); return; }
  // Strict parse BEFORE any fetch: an unparseable or out-of-bounds proposal
  // fails honestly without fetching anything — retryable via a new command.
  const parsed = parseProposalOutput(outcome.text, {
    gaps: claim.gaps,
    outcomes: claim.outcomes,
    sections: claim.sections,
    allowlist: FIXTURE_FETCH_ALLOWLIST,
  });
  if (!parsed.ok) { await failRequest("invalid-output"); return; }
  // Phase 3 — per-candidate bounded fetch (fixture default, zero egress) and
  // deterministic verification. Any fetch failure fails the request honestly
  // with a content-free code; a denied target records its deny reason.
  const fetcher = fetchPort ? fetchPort() : createFixtureFetchPort();
  const verified: Array<{ gapIndex: number; fetched: { url: string; origin: string; contentHash: string; retrievedAt: string } | null; verified: ReturnType<typeof verifySupplement> }> = [];
  for (const candidate of parsed.candidates) {
    const fetched = await fetcher.fetch(candidate.url);
    if (!fetched.ok) {
      const code = fetched.code === "denied" ? `fetch-denied:${fetched.reason}` : fetched.code === "unavailable" ? "fetch-unavailable" : `fetch-${fetched.code}`;
      await failRequest(code);
      return;
    }
    verified.push({
      gapIndex: candidate.gap.index,
      fetched: { url: fetched.url, origin: fetched.origin, contentHash: fetched.contentHash, retrievedAt: fetched.retrievedAt },
      verified: verifySupplement(candidate, fetched.text),
    });
  }
  // Phase 4 — settlement before persistence: the existing machinery re-checks
  // everything; only an ACCEPTED settle may store any effect. The single
  // transaction CLAIMS the pending→ready transition FIRST: a row that already
  // reached a terminal state after phase 1 returns no claim and NOTHING is
  // written — no 'supplement' lifecycle object, no rows, no ledger row.
  try {
    const settled = await settleDispatch(identity, claim.admissionId);
    if (settled.outcome !== "accepted") { await failRequest("rejected-late"); return; }
    await transaction(async client => {
      const claimed = await repository.claimSupplementReady(client, job.requestId);
      if (!claimed) return; // terminal state raced this delivery: persist nothing
      const objectId = await lifecycle.registerObject(client, job.rootId, "supplement", [claim.courseObjectId]);
      for (const item of verified) {
        await repository.insertSupplementRow(client, {
          requestId: job.requestId,
          courseId: claim.courseId,
          position: item.gapIndex,
          outcome: item.verified.outcome,
          url: item.fetched!.url,
          origin: item.fetched!.origin,
          locator: item.verified.locator,
          passage: item.verified.passage,
          contentHash: item.verified.passage === null ? null : item.fetched!.contentHash,
          retrievedAt: new Date(item.fetched!.retrievedAt),
          claim: parsed.candidates.find(candidate => candidate.gap.index === item.gapIndex)!.claim,
          uploadExcerpt: item.verified.conflict?.uploadExcerpt ?? null,
          uploadSource: item.verified.conflict?.uploadSource ?? null,
        });
      }
      await repository.completeSupplementReady(client, job.requestId, objectId);
      await repository.insertLedgerRow(client, job.ownerId, outcome.usage);
    });
  } catch (error) {
    const code = errorCode(error);
    await failRequest(code === "UNAUTHENTICATED" || code === "FORBIDDEN_OR_NOT_FOUND" ? "rejected-late" : "processing-blocked");
  }
}

// One-line worker registration for the supplement queue, mirroring
// workCourseGenerations: single-job batches; the queue policy matches
// migrate.ts exactly.
export async function workSupplementFetches(boss: PgBoss, completion?: () => TextCompletionPort, fetchPort?: () => BoundedFetchPort): Promise<void> {
  await boss.createQueue(SUPPLEMENT_QUEUE, { retryLimit: 0, expireInSeconds: 120, retentionSeconds: 86400 });
  await boss.work<SupplementJob>(SUPPLEMENT_QUEUE, { batchSize: 1, pollingIntervalSeconds: 1 }, async jobs => {
    for (const job of jobs) {
      const envelope = supplementJobSchema.parse(job.data);
      if (envelope.requestId !== job.id) throw new Error("Invalid job identity");
      await runSupplementFetch(envelope, completion, fetchPort);
      console.log(JSON.stringify({ event: "supplement-processed", requestId: envelope.requestId }));
    }
  });
}
