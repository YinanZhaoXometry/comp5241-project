import { commandSchema, uuid, type Identity, type Receipt } from "../../contracts/setup";
import {
  courseTrackerItems,
  markItemDoneSchema,
  requestSupplementsSchema,
  storedCourseContent,
  submitRecallSchema,
  type CourseState,
  type GapResolution,
  type RecallFeedback,
  type SupplementOutcome,
  type SupplementsState,
} from "../../contracts/courses";
import { transaction } from "../../adapters/postgres/database";
import { enqueueCourseGeneration, enqueueSupplementFetch } from "../../adapters/queue";
import { AI_BUDGET } from "../../adapters/ai-live";
import { authorize } from "../identity-access/access";
import * as lifecycle from "../lifecycle-platform/repository";
import { admitDispatch } from "../processing-consent/service";
import { getHandoff } from "../materials-setup/handoff";
import { batchRow } from "../materials-setup/batches";
import { planRevision } from "../materials-setup/repository";
import { ledgerTotalTokens } from "../ai-setup/repository";
import { buildRecallFeedback } from "./generation";
import { declaredGapCount, deriveGaps } from "./supplements";
import * as repository from "./repository";
import { fail } from "../../platform/errors";
import { parse, requestHash } from "../../platform/commands";

// Epic-2 S1 learner actions over the generated-course tracer. The generation
// command consumes the S5 exact-revision handoff, admits the dispatch through
// the EXISTING consent machinery (one admission per command; the handoff's
// pinned lineage is the fence scope), pre-checks the owner's budget ledger,
// then enqueues one restart-safe job. The processor is never called here —
// only the worker settles, and only after the settlement fences still hold.

export async function requestCourseGeneration(identity: Identity, rawId: string, raw: unknown): Promise<Receipt> {
  const rootId = parse(uuid, rawId);
  const command = parse(commandSchema, raw);
  // Consume the handoff first (its own transaction): absent confirmation,
  // dead lineage and foreign roots all deny here, before any effect.
  const handoff = await getHandoff(identity, rootId);
  const outcome = await transaction(async client => {
    await authorize(client, identity);
    await lifecycle.scopedRoot(client, identity.userId, rootId);
    const hash = requestHash({ rootId, command });
    const repeated = await lifecycle.replay(client, identity.userId, command, "request-course", hash);
    if (repeated) return repeated;
    const item = await batchRow(client, rootId);
    if (item.revision !== command.expectedRevision) fail("CONFLICT");
    // The confirmed plan may have moved since the handoff read: generation is
    // only ever requested against the exact revision the handoff pinned.
    if (item.confirmed_id !== handoff.planRevisionId) fail("CONFLICT");
    // Exactly one tracked result per confirmed revision (the S7 bundleByPlan
    // precedent): a repeat command for the same revision returns the existing
    // pending/ready course instead of dispatching again.
    const existing = await repository.courseForPlan(client, rootId, handoff.planRevisionId);
    if (existing && existing.status === "ready") {
      return lifecycle.receipt(client, identity, command, "request-course", hash, {
        rootId,
        operationId: existing.id,
        planRevisionId: handoff.planRevisionId,
        selectionId: handoff.selectionId,
        revision: item.revision,
        state: "ready",
      });
    }
    if (existing && existing.status === "pending") {
      // A job pg-boss expired (worker down past the queue's expireInSeconds,
      // 120) strands its row in pending forever and would block every
      // regeneration behind the short-circuit above. The honest cap that
      // bounds the learner's wait bounds the row too: past it the row is
      // marked failed 'timeout' (a late delivery then no-ops against the
      // status guard) and this command proceeds to a fresh admission.
      if (Date.now() - existing.created_at.getTime() <= 120_000) {
        return lifecycle.receipt(client, identity, command, "request-course", hash, {
          rootId,
          operationId: existing.id,
          planRevisionId: handoff.planRevisionId,
          selectionId: handoff.selectionId,
          revision: item.revision,
          state: "pending",
        });
      }
      await repository.markFailed(client, existing.id, "timeout");
    }
    const admission = await admitDispatch(client, identity, { commandKey: command.commandKey, objectIds: handoff.objectIds });
    if (admission.outcome !== "admitted") return { blocked: admission.outcome } as const;
    // Budget pre-check (untrusted provider-claimed ledger + this request's
    // maximum output): exhausted means nothing is dispatched and nothing is
    // recorded — the transaction rolls back including the admission.
    const ledger = await ledgerTotalTokens(client, identity.userId);
    if (ledger + AI_BUDGET.maxOutputTokens > AI_BUDGET.totalTokenCap) fail("AI_BUDGET_EXHAUSTED");
    const requestId = crypto.randomUUID();
    await repository.insertCourseRequest(client, { id: requestId, rootId, ownerId: identity.userId, planRevisionId: handoff.planRevisionId, selectionId: handoff.selectionId, admissionId: admission.admissionId });
    await enqueueCourseGeneration(client, { schemaVersion: 1, requestId, admissionId: admission.admissionId, rootId, ownerId: identity.userId, sessionId: identity.sessionId });
    return lifecycle.receipt(client, identity, command, "request-course", hash, {
      rootId,
      operationId: requestId,
      planRevisionId: handoff.planRevisionId,
      selectionId: handoff.selectionId,
      revision: item.revision,
      state: "pending",
    });
  });
  if ("blocked" in outcome)
    fail(outcome.blocked === "blocked-quota" ? "RATE_LIMITED" : "FORBIDDEN_OR_NOT_FOUND");
  return outcome;
}

