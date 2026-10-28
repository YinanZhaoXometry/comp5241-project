import { uuid, type Identity, type Receipt } from "../../contracts/setup";
import {
  startTestSchema,
  submitAttemptSchema,
  startRetestSchema,
  submitRetestSchema,
  passMarkOverrideOf,
  pointsScaleOf,
  type ActiveAttemptView,
  type ActiveRetestView,
  type AssessmentState,
  type AttemptSummary,
  type GradeDecision,
  type GradedItemView,
  type GradedRetestView,
  type RecoveryState,
  type RecoveryTargetView,
  type RetestSummary,
  type RetestGroupResult,
  type SnapshotItem,
  type StartedAttempt,
  type StartedRetest,
  type SubmittedAttempt,
  type SubmittedRetest,
  type TestDescriptorView,
} from "../../contracts/assessment";
import { transaction } from "../../adapters/postgres/database";
import { authorize } from "../identity-access/access";
import * as lifecycle from "../lifecycle-platform/repository";
import { batchRow } from "../materials-setup/batches";
import { getCourse } from "../course-generation/service";
import { parse, requestHash } from "../../platform/commands";
import { fail } from "../../platform/errors";
import { buildSnapshot, buildRetestSnapshot } from "./bank";
import { deriveRoadmapNode, displayPercentOf, earnedOfItem, gradeAwardsCompletion, groupCleared, groupResultsOf, groupViewOf, recoverySatisfied, scoreAttempt, verdictLine } from "./scoring";
import * as repository from "./repository";
import type { AttemptRow, RecoveryTargetRow, RetestRow } from "./repository";

// Epic-3 story-1 tracer verbs plus the story-2 targeted-recovery chain. Every
// verb runs identify -> authorize -> scopedRoot -> lifecycle.replay/receipt
// (content-free) -> repository inside ONE transaction (AD-2). Epic-1/2 state
// is consumed READ-ONLY through getCourse — always in its own transaction
// BEFORE this module's transaction opens (nesting the two would self-deadlock
// on the lifecycle-root row lock). Recovery reads only this module's own
// rows: the retest chain pins the ROOT attempt's course version and snapshot
// (a superseding course version never changes an open chain — AD-5). No AI
// dispatch, queue or worker involvement exists anywhere here: the test and
// its retests are synthetic derivation from the course the learner owns.
//
// Story 3: grading earns by DECLARED credit (earnedOfItem — full points, a
// disclosed rubric's exact scaled-integer credit, or zero); the disclosure
// descriptor carries the declared point scale, the carried pass-mark
// override contract and every per-item disclosed partial-credit rubric
// BEFORE any answer is submitted; every graded view is a FINAL grade
// decision (gradeKind) — the provisional contract exists only as the typed
// state epic 5 confirms and can never award completion.

function descriptorOf(snapshot: AttemptRow["snapshot"]): TestDescriptorView {
  return {
    testId: snapshot.testId,
    title: snapshot.title,
    source: snapshot.source,
    passMarkPercent: snapshot.passMarkPercent,
    pointsScale: pointsScaleOf(snapshot),
    passMarkOverride: passMarkOverrideOf(snapshot),
    totalPoints: snapshot.totalPoints,
    itemCount: snapshot.items.length,
    itemPoints: snapshot.items.map(item => item.points),
    items: snapshot.items.map(item => ({ position: item.position, points: item.points, partialCredit: item.partialCredit ?? null })),
    answerRule: snapshot.answerRule,
    rubric: snapshot.rubric,
  };
}

// The pre-grade item view: prompt, choices, points and the linked objective —
// never the answer key.
function itemViewsOf(row: { snapshot: { items: SnapshotItem[] } }): ActiveAttemptView["items"] {
  return row.snapshot.items.map(item => ({
    position: item.position,
    objectiveIndex: item.objectiveIndex,
    objective: item.objective,
    prompt: item.prompt,
    choices: item.choices,
    points: item.points,
  }));
}

