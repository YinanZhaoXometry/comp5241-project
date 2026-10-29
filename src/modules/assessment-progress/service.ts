import { uuid, type Identity, type Receipt } from "../../contracts/setup";
import {
  startTestSchema,
  submitAttemptSchema,
  type ActiveAttemptView,
  type AssessmentState,
  type AttemptSummary,
  type StartedAttempt,
  type SubmittedAttempt,
  type TestDescriptorView,
} from "../../contracts/assessment";
import { transaction } from "../../adapters/postgres/database";
import { authorize } from "../identity-access/access";
import * as lifecycle from "../lifecycle-platform/repository";
import { batchRow } from "../materials-setup/batches";
import { getCourse } from "../course-generation/service";
import { parse, requestHash } from "../../platform/commands";
import { fail } from "../../platform/errors";
import { buildSnapshot } from "./bank";
import { deriveRoadmapNode, scoreAttempt, verdictLine } from "./scoring";
import * as repository from "./repository";
import type { AttemptRow } from "./repository";

// Epic-3 story-1 tracer verbs: the thinnest scored path from a confirmed plan
// and ready course to a roadmap node. Every verb runs identify -> authorize ->
// scopedRoot -> lifecycle.replay/receipt (content-free) -> repository inside
// ONE transaction (AD-2). Epic-1/2 state is consumed READ-ONLY through
// getCourse — always in its own transaction BEFORE this module's transaction
// opens (nesting the two would self-deadlock on the lifecycle-root row lock).
// No AI dispatch, queue or worker involvement exists anywhere here: the test
// is synthetic derivation from the course the learner already owns.

function descriptorOf(snapshot: AttemptRow["snapshot"]): TestDescriptorView {
  return {
    testId: snapshot.testId,
    title: snapshot.title,
    source: snapshot.source,
    passMarkPercent: snapshot.passMarkPercent,
    totalPoints: snapshot.totalPoints,
    itemCount: snapshot.items.length,
    itemPoints: snapshot.items.map(item => item.points),
    answerRule: snapshot.answerRule,
    rubric: snapshot.rubric,
  };
}

// The pre-grade item view: prompt, choices, points and the linked objective —
// never the answer key.
function itemViewsOf(row: AttemptRow): ActiveAttemptView["items"] {
  return row.snapshot.items.map(item => ({
    position: item.position,
    objective: item.objective,
    prompt: item.prompt,
    choices: item.choices,
    points: item.points,
  }));
}

// The sole reveal path: per-item chosen answer, correct answer and earned
// points exist only on a graded attempt's view.
function gradedView(row: AttemptRow, revision: number): SubmittedAttempt {
  if (row.status !== "graded" || row.answers === null || row.earned_points === null || row.total_points === null || row.passed === null || row.graded_at === null)
    fail("RETRYABLE_FAILURE");
  const chosen = new Map(row.answers.map(answer => [answer.position, answer.choiceId]));
  const score = scoreAttempt(row.earned_points, row.total_points, row.snapshot.passMarkPercent);
  return {
    rootId: row.root_id,
    revision,
    state: "graded",
    attemptId: row.id,
    courseId: row.course_id,
    courseVersion: row.course_version,
    planRevisionId: row.plan_revision_id,
    startedAt: row.created_at.toISOString(),
    gradedAt: row.graded_at.toISOString(),
    earnedPoints: row.earned_points,
    totalPoints: row.total_points,
    passMarkPercent: row.snapshot.passMarkPercent,
    passed: row.passed,
    displayPercent: score.displayPercent,
    verdict: verdictLine(score),
    items: row.snapshot.items.map(item => {
      const chosenChoiceId = chosen.get(item.position) ?? null;
      return {
        position: item.position,
        objective: item.objective,
        prompt: item.prompt,
        choices: item.choices,
        points: item.points,
        chosenChoiceId,
        correctChoiceId: item.answerId,
        earned: chosenChoiceId === item.answerId ? item.points : 0,
      };
    }),
  };
}

function summaryOf(row: AttemptRow): AttemptSummary {
  return {
    attemptId: row.id,
    courseId: row.course_id,
    courseVersion: row.course_version,
    planRevisionId: row.plan_revision_id,
    status: row.status,
    startedAt: row.created_at.toISOString(),
    gradedAt: row.graded_at?.toISOString() ?? null,
    earnedPoints: row.earned_points,
    totalPoints: row.total_points,
    passed: row.passed,
    displayPercent:
      row.status === "graded" && row.earned_points !== null && row.total_points !== null
        ? scoreAttempt(row.earned_points, row.total_points, row.snapshot.passMarkPercent).displayPercent
        : null,
  };
}