// Owner-scoped study state. The recall answer is never part of any state: the
// ready view carries the numbered lesson sequence, per-section source
// locations, tracker items (required readings with this owner's explicit done
// state for THIS course version; optional enrichment labeled) and objectives.
// objectIds carries the fences the route re-checks per chunk of the protected
// response. An optional `requested` selector (a course id uuid or a per-root
// version number) resolves that specific READY version — the explicit read
// path that keeps prior versions readable after a regeneration supersedes
// them; lineage fencing rides the same objectIds. Stored pre-2.3 v1 courses
// serve unchanged through the legacy wrap (one serving path, no fork).
export async function getCourse(identity: Identity, rawId: string, requested?: string): Promise<CourseState & { objectIds: string[] }> {
  const rootId = parse(uuid, rawId);
  if (requested !== undefined && !uuid.safeParse(requested).success && !/^[1-9]\d*$/u.test(requested)) fail("INVALID_INPUT");
  return transaction(async client => {
    await authorize(client, identity);
    await lifecycle.scopedRoot(client, identity.userId, rootId);
    const item = await batchRow(client, rootId);
    const revision = item.revision;
    const objectIdsOf = (row: repository.CourseWithScope | null) =>
      row ? [row.object_id, ...(row.object_ids ?? [])].filter((id): id is string => !!id) : [];
    let row: repository.CourseWithScope | null = null;
    let historical = false;
    if (requested !== undefined) {
      // The explicit prior-version view: only a READY course of this owner
      // resolves; anything else is the same no-leak denial as every view.
      row = uuid.safeParse(requested).success
        ? await repository.readyCourseById(client, identity.userId, rootId, requested)
        : await repository.readyCourseByVersion(client, identity.userId, rootId, Number(requested));
      if (!row) fail("FORBIDDEN_OR_NOT_FOUND");
      historical = !!item.confirmed_id && row.plan_revision_id !== item.confirmed_id;
    } else {
      // Prefer the course of the CURRENT confirmed revision; an older ready
      // course stays readable with an honest historical/superseded notice.
      const current = item.confirmed_id ? await repository.courseForPlan(client, rootId, item.confirmed_id) : null;
      row = current ?? null;
      if (!row) {
        row = await repository.latestReadyCourse(client, identity.userId, rootId);
        historical = !!row && !!item.confirmed_id && row.plan_revision_id !== item.confirmed_id;
      }
    }
    if (!row) return { state: "none" as const, rootId, revision, objectIds: [] };
    if (row.status === "pending") return { state: "pending" as const, rootId, revision, requestId: row.id, objectIds: objectIdsOf(row) };
    if (row.status === "failed") return { state: "failed" as const, rootId, revision, requestId: row.id, failureCode: row.failure_code, objectIds: objectIdsOf(row) };
    if (!row.content || !row.settled_at) fail("RETRYABLE_FAILURE");
    const content = storedCourseContent(row.content);
    if (!content) fail("RETRYABLE_FAILURE");
    const recallObjective = content.objectives.find(objective => objective.index === content.recall.objectiveIndex)?.text ?? "";
    // Tracker join: this owner's explicit done rows for THIS course version —
    // prior versions keep their own state, superseded learners stay put.
    const superseded = await repository.newerReadyExists(client, rootId, row.id);
    const done = new Map((await repository.itemStates(client, identity.userId, row.id)).map(state => [state.item_id, state.done_at]));
    const items = courseTrackerItems(content).map(serving => ({
      ...serving,
      done: done.has(serving.id),
      doneAt: done.get(serving.id)?.toISOString() ?? null,
    }));
    return {
      state: "ready" as const,
      rootId,
      revision,
      objectIds: objectIdsOf(row),
      course: {
        courseId: row.id,
        requestId: row.id,
        planRevisionId: row.plan_revision_id,
        selectionId: row.selection_id,
        version: row.version ?? 1,
        superseded,
        supersededBy: superseded ? await repository.latestReadyVersion(client, rootId) : null,
        historical,
        model: row.model ?? "",
        usage: row.usage,
        createdAt: row.created_at.toISOString(),
        settledAt: row.settled_at.toISOString(),
        lessons: content.lessons.map((lesson, index) => ({
          number: index + 1,
          title: lesson.title,
          sections: lesson.sections.map(section => ({ text: section.text, source: { filename: section.sourceRef.filename, locator: section.sourceRef.locator } })),
        })),
        items,
        objectives: content.objectives,
        recall: {
          prompt: content.recall.prompt,
          objective: recallObjective,
          source: { filename: content.recall.sourceRef.filename, locator: content.recall.sourceRef.locator },
        },
      },
    };
  });
}