// The sole reveal path for graded items — shared by the ordinary attempt view
// and the retest view: per-item chosen answer, correct answer and earned
// points exist only after that submission graded. Story 3: an item's earned
// amount is the DECLARED-credit earning (full points under the answer rule,
// the disclosed rubric's exact scaled-integer credit for a declared choice,
// zero otherwise). Callers guard the graded state first; a null answers array
// on a graded row is a fault, so it maps to no chosen answers (the guard
// already failed the request before here).
function gradedItemsOf(row: { snapshot: { items: SnapshotItem[] }; answers: Array<{ position: number; choiceId: string }> | null }): GradedItemView[] {
  const chosen = new Map((row.answers ?? []).map(answer => [answer.position, answer.choiceId]));
  return row.snapshot.items.map(item => {
    const chosenChoiceId = chosen.get(item.position) ?? null;
    return {
      position: item.position,
      objectiveIndex: item.objectiveIndex,
      objective: item.objective,
      prompt: item.prompt,
      choices: item.choices,
      points: item.points,
      chosenChoiceId,
      correctChoiceId: item.answerId,
      earned: earnedOfItem(item, chosenChoiceId),
    };
  });
}

// The sole reveal path: per-item chosen answer, correct answer and earned
// points exist only on a graded attempt's view. Story 3: the view is a FINAL
// grade decision (a deterministic objective attempt) and carries the declared
// point scale plus the carried override provenance.
function gradedView(row: AttemptRow, revision: number): SubmittedAttempt {
  if (row.status !== "graded" || row.answers === null || row.earned_points === null || row.total_points === null || row.passed === null || row.graded_at === null)
    fail("RETRYABLE_FAILURE");
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
    gradeKind: "final",
    pointsScale: pointsScaleOf(row.snapshot),
    passMarkOverride: passMarkOverrideOf(row.snapshot),
    passed: row.passed,
    displayPercent: score.displayPercent,
    verdict: verdictLine(score),
    items: gradedItemsOf(row),
  };
}

// ---------------------------------------------------------------------------
// Story 2 — targeted-recovery view builders. Recovery credit is served NEXT
// TO the original result, never merged into it.
// ---------------------------------------------------------------------------

function targetViewOf(row: RecoveryTargetRow, passMarkPercent: number, pointsScale: 1 | 100): RecoveryTargetView {
  return {
    objectiveIndex: row.objective_index,
    objective: row.objective,
    initialEarned: row.initial_earned,
    initialTotal: row.initial_total,
    pointsScale,
    // Failed groups by construction — the not-cleared verdict is what the
    // display must never contradict.
    initialDisplayPercent: displayPercentOf(row.initial_earned, row.initial_total, passMarkPercent, false),
    status: row.status,
    clearedBy: row.cleared_by,
    clearedAt: row.cleared_at?.toISOString() ?? null,
  };
}

function activeRetestOf(row: RetestRow): ActiveRetestView {
  return {
    retestId: row.id,
    rootAttemptId: row.root_attempt_id,
    courseId: row.course_id,
    courseVersion: row.course_version,
    planRevisionId: row.plan_revision_id,
    targetIndexes: row.target_objective_indexes,
    pointsScale: pointsScaleOf(row.snapshot),
    startedAt: row.created_at.toISOString(),
    items: itemViewsOf(row),
  };
}

// The retest snapshot is the sole grading basis; the stored per-group results
// rebuild deterministically into the served view (group display/verdict
// recomputed by the same cross-product — immutable rows, identical output).
function gradedRetestOf(row: RetestRow): GradedRetestView {
  if (row.status !== "graded" || row.answers === null || row.group_results === null || row.graded_at === null) fail("RETRYABLE_FAILURE");
  const objectiveOf = (index: number) => row.snapshot.items.find(item => item.objectiveIndex === index)?.objective ?? "";
  const groups: RetestGroupResult[] = row.group_results.map(group => groupViewOf({ ...group, objective: objectiveOf(group.objectiveIndex) }, row.snapshot.passMarkPercent, pointsScaleOf(row.snapshot)));
  return {
    retestId: row.id,
    rootAttemptId: row.root_attempt_id,
    courseId: row.course_id,
    courseVersion: row.course_version,
    planRevisionId: row.plan_revision_id,
    targetIndexes: row.target_objective_indexes,
    pointsScale: pointsScaleOf(row.snapshot),
    startedAt: row.created_at.toISOString(),
    gradedAt: row.graded_at.toISOString(),
    groups,
    items: gradedItemsOf(row),
  };
}