// Owner-scoped assessment state. The roadmap node is DERIVED here from the
// epic-2 tracker view (through getCourse) plus this module's attempt rows —
// no award rows exist. Prior attempts stay listed on their pinned course
// versions even while a regeneration is in flight (getCourse then serves a
// non-ready state and the node honestly reports engagement, not completion).
export async function getAssessment(identity: Identity, rawId: string): Promise<AssessmentState & { objectIds: string[] }> {
  const rootId = parse(uuid, rawId);
  const course = await getCourse(identity, rootId);
  return transaction(async client => {
    await authorize(client, identity);
    await lifecycle.scopedRoot(client, identity.userId, rootId);
    const batch = await batchRow(client, rootId);
    const attempts = await repository.attemptsForRoot(client, identity.userId, rootId);
    const ready = course.state === "ready" ? course.course : null;
    const required = ready ? ready.items.filter(item => item.required) : [];
    const node = deriveRoadmapNode({
      requiredItems: { total: required.length, done: required.filter(item => item.done).length },
      passedAttemptOnCurrentVersion:
        !!ready && attempts.some(row => row.status === "graded" && row.passed === true && row.course_id === ready.courseId),
      anyAttempt: attempts.length > 0,
    });
    const base = {
      rootId,
      revision: batch.revision,
      courseId: ready?.courseId ?? null,
      version: ready?.version ?? null,
      planRevisionId: ready?.planRevisionId ?? null,
      attempts: attempts.map(summaryOf),
      node,
    };
    const open = attempts.find(row => row.status === "active");
    if (open)
      return {
        ...base,
        state: "active" as const,
        test: descriptorOf(open.snapshot),
        attempt: {
          attemptId: open.id,
          courseId: open.course_id,
          courseVersion: open.course_version,
          planRevisionId: open.plan_revision_id,
          startedAt: open.created_at.toISOString(),
          items: itemViewsOf(open),
        },
        objectIds: course.objectIds,
      };
    const latest = attempts[0];
    if (latest && latest.status === "graded")
      return { ...base, state: "graded" as const, test: descriptorOf(latest.snapshot), attempt: gradedView(latest, batch.revision), objectIds: course.objectIds };
    if (!ready) return { ...base, state: "none" as const, test: null, attempt: null, objectIds: course.objectIds };
    // Offered: the deterministic pre-start disclosure — threshold, available
    // points and scoring criteria before any start (the same build the start
    // pins, so the offered view and the snapshot always agree).
    return { ...base, state: "offered" as const, test: descriptorOf(buildSnapshot(ready.objectives)), attempt: null, objectIds: course.objectIds };
  });
}

// Start (or re-offer) the one required test. Resolves the latest ready course
// version through getCourse and pins courseId, version and planRevisionId
// into the attempt's snapshot at start (D3/AD-8): grading later reads only
// the snapshot, so supersession mid-attempt never changes a verdict. One open
// attempt per (owner, root) — a repeat start returns the pinned open attempt
// (the takeCheck precedent); a retake follows a graded row.
export async function startTest(identity: Identity, rawId: string, raw: unknown): Promise<StartedAttempt> {
  const rootId = parse(uuid, rawId);
  const command = parse(startTestSchema, raw);
  const course = await getCourse(identity, rootId);
  if (course.state !== "ready") fail("CONFLICT"); // nothing testable yet — confirm and generate first
  const pin = course.course;
  return transaction(async client => {
    await authorize(client, identity);
    await lifecycle.scopedRoot(client, identity.userId, rootId);
    const batch = await batchRow(client, rootId);
    if (batch.revision !== command.expectedRevision) fail("CONFLICT");
    const hash = requestHash({ rootId, command });
    const repeated = await lifecycle.replay(client, identity.userId, command, "start-test", hash);
    if (repeated) return repeated as unknown as StartedAttempt;
    // Fence the pinned course lineage inside THIS transaction: the getCourse
    // read happened outside it, and deletion/revocation invalidates lineage
    // objects (assertObjects walks ancestors transitively).
    await lifecycle.assertObjects(client, identity.userId, course.objectIds);
    const existing = await repository.openAttempt(client, identity.userId, rootId);
    let attemptId = existing?.id ?? crypto.randomUUID();
    // The result (and its recorded receipt) must describe the attempt actually
    // returned: a pre-existing open attempt — or a raced winner — keeps ITS
    // OWN plan-revision pin (an older course version's after a re-confirm +
    // regeneration), never the freshly resolved current course.
    let attemptPlanRevisionId = existing?.plan_revision_id ?? pin.planRevisionId;
    if (!existing) {
      const inserted = await repository.insertAttempt(client, {
        id: attemptId,
        rootId,
        ownerId: identity.userId,
        courseId: pin.courseId,
        courseVersion: pin.version,
        planRevisionId: pin.planRevisionId,
        snapshot: buildSnapshot(pin.objectives),
      });
      if (!inserted) {
        // A concurrent start committed first: its open attempt is the test.
        const winner = await repository.openAttempt(client, identity.userId, rootId);
        if (!winner) fail("RETRYABLE_FAILURE");
        attemptId = winner.id;
        attemptPlanRevisionId = winner.plan_revision_id;
      }
    }
    const result: StartedAttempt = { rootId, operationId: attemptId, planRevisionId: attemptPlanRevisionId, revision: batch.revision, state: "active" };
    await lifecycle.receipt(client, identity, command, "start-test", hash, result);
    return result;
  });
}

