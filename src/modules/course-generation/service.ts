import { commandSchema, uuid, type Command, type Identity, type Receipt } from "../../contracts/setup";
import {
  MAX_WHY_DEPTH,
  contentAdaptation,
  contentFactsDigest,
  courseTrackerItems,
  lessonFraming,
  markItemDoneSchema,
  practiceCardsOf,
  recallOf,
  requestSupplementsSchema,
  requestWhySchema,
  storedCourseContent,
  submitPracticeSchema,
  submitRecallSchema,
  whyDimensionForDepth,
  type CourseState,
  type EvidenceKind,
  type GapResolution,
  type PracticeFeedback,
  type SupplementOutcome,
  type SupplementsState,
  type WhyExhausted,
  type WhyLevelView,
  type WhyReceipt,
  type WhyState,
} from "../../contracts/courses";
import { transaction } from "../../adapters/postgres/database";
import { enqueueCourseGeneration, enqueueSupplementFetch, enqueueWhyStep } from "../../adapters/queue";
import { AI_BUDGET } from "../../adapters/ai-live";
import { parseProvenanceFields, type ProvenanceDocument, type ProvenanceState } from "../../contracts/provenance";
import { authorize } from "../identity-access/access";
import * as lifecycle from "../lifecycle-platform/repository";
import { admitDispatch } from "../processing-consent/service";
import { getHandoff } from "../materials-setup/handoff";
import { batchRow } from "../materials-setup/batches";
import { planRevision } from "../materials-setup/repository";
import { preferenceRow } from "../setup-preferences/repository";
import { ledgerTotalTokens } from "../ai-setup/repository";
import { recordCompletionIfEarned } from "../assessment-progress/service";
import { buildPracticeFeedback } from "./generation";
import { declaredGapCount, deriveGaps } from "./supplements";
import { availableWhyDepth } from "./why";
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
    // Epic-2 S4 review fix: PIN the pitch-relevant preference fields at
    // request time — the worker consumes this snapshot, never a live re-read,
    // so a background edited between request and worker-run cannot re-pitch
    // the settled course. No preference row yet pins the empty snapshot.
    const preference = await preferenceRow(client, identity.userId);
    const preferencePin = { goal: preference?.goal ?? "", topic: preference?.topic ?? "", background: preference?.background ?? "" };
    await repository.insertCourseRequest(client, { id: requestId, rootId, ownerId: identity.userId, planRevisionId: handoff.planRevisionId, selectionId: handoff.selectionId, admissionId: admission.admissionId, preferencePin });
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
    // Epic-2 S5: the practice set serves per version — one recall card per
    // stored objective on v4 rows, the legacy single recall as its own
    // one-card set view on pre-2.5 rows. Prompt/objective/source only: the
    // canonical answer and rationale of every card appear in no view. The 2.1
    // single-recall view derives from card 0 (recallOf).
    const cards = practiceCardsOf(content);
    const objectiveText = (index: number) => content.objectives.find(objective => objective.index === index)?.text ?? "";
    const recall = recallOf(content);
    const recallObjective = objectiveText(recall.objectiveIndex);
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
        // Epic-2 S4: the stored adaptation basis (v3 rows) or null on pre-2.4
        // rows, which serve unchanged and present neutrally.
        adaptation: contentAdaptation(content),
        factsDigest: contentFactsDigest(content),
        lessons: content.lessons.map((lesson, index) => ({
          number: index + 1,
          title: lesson.title,
          framing: lessonFraming(lesson),
          sections: lesson.sections.map(section => ({ text: section.text, source: { filename: section.sourceRef.filename, locator: section.sourceRef.locator } })),
        })),
        items,
        objectives: content.objectives,
        practice: {
          cards: cards.map(card => ({
            id: card.id,
            objective: objectiveText(card.objectiveIndex),
            prompt: card.prompt,
            source: { filename: card.sourceRef.filename, locator: card.sourceRef.locator },
          })),
        },
        recall: {
          prompt: recall.prompt,
          objective: recallObjective,
          source: { filename: recall.sourceRef.filename, locator: recall.sourceRef.locator },
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
// score or credit effect anywhere: done is an explicit learner action, nothing
// more. Epic-3 story 4: marking the last required item is a CONTRIBUTING verb
// for completion, so this verb invokes assessment-progress's exported
// recordCompletionIfEarned hook AFTER its own writes, joining THIS transaction
// (the AD-1 cross-module-command pattern — read-only consumption of
// assessment's interface here; this module writes no assessment table and the
// hook writes no course table).
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
    // The completion hook joins THIS transaction: if this mark was the last
    // required item of an otherwise-satisfied release, the version-scoped
    // award lands atomically with the mark (idempotent otherwise).
    await recordCompletionIfEarned(identity, rootId, command.courseId, client);
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

// ---------------------------------------------------------------------------
// Epic-2 S5 per-card practice submission: the sole reveal path for every
// card's canonical answer and rationale. ONE implementation, TWO thin verbs
// over it — submitPracticeCard (per-card, course-version-scoped, required
// learner-declared assisted flag, ONE typed evidence row per submission
// event) and the 2.1 submitRecall (card 0 of the latest ready course) which
// by its 2.1 contract returns feedback and records a CONTENT-FREE receipt
// ONLY — no evidence row, because evidence kinds are learner-declared and the
// legacy schema declares none. The durable practice receipt carries the
// declared evidence kind; a replayed command recomputes the identical
// feedback from the live course's immutable stored content while that course
// is still readable and writes NO second evidence row; once it is not
// (purged/revoked), the replay returns only the reduced receipt shape. A
// replay never INFERS an evidence kind — it returns only what the recorded
// receipt declared. NO score, credit, completion, course-attempt or
// scheduling effect exists anywhere (epics 3/4 own those), and a retry is
// always a FRESH command that lands a FRESH row — never deduplicated, never
// double-counted.
// ---------------------------------------------------------------------------
async function submitCard(
  identity: Identity,
  rawId: string,
  input: {
    // The full parsed command (its exact fields ride the replay hash — a
    // re-sent commandKey with different content conflicts honestly).
    command: Command & { attempted: string };
    // The learner-declared evidence kind. Present ONLY on the practice verb
    // (its schema requires the assisted declaration); absent on the legacy
    // recall verb, which records no typed evidence at all.
    evidenceKind?: EvidenceKind;
    // The exact ready course version (per-version practice set); null resolves
    // the latest ready course — the 2.1 single-recall behavior.
    courseId: string | null;
    cardId: string | null;
    receiptKind: "submit-practice" | "submit-recall";
  },
): Promise<PracticeFeedback> {
  const rootId = parse(uuid, rawId);
  const command = input.command;
  return transaction(async client => {
    await authorize(client, identity);
    await lifecycle.scopedRoot(client, identity.userId, rootId);
    const item = await batchRow(client, rootId);
    if (item.revision !== command.expectedRevision) fail("CONFLICT");
    const hash = requestHash({ rootId, command });
    const repeated = await lifecycle.replay(client, identity.userId, command, input.receiptKind, hash);
    if (repeated) {
      // Command replay: the recorded feedback returns idempotently and NO
      // second evidence row is written. The feedback is recomputed from the
      // still-readable course's immutable stored content, carrying only the
      // evidence kind the recorded receipt declared — never an inferred one;
      // a purged course returns only the reduced receipt shape.
      const prior = repeated as { operationId?: string; cardId?: string; evidenceKind?: EvidenceKind };
      const course = prior.operationId ? await repository.readyCourseById(client, identity.userId, rootId, prior.operationId) : null;
      if (course?.content) {
        const settled = storedCourseContent(course.content);
        if (settled) {
          const cards = practiceCardsOf(settled);
          const card = prior.cardId ? cards.find(candidate => candidate.id === prior.cardId) : cards[0];
          if (card) return buildPracticeFeedback({ rootId, revision: item.revision, courseId: course.id, card, attempted: command.attempted, ...(prior.evidenceKind !== undefined ? { evidenceKind: prior.evidenceKind } : {}) });
        }
      }
      return repeated as unknown as PracticeFeedback; // course no longer readable: reduced shape only
    }
    const course = input.courseId
      ? await repository.readyCourseById(client, identity.userId, rootId, input.courseId)
      : await repository.latestReadyCourse(client, identity.userId, rootId);
    if (!course?.content) fail("CONFLICT"); // nothing studyable yet — confirm and generate first
    await lifecycle.assertObjects(client, identity.userId, [course.object_id, ...(course.object_ids ?? [])].filter((id): id is string => !!id));
    const content = storedCourseContent(course.content);
    if (!content) fail("RETRYABLE_FAILURE");
    const cards = practiceCardsOf(content);
    const card = input.cardId ? cards.find(candidate => candidate.id === input.cardId) : cards[0];
    if (!card) fail("CONFLICT"); // the card is not part of this course version — re-read the course
    const feedback = buildPracticeFeedback({ rootId, revision: item.revision, courseId: course.id, card, attempted: command.attempted, ...(input.evidenceKind !== undefined ? { evidenceKind: input.evidenceKind } : {}) });
    // ONLY the practice verb's learner-declared flag records typed evidence.
    if (input.evidenceKind !== undefined)
      await repository.insertPracticeAttempt(client, { ownerId: identity.userId, courseId: course.id, cardId: card.id, attempted: command.attempted, outcome: feedback.outcome, evidenceKind: input.evidenceKind });
    // The receipt is CONTENT-FREE and carries the declared evidence kind only
    // on the practice verb (the recall receipt has none to carry).
    const recorded: Receipt & { cardId: string; outcome: PracticeFeedback["outcome"]; evidenceKind?: EvidenceKind } = {
      rootId,
      operationId: course.id,
      revision: item.revision,
      cardId: card.id,
      outcome: feedback.outcome,
      ...(input.evidenceKind !== undefined ? { evidenceKind: input.evidenceKind } : {}),
    };
    await lifecycle.receipt(client, identity, command, input.receiptKind, hash, recorded);
    return feedback;
  });
}

// Epic-2 S5 per-card practice submission over the exact ready course version.
export async function submitPracticeCard(identity: Identity, rawId: string, raw: unknown): Promise<PracticeFeedback> {
  const command = parse(submitPracticeSchema, raw);
  return submitCard(identity, rawId, {
    command,
    // Learner-declared at submission, never inferred; the two evidence kinds
    // are never conflated (D2).
    evidenceKind: command.assisted ? "assisted" : "unaided",
    courseId: command.courseId,
    cardId: command.cardId,
    receiptKind: "submit-practice",
  });
}

// The 2.1 single-recall endpoint, now a thin verb over the same machinery:
// card 0 of the latest ready course. By the 2.1 contract it returns feedback
// and records a content-free receipt ONLY — no typed evidence row, because
// evidence kinds are learner-declared and this verb's schema declares none.
// Legacy receipts recorded before 2.5 replay through the same reduced path.
export async function submitRecall(identity: Identity, rawId: string, raw: unknown): Promise<PracticeFeedback> {
  const command = parse(submitRecallSchema, raw);
  return submitCard(identity, rawId, {
    command,
    courseId: null,
    cardId: null,
    receiptKind: "submit-recall",
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

// ---------------------------------------------------------------------------
// Epic-2 S6: learner-controlled why exploration with honest stopping. The
// "Go deeper" command runs against ONE ready course version and ONE lesson:
// evidence availability is computed HERE, from the stored course content plus
// the verified supplements of the latest settled pass, BEFORE any admission —
// a request past it returns the honest exhaustion verdict with ZERO dispatch,
// zero writes and no stored response (the verdict is deterministic, so an
// identical retry verdicts identically). An admitted level enqueues one
// restart-safe job; the row is one per (owner, course version, lesson, depth),
// so a repeat command replays the settled explanation instead of dispatching,
// a stranded pending row past the honest 120-second cap self-heals, and an
// honest retry after failure re-pends the row under a fresh admission. Depth
// NEVER unlocks anything: no tracker, credit, completion or content effect
// exists on any path below. The processor is never called here — only the
// worker settles, and only after the settlement fences still hold.
// ---------------------------------------------------------------------------

export async function requestWhyStep(identity: Identity, rawId: string, raw: unknown): Promise<WhyReceipt | WhyExhausted> {
  const rootId = parse(uuid, rawId);
  const command = parse(requestWhySchema, raw);
  const outcome = await transaction(async client => {
    await authorize(client, identity);
    await lifecycle.scopedRoot(client, identity.userId, rootId);
    const hash = requestHash({ rootId, command });
    const repeated = await lifecycle.replay(client, identity.userId, command, "request-why", hash);
    if (repeated) return repeated as WhyReceipt;
    const item = await batchRow(client, rootId);
    if (item.revision !== command.expectedRevision) fail("CONFLICT");
    // A why step requires a studyable course for THIS owner and root — the
    // same actionable state as every other study verb (generate first).
    const course = await repository.readyCourseById(client, identity.userId, rootId, command.courseId);
    if (!course || !course.content || !course.object_id) fail("CONFLICT");
    const content = storedCourseContent(course.content);
    if (!content) fail("RETRYABLE_FAILURE");
    const lesson = content.lessons[command.lessonIndex];
    if (!lesson) fail("CONFLICT"); // unknown lesson for this course version
    // Availability is a PRECONDITION, not a worker outcome: past the stored
    // evidence the answer is the honest exhaustion verdict — zero dispatch,
    // zero writes (the transaction below this point is all reads so far).
    const supplements = await repository.verifiedSupplementPool(client, identity.userId, command.courseId);
    const available = availableWhyDepth(content, command.lessonIndex, supplements);
    if (command.depth > available) {
      return {
        rootId,
        revision: item.revision,
        courseId: command.courseId,
        lessonIndex: command.lessonIndex,
        depth: command.depth,
        state: "exhausted" as const,
        availableDepth: available,
      };
    }
    // Successive levels: the level below must be settled ready first (fixed
    // dimension sequencing — the ladder never skips a rung).
    if (command.depth > 1) {
      const prior = await repository.whyRowFor(client, identity.userId, command.courseId, command.lessonIndex, command.depth - 1);
      if (!prior || prior.status !== "ready") fail("CONFLICT");
    }
    // Same-level replay: a repeat command returns the settled explanation; a
    // stranded pending row past the honest 120-second cap is failed 'timeout'
    // (a late delivery no-ops against the status/admission guards) and this
    // command proceeds to a fresh admission.
    const existing = await repository.whyRowFor(client, identity.userId, command.courseId, command.lessonIndex, command.depth);
    if (existing && existing.status === "ready") {
      const recorded: WhyReceipt = {
        rootId,
        operationId: existing.id,
        revision: item.revision,
        state: "ready",
        courseId: command.courseId,
        lessonIndex: command.lessonIndex,
        depth: command.depth,
      };
      await lifecycle.receipt(client, identity, command, "request-why", hash, recorded);
      return recorded;
    }
    if (existing && existing.status === "pending") {
      if (Date.now() - existing.created_at.getTime() <= 120_000) {
        const recorded: WhyReceipt = {
          rootId,
          operationId: existing.id,
          revision: item.revision,
          state: "pending",
          courseId: command.courseId,
          lessonIndex: command.lessonIndex,
          depth: command.depth,
        };
        await lifecycle.receipt(client, identity, command, "request-why", hash, recorded);
        return recorded;
      }
      await repository.markWhyFailed(client, existing.id, "timeout");
    }
    // Admission fence scope: the course's own lifecycle object plus its exact
    // generation lineage — bounded by the dispatch scope's 16-object cap.
    const objectIds = [course.object_id, ...(course.object_ids ?? [])].filter((id): id is string => !!id).slice(0, 16);
    const admission = await admitDispatch(client, identity, { commandKey: command.commandKey, objectIds });
    if (admission.outcome !== "admitted") return { blocked: admission.outcome } as const;
    // Budget pre-check covers the explanation completion's maximum output; a
    // declined or lapsed consent never reaches this point (zero dispatch, no
    // row — the transaction rolls back).
    const ledger = await ledgerTotalTokens(client, identity.userId);
    if (ledger + AI_BUDGET.maxOutputTokens > AI_BUDGET.totalTokenCap) fail("AI_BUDGET_EXHAUSTED");
    const rowId = existing?.id ?? crypto.randomUUID();
    await repository.upsertWhyRequest(client, { id: rowId, rootId, ownerId: identity.userId, courseId: command.courseId, lessonIndex: command.lessonIndex, depth: command.depth, admissionId: admission.admissionId });
    await enqueueWhyStep(client, { schemaVersion: 1, requestId: rowId, admissionId: admission.admissionId, courseId: command.courseId, rootId, ownerId: identity.userId, sessionId: identity.sessionId, lessonIndex: command.lessonIndex, depth: command.depth });
    const recorded: WhyReceipt = {
      rootId,
      operationId: rowId,
      revision: item.revision,
      state: "pending",
      courseId: command.courseId,
      lessonIndex: command.lessonIndex,
      depth: command.depth,
    };
    await lifecycle.receipt(client, identity, command, "request-why", hash, recorded);
    return recorded;
  });
  if ("blocked" in outcome)
    fail(outcome.blocked === "blocked-quota" ? "RATE_LIMITED" : "FORBIDDEN_OR_NOT_FOUND");
  return outcome;
}

// Owner-scoped, lineage-fenced why state for ONE lesson of one ready course
// version. The optional `requested` selector (course id uuid or per-root
// version number) mirrors getCourse's explicit prior-version read path; the
// 0-based `lesson` index selects the lesson whose ladder is served. The
// server-computed availableDepth rides along so the stepper never offers a
// level it cannot ground; settled levels serve their explanation, citations
// and model provenance; and no field anywhere carries a tracker, credit,
// completion or unlock semantic.
export async function getWhyState(identity: Identity, rawId: string, requested?: string, rawLesson?: string): Promise<WhyState & { objectIds: string[] }> {
  const rootId = parse(uuid, rawId);
  if (requested !== undefined && !uuid.safeParse(requested).success && !/^[1-9]\d*$/u.test(requested)) fail("INVALID_INPUT");
  if (rawLesson === undefined || !/^[0-7]$/u.test(rawLesson)) fail("INVALID_INPUT");
  const lessonIndex = Number(rawLesson);
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
    const content = storedCourseContent(row.content);
    if (!content) fail("RETRYABLE_FAILURE");
    const lesson = content.lessons[lessonIndex];
    if (!lesson) fail("CONFLICT"); // unknown lesson for this course version
    const supplements = await repository.verifiedSupplementPool(client, identity.userId, row.id);
    const available = availableWhyDepth(content, lessonIndex, supplements);
    const rows = await repository.whyRowsForLesson(client, identity.userId, row.id, lessonIndex);
    const byDepth = new Map(rows.map(row => [row.depth, row]));
    const levels: WhyLevelView[] = Array.from({ length: MAX_WHY_DEPTH }, (_, position) => position + 1).map(depth => {
      const dimension = whyDimensionForDepth(depth);
      const record = byDepth.get(depth);
      if (!record)
        return { depth, dimension, status: depth <= available ? ("available" as const) : ("exhausted" as const) };
      if (record.status === "pending") return { depth, dimension, status: "pending" as const, requestId: record.id };
      if (record.status === "failed") return { depth, dimension, status: "failed" as const, requestId: record.id, failureCode: record.failure_code };
      return {
        depth,
        dimension,
        status: "ready" as const,
        requestId: record.id,
        explanation: {
          depth: record.depth,
          dimension: record.dimension!,
          text: record.explanation!,
          sources: record.sources ?? [],
          model: record.model ?? "",
          createdAt: (record.settled_at ?? record.created_at).toISOString(),
        },
      };
    });
    return {
      rootId,
      revision,
      courseId: row.id,
      version: row.version ?? 1,
      lessonIndex,
      lessonTitle: lesson.title,
      availableDepth: available,
      levels,
      objectIds: [row.object_id, ...(row.object_ids ?? [])].filter((id): id is string => !!id),
    };
  });
}

// ---------------------------------------------------------------------------
// Epic-2 S7: the versioned provenance and downstream handoff surface. A
// read-only owner-scoped, lineage-fenced document over the SAME rows the
// player views use (course row + stored content through storedCourseContent,
// course_objective/course_source lineage tables, the course's settled
// supplement pass and its why rows) — one serving truth, no parallel copies.
// Version pinning mirrors the course reads exactly: the optional `requested`
// selector (course id uuid or per-root version number) resolves one READY
// version whose IMMUTABLE block (course lineage, objectives, units, practice
// items, tracker inventory) is byte-stable across superseding revisions AND
// across the version's own derivative growth — every immutable field is
// immutable row data, which is also why no live supersession pointer exists
// in the contract. Supplements and why explanations attach to any ready
// version — a pinned prior one included — so they live in the documented
// MONOTONIC derivatives block: their passes may only ADD entries for a
// version, never rewrite or drop one. Absent a selector, the current
// confirmed revision's row wins in ANY status (honest pending/failed/none
// states), falling back to the latest ready course only when no
// current-confirmed row exists. The contract is attempt-independent by
// construction: answers, rationales, attempt content and done state have no
// fields anywhere, and a `fields=` scope declaration naming one is
// INVALID_INPUT before anything is read.
// ---------------------------------------------------------------------------
export async function getProvenance(identity: Identity, rawId: string, requested?: string, rawFields?: string): Promise<ProvenanceState & { objectIds: string[] }> {
  const rootId = parse(uuid, rawId);
  if (requested !== undefined && !uuid.safeParse(requested).success && !/^[1-9]\d*$/u.test(requested)) fail("INVALID_INPUT");
  // The scope declaration is checked against the contract FIRST: any name
  // outside it (answers, attempts, anything invented) denies the request
  // before a single row is read — the surface structurally cannot serve it.
  if (rawFields !== undefined && !parseProvenanceFields(rawFields).ok) fail("INVALID_INPUT");
  return transaction(async client => {
    await authorize(client, identity);
    await lifecycle.scopedRoot(client, identity.userId, rootId);
    const item = await batchRow(client, rootId);
    const revision = item.revision;
    const objectIdsOf = (row: repository.CourseWithScope | null) =>
      row ? [row.object_id, ...(row.object_ids ?? [])].filter((id): id is string => !!id) : [];
    let row: repository.CourseWithScope | null = null;
    if (requested !== undefined) {
      // The pinned prior-version read: only a READY course of this owner
      // resolves; anything else is the same no-leak denial as every view.
      row = uuid.safeParse(requested).success
        ? await repository.readyCourseById(client, identity.userId, rootId, requested)
        : await repository.readyCourseByVersion(client, identity.userId, rootId, Number(requested));
      if (!row) fail("FORBIDDEN_OR_NOT_FOUND");
    } else {
      // Mirrors getCourse: the current confirmed revision's own row in any
      // status, falling back to the latest ready course only when it has none.
      const current = item.confirmed_id ? await repository.courseForPlan(client, rootId, item.confirmed_id) : null;
      row = current ?? null;
      if (!row) row = await repository.latestReadyCourse(client, identity.userId, rootId);
    }
    if (!row) return { state: "none" as const, rootId, revision, objectIds: [] };
    if (row.status === "pending") return { state: "pending" as const, rootId, revision, requestId: row.id, objectIds: objectIdsOf(row) };
    if (row.status === "failed") return { state: "failed" as const, rootId, revision, requestId: row.id, failureCode: row.failure_code, objectIds: objectIdsOf(row) };
    if (!row.content || !row.settled_at) fail("RETRYABLE_FAILURE");
    const content = storedCourseContent(row.content);
    if (!content) fail("RETRYABLE_FAILURE");
    const version = row.version ?? 1;
    // One serving truth: the immutable lineage tables feed objectives and the
    // extraction ids; the stored content (through the same helpers as the
    // player views, legacy wrap included) feeds units, practice items and the
    // tracker inventory; the course's own settled rows feed supplements/why.
    const objectiveRows = await repository.courseObjectiveRows(client, row.id);
    const sourceRows = await repository.courseSourceRows(client, row.id);
    const supplementRequest = await repository.latestSupplementRequest(client, identity.userId, row.id);
    const supplementRows = supplementRequest?.status === "ready" ? await repository.supplementsForRequest(client, supplementRequest.id) : [];
    const whyRows = (await repository.whyRowsForCourse(client, identity.userId, row.id)).filter(why => why.status === "ready");
    const provenance: ProvenanceDocument = {
      immutable: {
        course: {
          id: row.id,
          version,
          lineage: {
            planRevisionId: row.plan_revision_id,
            selectionId: row.selection_id,
            extractionIds: sourceRows.map(source => source.extraction_id),
            objectId: row.object_id,
            admissionId: row.admission_id,
          },
          model: row.model ?? "",
          factsDigest: contentFactsDigest(content),
          adaptation: contentAdaptation(content),
          createdAt: row.created_at.toISOString(),
          settledAt: row.settled_at.toISOString(),
        },
        objectives: objectiveRows.map(objective => ({ position: objective.position, text: objective.objective, version })),
        units: content.lessons.flatMap((lesson, lessonIndex) =>
          lesson.sections.map((section, position) => ({
            lesson: lessonIndex + 1,
            title: lesson.title,
            position,
            text: section.text,
            sourceRef: { extractionId: section.sourceRef.extractionId, filename: section.sourceRef.filename, locator: section.sourceRef.locator },
          }))),
        practiceItems: practiceCardsOf(content).map(card => ({
          id: card.id,
          objectiveIndex: card.objectiveIndex,
          sourceRef: { extractionId: card.sourceRef.extractionId, filename: card.sourceRef.filename, locator: card.sourceRef.locator },
        })),
        trackerItems: courseTrackerItems(content).map(tracker => ({ id: tracker.id, required: tracker.required, title: tracker.title })),
      },
      derivatives: {
        supplements: supplementRows.map(supplement => ({
          position: supplement.position,
          outcome: supplement.outcome,
          url: supplement.url,
          origin: supplement.origin,
          locator: supplement.locator,
          hash: supplement.content_hash,
          retrievedAt: supplement.retrieved_at?.toISOString() ?? null,
        })),
        whyExplanations: whyRows.map(why => ({
          lesson: why.lesson_index + 1,
          depth: why.depth,
          dimension: why.dimension!,
          sources: why.sources ?? [],
        })),
      },
    };
    return { state: "ready" as const, rootId, revision, provenance, objectIds: objectIdsOf(row) };
  });
}