function retestSummaryOf(row: RetestRow): RetestSummary {
  return {
    retestId: row.id,
    rootAttemptId: row.root_attempt_id,
    courseVersion: row.course_version,
    targetIndexes: row.target_objective_indexes,
    status: row.status,
    startedAt: row.created_at.toISOString(),
    gradedAt: row.graded_at?.toISOString() ?? null,
    groups: row.group_results
      ? row.group_results.map(group =>
          groupViewOf(
            { ...group, objective: row.snapshot.items.find(item => item.objectiveIndex === group.objectiveIndex)?.objective ?? "" },
            row.snapshot.passMarkPercent,
            pointsScaleOf(row.snapshot),
          ),
        )
      : null,
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
    pointsScale: pointsScaleOf(row.snapshot),
    passed: row.passed,
    displayPercent:
      row.status === "graded" && row.earned_points !== null && row.total_points !== null
        ? scoreAttempt(row.earned_points, row.total_points, row.snapshot.passMarkPercent).displayPercent
        : null,
  };
}

// Story 3 — the grade decision of an attempt row. A test_attempt is a
// deterministic objective grade, so its decision is always FINAL here; the
// mapping is the single place a provisional kind would enter (epic 5's
// subjective grades), and gradeAwardsCompletion is the fence the completion
// derivation routes through — a provisional-typed result can never satisfy
// completion (D3/AD-8).
function gradeDecisionOf(row: AttemptRow): GradeDecision | null {
  if (row.status !== "graded") return null;
  return { gradeKind: "final", passed: row.passed === true };
}