// Epic-2 S3 explicit content-item mark-done: the sole tracker write. Owner-
// scoped and course-version-scoped with the standard command envelope (a
// replayed command returns the same receipt; the UNIQUE row makes a duplicate
// delivery a no-op). Only REQUIRED items are markable — optional enrichment is
// labeled and never tracked — and there is deliberately no un-mark verb and no
// completion, score or credit effect anywhere: done is an explicit learner
// action, nothing more.
export async function markItemDone(identity: Identity, rawId: string, raw: unknown): Promise<Receipt & { itemId: string }> {
  const rootId = parse(uuid, rawId);
  const command = parse(markItemDoneSchema, raw);
  return transaction(async client => {
    await authorize(client, identity);
    await lifecycle.scopedRoot(client, identity.userId, rootId);
    const hash = requestHash({ rootId, command });
    const repeated = await lifecycle.replay(client, identity.userId, command, "mark-item-done", hash);
    if (repeated) return repeated as Receipt & { itemId: string };
    const item = await batchRow(client, rootId);
    if (item.revision !== command.expectedRevision) fail("CONFLICT");
    // Any READY course version of this owner and root resolves — prior
    // versions keep their own tracker state; a foreign/unknown id is the same
    // actionable state as the recall path (nothing studyable there).
    const course = await repository.readyCourseById(client, identity.userId, rootId, command.courseId);
    if (!course?.content) fail("CONFLICT");
    await lifecycle.assertObjects(client, identity.userId, [course.object_id, ...(course.object_ids ?? [])].filter((id): id is string => !!id));
    const content = storedCourseContent(course.content);
    if (!content) fail("RETRYABLE_FAILURE");
    const target = courseTrackerItems(content).find(candidate => candidate.id === command.itemId);
    if (!target) fail("CONFLICT"); // the item is not part of this course version — re-read the course
    if (!target.required) fail("INVALID_INPUT"); // optional enrichment is labeled, never tracked
    await repository.insertItemState(client, { ownerId: identity.userId, courseId: course.id, itemId: command.itemId });
    const recorded: Receipt & { itemId: string } = {
      rootId,
      operationId: course.id,
      revision: item.revision,
      itemId: command.itemId,
      state: "done",
    };
    await lifecycle.receipt(client, identity, command, "mark-item-done", hash, recorded);
    return recorded;
  });
}

