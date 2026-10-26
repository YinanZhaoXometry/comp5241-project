import { commandSchema, uuid, type Identity, type Receipt } from "../../contracts/setup";
import {
  courseContentSchema,
  submitRecallSchema,
  type CourseState,
  type RecallFeedback,
} from "../../contracts/courses";
import { transaction } from "../../adapters/postgres/database";
import { enqueueCourseGeneration } from "../../adapters/queue";
import { AI_BUDGET } from "../../adapters/ai-live";
import { authorize } from "../identity-access/access";
import * as lifecycle from "../lifecycle-platform/repository";
import { admitDispatch } from "../processing-consent/service";
import { getHandoff } from "../materials-setup/handoff";
import { batchRow } from "../materials-setup/batches";
import { ledgerTotalTokens } from "../ai-setup/repository";
import { buildRecallFeedback } from "./generation";
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
// ready view carries the lesson, per-section source locations, objectives and
// the recall PROMPT only. objectIds carries the fences the route re-checks
// per chunk of the protected response. An optional `requested` selector (a
// course id uuid or a per-root version number) resolves that specific READY
// version — the explicit read path that keeps prior versions readable after a
// regeneration supersedes them; lineage fencing rides the same objectIds.
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
    const settledContent = courseContentSchema.safeParse(row.content);
    if (!settledContent.success) fail("RETRYABLE_FAILURE");
    const content = settledContent.data;
    const recallObjective = content.objectives.find(objective => objective.index === content.recall.objectiveIndex)?.text ?? "";
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
        superseded: await repository.newerReadyExists(client, rootId, row.id),
        historical,
        model: row.model ?? "",
        usage: row.usage,
        createdAt: row.created_at.toISOString(),
        settledAt: row.settled_at.toISOString(),
        lesson: {
          title: content.lessonTitle,
          sections: content.sections.map(section => ({ text: section.text, source: { filename: section.sourceRef.filename, locator: section.sourceRef.locator } })),
        },
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
        const settled = courseContentSchema.safeParse(course.content);
        if (settled.success) return buildRecallFeedback({ rootId, revision: item.revision, courseId: course.id, content: settled.data, attempted: command.attempted });
      }
      return repeated as unknown as RecallFeedback; // course no longer readable: reduced shape only
    }
    const course = await repository.latestReadyCourse(client, identity.userId, rootId);
    if (!course?.content) fail("CONFLICT"); // nothing studyable yet — confirm and generate first
    await lifecycle.assertObjects(client, identity.userId, [course.object_id, ...(course.object_ids ?? [])].filter((id): id is string => !!id));
    const settledContent = courseContentSchema.safeParse(course.content);
    if (!settledContent.success) fail("RETRYABLE_FAILURE");
    const content = settledContent.data;
    const feedback = buildRecallFeedback({ rootId, revision: item.revision, courseId: course.id, content, attempted: command.attempted });
    const recorded: Receipt & { outcome: RecallFeedback["outcome"] } = { rootId, operationId: course.id, revision: item.revision, outcome: feedback.outcome };
    await lifecycle.receipt(client, identity, command, "submit-recall", hash, recorded);
    return feedback;
  });
}