// Owner-scoped assessment state. The roadmap node is DERIVED here from the
// epic-2 tracker view (through getCourse) plus this module's attempt rows —
// no award rows exist. Prior attempts stay listed on their pinned course
// versions even while a regeneration is in flight (getCourse then serves a
// non-ready state and the node honestly reports engagement, not completion).
// Story 2: the recovery chain of the newest graded-failed attempt that HAS a
// ledger (recovery opens only at grade time — a pre-ledger failed attempt
// from before 022 opens nothing; its honest path is a fresh ordinary
// attempt) is served beside the attempt result, and completion accepts a
// fully-recovered failed attempt on the CURRENT course version only — a
// chain pinned to a superseded version never completes the current node.
export async function getAssessment(identity: Identity, rawId: string): Promise<AssessmentState & { objectIds: string[] }> {
  const rootId = parse(uuid, rawId);
  const course = await getCourse(identity, rootId);
  return transaction(async client => {
    await authorize(client, identity);
    await lifecycle.scopedRoot(client, identity.userId, rootId);
    const batch = await batchRow(client, rootId);
    const attempts = await repository.attemptsForRoot(client, identity.userId, rootId);
    const targets = await repository.targetsForRoot(client, identity.userId, rootId);
    const retests = await repository.retestsForRoot(client, identity.userId, rootId);
    const ledgerOf = (attemptId: string) => targets.filter(target => target.root_attempt_id === attemptId);
    const ready = course.state === "ready" ? course.course : null;
    const required = ready ? ready.items.filter(item => item.required) : [];
    const node = deriveRoadmapNode({
      requiredItems: { total: required.length, done: required.filter(item => item.done).length },
      // The pass input routes through the provisional-grade fence: only a
      // FINAL graded pass qualifies (a provisional-typed decision maps to a
      // non-pass here and contributes nothing — D3/AD-8).
      passedAttemptOnCurrentVersion:
        !!ready &&
        attempts.some(row => {
          const decision = gradeDecisionOf(row);
          return decision !== null && gradeAwardsCompletion(decision) && row.course_id === ready.courseId;
        }),
      recoveredOnCurrentVersion:
        !!ready &&
        attempts.some(row => {
          // The SAME provisional-grade fence as the pass input: only a FINAL
          // graded FAILED attempt opens a recoverable ledger — a
          // provisional-typed row could never complete via recovery either.
          const decision = gradeDecisionOf(row);
          return (
            decision !== null &&
            decision.gradeKind === "final" &&
            !decision.passed &&
            row.course_id === ready.courseId &&
            ledgerOf(row.id).length > 0 &&
            ledgerOf(row.id).every(target => target.status === "cleared")
          );
        }),
      anyAttempt: attempts.length > 0,
    });
    // The served chain: the newest failed attempt with a ledger (attempts are
    // newest-first). Earlier chains stay durable in their rows — history is
    // never rewritten or hidden (D3).
    const recoveryRoot = attempts.find(row => row.status === "graded" && row.passed === false && ledgerOf(row.id).length > 0) ?? null;
    const chainTargets = recoveryRoot ? ledgerOf(recoveryRoot.id) : [];
    const chainRetests = recoveryRoot ? retests.filter(retest => retest.root_attempt_id === recoveryRoot.id) : [];
    const openChainRetest = chainRetests.find(retest => retest.status === "active") ?? null;
    const latestGradedChainRetest = chainRetests.find(retest => retest.status === "graded") ?? null;
    const recovery: RecoveryState | null = recoveryRoot
      ? {
          rootAttemptId: recoveryRoot.id,
          targets: chainTargets.map(target => targetViewOf(target, recoveryRoot.snapshot.passMarkPercent, pointsScaleOf(recoveryRoot.snapshot))),
          retest: openChainRetest ? activeRetestOf(openChainRetest) : latestGradedChainRetest ? gradedRetestOf(latestGradedChainRetest) : null,
          retests: chainRetests.map(retestSummaryOf),
          requirementSatisfied: recoverySatisfied(chainTargets),
        }
      : null;
    const base = {
      rootId,
      revision: batch.revision,
      courseId: ready?.courseId ?? null,
      version: ready?.version ?? null,
      planRevisionId: ready?.planRevisionId ?? null,
      attempts: attempts.map(summaryOf),
      node,
      recovery,
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
// unrounded scaled-integer cross-product against the snapshotted applicable
// pass mark, declared-credit earning (full credit, a disclosed rubric's
// exact partial credit, or zero — no negative marking). Story 2: a FAILED
// grade writes the per-objective-group recovery ledger in THIS SAME
// transaction — every failed group of THIS attempt's own snapshot lands OPEN
// with its initial earned/total; passing groups are never ledgered
// (preserved, never re-tested). The recorded receipt is CONTENT-FREE — no
// answers, no attempt text, no scores.
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
    // Story 3: earned is the DECLARED-credit sum — for a rubric-less snapshot
    // this is byte-identical to the whole-points rule (correct = full points,
    // otherwise zero); for an item with a disclosed rubric it is the exact
    // scaled-integer declared credit. Integer arithmetic only.
    const earned = attempt.snapshot.items.reduce((sum, item) => sum + earnedOfItem(item, chosen.get(item.position) ?? null), 0);
    const score = scoreAttempt(earned, attempt.snapshot.totalPoints, attempt.snapshot.passMarkPercent);
    const claimed = await repository.gradeAttempt(client, attemptId, { answers: command.answers, earned: score.earned, total: score.total, passed: score.passed });
    if (!claimed) fail("CONFLICT"); // a duplicate delivery graded it first; the same-command replay owns retries
    if (!score.passed) {
      // Ledger every failed group OPEN under this attempt's own snapshot —
      // same transaction as the failed grade (AD-8). An overall fail always
      // has at least one failed group (if every group cleared its threshold,
      // the weighted sum would pass), so an empty set here is a structural
      // fault, not an honest state.
      const failedGroups = groupResultsOf(attempt.snapshot, command.answers).filter(group => !groupCleared(group, attempt.snapshot.passMarkPercent));
      if (!failedGroups.length) fail("RETRYABLE_FAILURE");
      await repository.insertTargets(
        client,
        failedGroups.map(group => ({
          rootAttemptId: attempt.id,
          ownerId: identity.userId,
          rootId,
          courseId: attempt.course_id,
          courseVersion: attempt.course_version,
          objectiveIndex: group.objectiveIndex,
          objective: group.objective,
          initialEarned: group.earned,
          initialTotal: group.total,
        })),
      );
    }
    const graded = await repository.attemptById(client, identity.userId, attemptId);
    if (!graded) fail("RETRYABLE_FAILURE");
    const receiptResult: Receipt = { rootId, operationId: attemptId, planRevisionId: attempt.plan_revision_id, revision: batch.revision, state: "graded" };
    await lifecycle.receipt(client, identity, command, "submit-test", hash, receiptResult);
    return gradedView(graded, batch.revision);
  });
}

// ---------------------------------------------------------------------------
// Story 2 — the targeted-recovery chain verbs.
// ---------------------------------------------------------------------------

// Start (or re-offer) a fresh targeted retest of one graded-FAILED ordinary
// attempt's open target groups. The command names the root attempt and
// declares a non-empty subset of its OPEN targets (a foreign index is
// INVALID_INPUT); the retest snapshot is built from the ROOT attempt's own
// pinned snapshot — same per-group item structure and points, fresh manually
// checked questions, the ROOT attempt's pinned pass mark/rubric/answer rule
// — and the retest pins the root attempt's course/version/plan revision, so
// a superseding course version mid-chain changes nothing. One open retest per
// root attempt: a repeat start returns the pinned open retest (with ITS OWN
// declared targets and pin in the result — the returned-attempt's-own-pin
// receipt rule); a fresh retest follows a graded one.
export async function startRetest(identity: Identity, rawId: string, raw: unknown): Promise<StartedRetest> {
  const rootId = parse(uuid, rawId);
  const command = parse(startRetestSchema, raw);
  return transaction(async client => {
    await authorize(client, identity);
    await lifecycle.scopedRoot(client, identity.userId, rootId);
    const batch = await batchRow(client, rootId);
    if (batch.revision !== command.expectedRevision) fail("CONFLICT");
    const hash = requestHash({ rootId, command });
    const repeated = await lifecycle.replay(client, identity.userId, command, "start-retest", hash);
    if (repeated) return repeated as unknown as StartedRetest;
    // Only an originally FAILED graded ordinary attempt opens recovery.
    const rootAttempt = await repository.attemptById(client, identity.userId, command.attemptId);
    if (!rootAttempt || rootAttempt.root_id !== rootId) fail("FORBIDDEN_OR_NOT_FOUND");
    await lifecycle.assertObjects(client, identity.userId, [rootAttempt.plan_revision_id]);
    if (rootAttempt.status !== "graded" || rootAttempt.passed !== false) fail("CONFLICT");
    // The declaration must be a non-empty duplicate-free subset of THIS root's
    // OPEN targets — validated in EVERY state, including while an open retest
    // exists (the served winner never excuses a foreign declaration): passed
    // groups, cleared targets and indexes no item carries are INVALID_INPUT,
    // never repaired.
    if (new Set(command.targetIndexes).size !== command.targetIndexes.length) fail("INVALID_INPUT");
    const openIndexes = new Set(
      (await repository.targetsForAttempt(client, identity.userId, rootAttempt.id)).filter(target => target.status === "open").map(target => target.objective_index),
    );
    if (!command.targetIndexes.every(index => openIndexes.has(index))) fail("INVALID_INPUT");
    const existing = await repository.openRetestForRootAttempt(client, identity.userId, rootAttempt.id);
    let retestId = existing?.id ?? crypto.randomUUID();
    let planRevisionId = existing?.plan_revision_id ?? rootAttempt.plan_revision_id;
    // The declared subset of the retest actually returned (an existing open
    // retest keeps ITS OWN declaration — never the fresh command's).
    let targetIndexes: number[] = existing?.target_objective_indexes ?? [];
    if (!existing) {
      const inserted = await repository.insertRetest(client, {
        id: retestId,
        rootAttemptId: rootAttempt.id,
        ownerId: identity.userId,
        rootId,
        courseId: rootAttempt.course_id,
        courseVersion: rootAttempt.course_version,
        planRevisionId: rootAttempt.plan_revision_id,
        targetIndexes: command.targetIndexes,
        snapshot: buildRetestSnapshot(rootAttempt.snapshot, command.targetIndexes),
      });
      if (!inserted) {
        // A concurrent start committed first: its open retest is the retest.
        const winner = await repository.openRetestForRootAttempt(client, identity.userId, rootAttempt.id);
        if (!winner) fail("RETRYABLE_FAILURE");
        retestId = winner.id;
        planRevisionId = winner.plan_revision_id;
        targetIndexes = winner.target_objective_indexes;
      } else {
        targetIndexes = [...command.targetIndexes];
      }
    }
    const result: StartedRetest = { rootId, operationId: retestId, planRevisionId, targetIndexes, revision: batch.revision, state: "active" };
    await lifecycle.receipt(client, identity, command, "start-retest", hash, result);
    return result;
  });
}

// Submit the open retest exactly once. One tracked result per submit command
// (same commandKey replays the identical graded view; a NEW commandKey on a
// graded retest is CONFLICT). Grading computes each declared target group's
// earned/total under the retest's own snapshot — which mirrors the root
// blueprint one-for-one — and a group CLEARS only when it independently
// reaches the ROOT attempt's snapshotted pass mark by the same integer
// cross-product; clearing is the status-guarded ledger transition inside THIS
// retest's grade transaction. The original ordinary row is never touched.
// The recorded receipt is CONTENT-FREE — no answers, no group results.
export async function submitRetest(identity: Identity, rawId: string, rawRetestId: string, raw: unknown): Promise<SubmittedRetest> {
  const rootId = parse(uuid, rawId);
  const retestId = parse(uuid, rawRetestId);
  const command = parse(submitRetestSchema, raw);
  return transaction(async client => {
    await authorize(client, identity);
    await lifecycle.scopedRoot(client, identity.userId, rootId);
    const batch = await batchRow(client, rootId);
    if (batch.revision !== command.expectedRevision) fail("CONFLICT");
    const hash = requestHash({ rootId, retestId, command });
    const repeated = await lifecycle.replay(client, identity.userId, command, "submit-retest", hash);
    if (repeated) {
      const recorded = repeated as { operationId?: string };
      const prior = await repository.retestById(client, identity.userId, recorded.operationId ?? retestId);
      if (prior && prior.status === "graded") return { ...gradedRetestOf(prior), rootId, revision: batch.revision, state: "graded" as const };
      return repeated as unknown as SubmittedRetest; // row no longer readable: reduced receipt shape only
    }
    const retest = await repository.retestById(client, identity.userId, retestId);
    if (!retest || retest.root_id !== rootId) fail("FORBIDDEN_OR_NOT_FOUND");
    // The retest rides the ROOT attempt's plan-revision lifecycle object; a
    // broken lineage denies before anything is graded or cleared.
    const rootAttempt = await repository.attemptById(client, identity.userId, retest.root_attempt_id);
    if (!rootAttempt) fail("FORBIDDEN_OR_NOT_FOUND");
    await lifecycle.assertObjects(client, identity.userId, [rootAttempt.plan_revision_id]);
    if (retest.status === "graded") fail("CONFLICT"); // one submission per retest
    // The retest snapshot is the sole grading basis: answers validate against
    // ITS items; anything unmatched is INVALID_INPUT, never repaired.
    if (new Set(command.answers.map(answer => answer.position)).size !== command.answers.length) fail("INVALID_INPUT");
    for (const answer of command.answers) {
      const item = retest.snapshot.items.find(candidate => candidate.position === answer.position);
      if (!item) fail("INVALID_INPUT");
      if (!item.choices.some(choice => choice.id === answer.choiceId)) fail("INVALID_INPUT");
    }
    // Root policy fixed through the chain: the retest snapshot carries the
    // ROOT attempt's snapshotted pass mark (buildRetestSnapshot pinned it).
    const mark = retest.snapshot.passMarkPercent;
    const groups = groupResultsOf(retest.snapshot, command.answers);
    const stored = groups.map(group => ({ objectiveIndex: group.objectiveIndex, earned: group.earned, total: group.total, cleared: groupCleared(group, mark) }));
    const claimed = await repository.gradeRetest(client, retestId, { answers: command.answers, groupResults: stored });
    if (!claimed) fail("CONFLICT"); // a duplicate delivery graded it first; the same-command replay owns retries
    // Status-guarded clears, only for groups that independently reached the
    // root mark, inside the retest's grade transaction.
    for (const group of stored) if (group.cleared) await repository.clearTarget(client, retest.root_attempt_id, group.objectiveIndex, retestId);
    const graded = await repository.retestById(client, identity.userId, retestId);
    if (!graded) fail("RETRYABLE_FAILURE");
    const receiptResult: Receipt = { rootId, operationId: retestId, planRevisionId: retest.plan_revision_id, revision: batch.revision, state: "graded" };
    await lifecycle.receipt(client, identity, command, "submit-retest", hash, receiptResult);
    return { ...gradedRetestOf(graded), rootId, revision: batch.revision, state: "graded" as const };
  });
}