// Recall submission: the sole reveal path for the canonical answer. The
// durable receipt is CONTENT-FREE (rootId, revision, courseId, outcome) — the
// answer, rationale and attempted text never persist, so a revealed answer
// cannot survive root/personal deletion at rest. A replayed command recomputes
// the identical feedback view from the live course's immutable stored content
// while that course is still readable; once it is not (purged/revoked), the
// replay returns only the reduced receipt shape. NO evidence row is written —
// typed practice evidence belongs to entry 5.
export async function submitRecall(identity: Identity, rawId: string, raw: unknown): Promise<RecallFeedback> {
  const rootId = parse(uuid, rawId);
  const command = parse(submitRecallSchema, raw);
  return transaction(async client => {
    await authorize(client, identity);
    await lifecycle.scopedRoot(client, identity.userId, rootId);
    const item = await batchRow(client, rootId);
    if (item.revision !== command.expectedRevision) fail("CONFLICT");
    const hash = requestHash({ rootId, command });
    const repeated = await lifecycle.replay(client, identity.userId, command, "submit-recall", hash);
    if (repeated) {
      const prior = repeated as { operationId?: string };
      const course = prior.operationId ? await repository.readyCourseById(client, identity.userId, rootId, prior.operationId) : null;
      if (course?.content) {
        const settled = storedCourseContent(course.content);
        if (settled) return buildRecallFeedback({ rootId, revision: item.revision, courseId: course.id, content: settled, attempted: command.attempted });
      }
      return repeated as unknown as RecallFeedback; // course no longer readable: reduced shape only
    }
    const course = await repository.latestReadyCourse(client, identity.userId, rootId);
    if (!course?.content) fail("CONFLICT"); // nothing studyable yet — confirm and generate first
    await lifecycle.assertObjects(client, identity.userId, [course.object_id, ...(course.object_ids ?? [])].filter((id): id is string => !!id));
    const content = storedCourseContent(course.content);
    if (!content) fail("RETRYABLE_FAILURE");
    const feedback = buildRecallFeedback({ rootId, revision: item.revision, courseId: course.id, content, attempted: command.attempted });
    const recorded: Receipt & { outcome: RecallFeedback["outcome"] } = { rootId, operationId: course.id, revision: item.revision, outcome: feedback.outcome };
    await lifecycle.receipt(client, identity, command, "submit-recall", hash, recorded);
    return feedback;
  });
}

// ---------------------------------------------------------------------------
// Epic-2 S2: bounded source retrieval and attributed supplementation. The
// learner action runs against ONE ready course version: the admission scope
// pins the course object plus its full generation lineage (plan revision,
// selection, extractions), so any fence change discards a late result. The
// processor and the fetcher are never called here — only the worker settles,
// and only after the settlement fences still hold.
// ---------------------------------------------------------------------------