// Submit the open attempt exactly once. One tracked result per submit
// command: the same commandKey replays the same receipt (and the identical
// graded view, rebuilt deterministically from the stored snapshot); a NEW
// commandKey on a graded attempt is CONFLICT. Grading uses only the snapshot:
// unrounded scaled-integer cross-product against the snapshotted pass mark,
// full-credit rubric, no negative marking. The recorded receipt is
// CONTENT-FREE — no answers, no attempt text.
export async function submitAttempt(identity: Identity, rawId: string, rawAttemptId: string, raw: unknown): Promise<SubmittedAttempt> {
  const rootId = parse(uuid, rawId);
  const attemptId = parse(uuid, rawAttemptId);
  const command = parse(submitAttemptSchema, raw);
  return transaction(async client => {
    await authorize(client, identity);
    await lifecycle.scopedRoot(client, identity.userId, rootId);
    const batch = await batchRow(client, rootId);
    if (batch.revision !== command.expectedRevision) fail("CONFLICT");
    const hash = requestHash({ rootId, attemptId, command });
    const repeated = await lifecycle.replay(client, identity.userId, command, "submit-test", hash);
    if (repeated) {
      const recorded = repeated as { operationId?: string };
      const prior = await repository.attemptById(client, identity.userId, recorded.operationId ?? attemptId);
      if (prior && prior.status === "graded") return gradedView(prior, batch.revision);
      return repeated as unknown as SubmittedAttempt; // row no longer readable: reduced receipt shape only
    }
    const attempt = await repository.attemptById(client, identity.userId, attemptId);
    if (!attempt || attempt.root_id !== rootId) fail("FORBIDDEN_OR_NOT_FOUND");
    // Lineage fence: the attempt rides its plan revision's lifecycle object
    // (the replay path asserts the same fence); a broken lineage denies
    // before anything is graded.
    await lifecycle.assertObjects(client, identity.userId, [attempt.plan_revision_id]);
    if (attempt.status === "graded") fail("CONFLICT"); // one submission per attempt
    // The snapshot is the sole grading basis: answers validate against ITS
    // items; anything unmatched is INVALID_INPUT, never repaired.
    if (new Set(command.answers.map(answer => answer.position)).size !== command.answers.length) fail("INVALID_INPUT");
    for (const answer of command.answers) {
      const item = attempt.snapshot.items.find(candidate => candidate.position === answer.position);
      if (!item) fail("INVALID_INPUT");
      if (!item.choices.some(choice => choice.id === answer.choiceId)) fail("INVALID_INPUT");
    }
    const chosen = new Map(command.answers.map(answer => [answer.position, answer.choiceId]));
    const earned = attempt.snapshot.items.reduce((sum, item) => sum + (chosen.get(item.position) === item.answerId ? item.points : 0), 0);
    const score = scoreAttempt(earned, attempt.snapshot.totalPoints, attempt.snapshot.passMarkPercent);
    const claimed = await repository.gradeAttempt(client, attemptId, { answers: command.answers, earned: score.earned, total: score.total, passed: score.passed });
    if (!claimed) fail("CONFLICT"); // a duplicate delivery graded it first; the same-command replay owns retries
    const graded = await repository.attemptById(client, identity.userId, attemptId);
    if (!graded) fail("RETRYABLE_FAILURE");
    const receiptResult: Receipt = { rootId, operationId: attemptId, planRevisionId: attempt.plan_revision_id, revision: batch.revision, state: "graded" };
    await lifecycle.receipt(client, identity, command, "submit-test", hash, receiptResult);
    return gradedView(graded, batch.revision);
  });
}