export async function requestSupplements(identity: Identity, rawId: string, raw: unknown): Promise<Receipt> {
  const rootId = parse(uuid, rawId);
  const command = parse(requestSupplementsSchema, raw);
  const outcome = await transaction(async client => {
    await authorize(client, identity);
    await lifecycle.scopedRoot(client, identity.userId, rootId);
    const hash = requestHash({ rootId, command });
    const repeated = await lifecycle.replay(client, identity.userId, command, "request-supplements", hash);
    if (repeated) return repeated;
    const item = await batchRow(client, rootId);
    if (item.revision !== command.expectedRevision) fail("CONFLICT");
    // A supplement pass requires a studyable course for THIS owner and root:
    // an ungenerated (or foreign) course id is the same actionable state as
    // the recall path — generate first.
    const course = await repository.readyCourseById(client, identity.userId, rootId, command.courseId);
    if (!course || !course.content || !course.object_id) fail("CONFLICT");
    // Same-course replay: a repeat command for the same course returns the
    // existing settled pass; a stranded pending row past the honest 120-second
    // cap is failed 'timeout' (a late delivery no-ops against the status
    // guard) and this command proceeds to a fresh admission.
    const existing = await repository.latestSupplementRequest(client, identity.userId, command.courseId);
    if (existing && existing.status === "ready") {
      return lifecycle.receipt(client, identity, command, "request-supplements", hash, {
        rootId,
        operationId: existing.id,
        planRevisionId: course.plan_revision_id,
        selectionId: course.selection_id,
        revision: item.revision,
        state: "ready",
      });
    }
    if (existing && existing.status === "pending") {
      if (Date.now() - existing.created_at.getTime() <= 120_000) {
        return lifecycle.receipt(client, identity, command, "request-supplements", hash, {
          rootId,
          operationId: existing.id,
          planRevisionId: course.plan_revision_id,
          selectionId: course.selection_id,
          revision: item.revision,
          state: "pending",
        });
      }
      await repository.markSupplementFailed(client, existing.id, "timeout");
    }
    // Admission fence scope: the course's own lifecycle object plus the exact
    // generation lineage (plan revision, selection, every selected
    // extraction) — bounded by the dispatch scope's 16-object cap.
    const objectIds = [course.object_id, ...(course.object_ids ?? [])].filter((id): id is string => !!id).slice(0, 16);
    const admission = await admitDispatch(client, identity, { commandKey: command.commandKey, objectIds });
    if (admission.outcome !== "admitted") return { blocked: admission.outcome } as const;
    // Budget pre-check covers the proposal completion's maximum output; a
    // declined or lapsed consent never reaches this point (zero dispatch,
    // zero fetch, no request row — the transaction rolls back).
    const ledger = await ledgerTotalTokens(client, identity.userId);
    if (ledger + AI_BUDGET.maxOutputTokens > AI_BUDGET.totalTokenCap) fail("AI_BUDGET_EXHAUSTED");
    const requestId = crypto.randomUUID();
    await repository.insertSupplementRequest(client, { id: requestId, rootId, ownerId: identity.userId, courseId: command.courseId, admissionId: admission.admissionId });
    await enqueueSupplementFetch(client, { schemaVersion: 1, requestId, admissionId: admission.admissionId, courseId: command.courseId, rootId, ownerId: identity.userId, sessionId: identity.sessionId });
    return lifecycle.receipt(client, identity, command, "request-supplements", hash, {
      rootId,
      operationId: requestId,
      planRevisionId: course.plan_revision_id,
      selectionId: course.selection_id,
      revision: item.revision,
      state: "pending",
    });
  });
  if ("blocked" in outcome)
    fail(outcome.blocked === "blocked-quota" ? "RATE_LIMITED" : "FORBIDDEN_OR_NOT_FOUND");
  return outcome;
}

// Owner-scoped, lineage-fenced supplement state for one course version. An
// optional `requested` selector (course id uuid or per-root version number)
// mirrors getCourse's explicit prior-version read path; absent, the row of
// the current confirmed plan revision wins in ANY status (mirroring getCourse
// — a pending/failed current course never silently resolves to an older
// ready version), falling back to the latest ready course only when no
// current-confirmed row exists. The gaps are always re-derived from the
// course's own confirmed plan — an unrun pass shows them honestly as
// unaddressed, and the declared-gap total rides along so truncation under
// the release's 8-gap cap is stated, never silent.
export async function getSupplements(identity: Identity, rawId: string, requested?: string): Promise<SupplementsState & { objectIds: string[] }> {
  const rootId = parse(uuid, rawId);
  if (requested !== undefined && !uuid.safeParse(requested).success && !/^[1-9]\d*$/u.test(requested)) fail("INVALID_INPUT");
  return transaction(async client => {
    await authorize(client, identity);
    await lifecycle.scopedRoot(client, identity.userId, rootId);
    const item = await batchRow(client, rootId);
    const revision = item.revision;
    let row: repository.CourseWithScope | null = null;
    if (requested !== undefined) {
      row = uuid.safeParse(requested).success
        ? await repository.readyCourseById(client, identity.userId, rootId, requested)
        : await repository.readyCourseByVersion(client, identity.userId, rootId, Number(requested));
      if (!row || !row.content) fail("FORBIDDEN_OR_NOT_FOUND");
    } else {
      const current = item.confirmed_id ? await repository.courseForPlan(client, rootId, item.confirmed_id) : null;
      row = current ?? await repository.latestReadyCourse(client, identity.userId, rootId);
    }
    if (!row || !row.content) fail("CONFLICT"); // nothing studyable yet — confirm and generate first
    const settledContent = storedCourseContent(row.content);
    if (!settledContent) fail("RETRYABLE_FAILURE");
    const confirmed = await planRevision(client, row.plan_revision_id);
    if (!confirmed) fail("CONFLICT");
    const declaredCount = declaredGapCount(confirmed.plan);
    const gaps = deriveGaps(confirmed.plan, settledContent);
    const request = await repository.latestSupplementRequest(client, identity.userId, row.id);
    const objectIds = [
      ...(request?.object_id ? [request.object_id] : []),
      ...(row.object_id ? [row.object_id] : []),
      ...(row.object_ids ?? []),
    ].filter((id): id is string => !!id);
    const base = { rootId, revision, courseId: row.id, version: row.version ?? 1, gapCount: declaredCount, gapsTruncated: declaredCount > gaps.length };
    if (!request)
      return { ...base, state: "none" as const, gaps: gaps.map(gap => ({ gap, outcome: "unaddressed" as const, supplement: null })), objectIds };
    if (request.status === "pending")
      return { ...base, state: "pending" as const, requestId: request.id, gaps: gaps.map(gap => ({ gap, outcome: "unaddressed" as const, supplement: null })), objectIds };
    if (request.status === "failed") {
      return { ...base, state: "failed" as const, requestId: request.id, failureCode: request.failure_code, gaps: gaps.map(gap => ({ gap, outcome: "unaddressed" as const, supplement: null })), objectIds };
    }
    const rows = await repository.supplementsForRequest(client, request.id);
    const byPosition = new Map(rows.map(supplement => [supplement.position, supplement]));
    const resolutions: GapResolution[] = gaps.map(gap => {
      const supplement = byPosition.get(gap.index);
      if (!supplement) return { gap, outcome: "unaddressed" as const, supplement: null };
      return {
        gap,
        outcome: supplement.outcome as SupplementOutcome,
        supplement: {
          position: supplement.position,
          outcome: supplement.outcome,
          url: supplement.url,
          origin: supplement.origin,
          locator: supplement.locator,
          passage: supplement.passage,
          contentHash: supplement.content_hash,
          retrievedAt: supplement.retrieved_at?.toISOString() ?? null,
          claim: supplement.claim,
          conflict: supplement.upload_excerpt !== null && supplement.upload_source !== null
            ? { uploadExcerpt: supplement.upload_excerpt, uploadSource: supplement.upload_source }
            : null,
        },
      };
    });
    return { ...base, state: "ready" as const, requestId: request.id, gaps: resolutions, objectIds };
  });
}
