import {
  ACTIVITY_COMPLETION_LINK_VERSION,
  EVALUATOR_VERDICT_VERSION,
  REQUIRED_TEST_ID,
  passMarkOverrideOf,
  pointsScaleOf,
  type ActivityCompletionLink,
  type AnyAttemptSnapshot,
  type AssessmentHandoffDocument,
  type AttemptSnapshot,
  type CompletionAwardView,
  type EvaluatorPolicyPin,
  type EvaluatorVerdict,
  type HandoffAttemptProjection,
  type HandoffParentPin,
  type HandoffRecoveryProjection,
  type HandoffReleasePin,
  type PassMarkSnapshot,
} from "../../contracts/assessment";
import type { AttemptRow, AwardRow, DisputeRow, RecoveryTargetRow } from "./repository";
import { deriveCompletionPause, recoverySatisfiedWithCorrections } from "./disputes";
import { displayPercentOf } from "./scoring";

// Story 8 — the pure, deterministic handoff derivations (AD-13 shared
// evaluator verdict + the versioned completion/evidence document; AD-14
// scoped reporting projections). Every input is an already-recorded fact
// (attempt/target/dispute/award/manifest rows, the pinned release's
// published snapshot build and tracker inventory); the handoff is a
// READ-TIME view with no writes anywhere. Three rules, each REUSING an
// established derivation so the surfaces can never disagree:
//
//   Evaluator     — the AD-13 "authoritative review-purpose verdict from
//   verdict         Assessment/progress's shared evaluator": outcome
//                   `demonstrated` exactly when a clean satisfaction path
//                   exists on the pinned release — a final graded pass free
//                   of open attempt-item disputes, or a graded-failed
//                   attempt whose ledger is fully cleared-or-corrected on
//                   an untainted chain — through the SAME predicates the
//                   award evaluation runs (gradeAwardsCompletion's
//                   final-only fence via the graded/pass row reads,
//                   recoverySatisfiedWithCorrections, deriveCompletionPause).
//                   Unaided by construction: the input type has no practice
//                   or self-report field at all (AD-7 separation is
//                   structural), and a provisional-typed grade can never
//                   arrive here as a pass.
//   Pinned policy — the verdict's policy is the satisfying attempt's OWN
//                   snapshotted mark/override/answer rule/rubric (root
//                   policy fixed through recovery — AD-8), falling back to
//                   the newest attempt's pin, falling back to the release's
//                   published deterministic build (the same buildSnapshot
//                   the offered disclosure serves). Later policy edits
//                   affect only later attempts and reviews — never a pinned
//                   verdict (AD-13).
//   Supersession  — no field of the document reads any live pointer or any
//   stability       row outside the pinned release's own evidence, so a
//                   superseding regeneration changes nothing in a pinned
//                   read. The arrays are immutable row data and may only
//                   APPEND (new attempts, newly planted parent manifests) —
//                   new evidence on the pinned release itself is not
//                   supersession, and an existing entry is never rewritten.
//
// The derivation imports nothing from review-port: the seam stays
// one-directional (the roadmap READS review state; review CONSUMES this
// verdict) — a review consumer computes its success sequencing from this
// surface with zero scheduling dependency, and nothing here can write or
// revoke anything.

// The pinned policy of one stored snapshot (legacy rows normalize through
// the contracts' tolerant readers — an immutable row never needs rewriting).
function policyPinOf(snapshot: AnyAttemptSnapshot): EvaluatorPolicyPin {
  return {
    passMarkPercent: snapshot.passMarkPercent,
    passMarkOverride: passMarkOverrideOf(snapshot),
    answerRule: snapshot.answerRule,
    rubric: snapshot.rubric,
  };
}

export type EvaluatorVerdictInput = {
  courseId: string;
  courseVersion: number;
  // The release's published deterministic build (the offered disclosure's
  // snapshot) — the policy fallback when no attempt pins one, AD-13's
  // "defaulting to its published policy".
  publishedPolicy: EvaluatorPolicyPin;
  // The root's attempt/target/dispute rows and the release's award row
  // (the caller already scopes by owner; the derivation filters to the
  // release below).
  attempts: AttemptRow[];
  targets: RecoveryTargetRow[];
  disputes: DisputeRow[];
  award: AwardRow | null;
};

export function deriveEvaluatorVerdict(input: EvaluatorVerdictInput): EvaluatorVerdict {
  const studied = input.attempts.filter(row => row.course_id === input.courseId);
  // Newest-first deterministically (the derivation never trusts caller
  // order): basis selection reads the newest clean path first.
  const newestFirst = [...studied].sort((a, b) => b.created_at.getTime() - a.created_at.getTime() || (a.id < b.id ? 1 : -1));
  const open = input.disputes.filter(row => row.course_id === input.courseId && row.status === "under-review");
  const corrected = input.disputes.filter(row => row.status === "corrected");
  const ledgerOf = (attemptId: string) => input.targets.filter(target => target.root_attempt_id === attemptId);
  // Clean pass path: the newest graded passing attempt whose own items
  // carry no open dispute (a retest-item dispute carries its chain's ROOT
  // attempt id, so keying on attempt_id covers whole chains).
  const passBasis = newestFirst.find(row => row.status === "graded" && row.passed === true && !open.some(dispute => dispute.attempt_id === row.id && dispute.retest_id === null)) ?? null;
  // Clean recovery path: the newest graded-failed attempt with a ledger
  // that is fully cleared-or-corrected on an untainted chain.
  const recoveryBasis =
    newestFirst.find(
      row => row.status === "graded" && row.passed === false && ledgerOf(row.id).length > 0 && recoverySatisfiedWithCorrections(ledgerOf(row.id), corrected) && !open.some(dispute => dispute.attempt_id === row.id),
    ) ?? null;
  const basis = passBasis
    ? { kind: "final-pass" as const, attemptId: passBasis.id }
    : recoveryBasis
      ? { kind: "full-recovery" as const, attemptId: recoveryBasis.id }
      : null;
  // The shared 3.7 pause predicate (the same inputs the award evaluation
  // passes): while an open dispute could affect the release's would-be
  // satisfaction paths, the pending decision pauses — and the verdict reads
  // honestly not-demonstrated (basis is null exactly then).
  const paused = deriveCompletionPause({ courseId: input.courseId, attempts: input.attempts, targets: input.targets, disputes: input.disputes });
  // The pinned policy chain: the satisfying attempt's own pin, else the
  // newest attempt's pin (its snapshot is pinned at start too), else the
  // release's published build.
  const policySource = passBasis ?? recoveryBasis ?? newestFirst[0] ?? null;
  return {
    schemaVersion: EVALUATOR_VERDICT_VERSION,
    courseId: input.courseId,
    courseVersion: input.courseVersion,
    assistance: "unaided",
    policy: policySource ? policyPinOf(policySource.snapshot) : input.publishedPolicy,
    outcome: basis ? "demonstrated" : "not-demonstrated",
    basis,
    pausedByOpenDispute: paused,
    awardAwardedAt: input.award?.awarded_at ? input.award.awarded_at.toISOString() : null,
  };
}

// The served award view (the service.ts shape; replicated here so the pure
// derivation owns the whole document — awardsForRoot returns only earned
// rows, so the timestamp is always the award instant itself).
function awardViewOf(row: AwardRow): CompletionAwardView {
  return {
    awardId: row.id,
    kind: row.kind,
    courseId: row.course_id,
    courseVersion: row.course_version,
    planRevisionId: row.plan_revision_id,
    manifest: row.manifest,
    awardedAt: (row.awarded_at ?? row.created_at).toISOString(),
  };
}

export type HandoffInput = {
  release: HandoffReleasePin;
  // The release's published deterministic snapshot build (the offered
  // disclosure's) — the verdict's policy fallback AND the required test's
  // rubric contract source.
  publishedSnapshot: AttemptSnapshot;
  // The release's tracker inventory (epic-2 content, consumed read-only):
  // the required/optional standing of each tracked activity.
  trackerItems: Array<{ id: string; required: boolean }>;
  // The root's rows (owner-scoped by the caller; filtered to the release).
  attempts: AttemptRow[];
  targets: RecoveryTargetRow[];
  disputes: DisputeRow[];
  // The release's mini-course award row, if earned.
  award: AwardRow | null;
  // The owner's parent-manifest rows (pending and awarded alike).
  parentManifests: AwardRow[];
};

export function deriveHandoffDocument(input: HandoffInput): AssessmentHandoffDocument {
  const courseId = input.release.courseId;
  const studied = input.attempts.filter(row => row.course_id === courseId);
  // Oldest-first deterministically: reporting history and marks are stable
  // orderings of immutable rows.
  const oldestFirst = [...studied].sort((a, b) => a.created_at.getTime() - b.created_at.getTime() || (a.id < b.id ? -1 : 1));
  const corrected = input.disputes.filter(row => row.status === "corrected");
  const ledgerOf = (attemptId: string) => input.targets.filter(target => target.root_attempt_id === attemptId);

  // Awards: the release's monotonic mini-course award read-only, plus every
  // parent manifest pinning it as a child (required standing + award state).
  // Monotonic: newly planted manifests may append; rows never change.
  const parents: HandoffParentPin[] = input.parentManifests
    .filter(row => row.manifest?.children.some(child => child.courseId === courseId))
    .map(row => ({
      manifestId: row.manifest_id ?? row.id,
      required: row.manifest!.children.find(child => child.courseId === courseId)!.required,
      awardedAt: row.awarded_at ? row.awarded_at.toISOString() : null,
    }));

  // Applicable pass-mark snapshots: one per attempt that started on the
  // release (active included — the pin exists from start), immutable.
  const marks: PassMarkSnapshot[] = oldestFirst.map(row => ({
    attemptId: row.id,
    status: row.status,
    passMarkPercent: row.snapshot.passMarkPercent,
    passMarkOverride: passMarkOverrideOf(row.snapshot),
    pointsScale: pointsScaleOf(row.snapshot),
    startedAt: row.created_at.toISOString(),
  }));

  // Reporting projections (AD-14): per-attempt grade/pass history with the
  // grade-kind contract (final for every graded attempt this build writes;
  // null while active), the release's recovery chain through the shared
  // additive predicate, and the computed provisional count (always 0 in
  // personal study — the typed contract epic 5 rides).
  const attemptsProjection: HandoffAttemptProjection[] = oldestFirst.map(row => ({
    attemptId: row.id,
    status: row.status,
    gradeKind: row.status === "graded" ? "final" : null,
    passed: row.status === "graded" ? row.passed === true : null,
    displayPercent:
      row.status === "graded" && row.earned_points !== null && row.total_points !== null && row.passed !== null
        ? displayPercentOf(row.earned_points, row.total_points, row.snapshot.passMarkPercent, row.passed)
        : null,
    earnedPoints: row.status === "graded" ? row.earned_points : null,
    totalPoints: row.status === "graded" ? row.total_points : null,
    pointsScale: pointsScaleOf(row.snapshot),
    startedAt: row.created_at.toISOString(),
    gradedAt: row.graded_at?.toISOString() ?? null,
  }));
  const chain = [...studied].sort((a, b) => b.created_at.getTime() - a.created_at.getTime() || (a.id < b.id ? 1 : -1)).find(row => row.status === "graded" && row.passed === false && ledgerOf(row.id).length > 0) ?? null;
  const chainTargets = chain ? [...ledgerOf(chain.id)].sort((a, b) => a.objective_index - b.objective_index) : [];
  const recovery: HandoffRecoveryProjection | null = chain
    ? {
        rootAttemptId: chain.id,
        targets: chainTargets.map(target => ({ objectiveIndex: target.objective_index, objective: target.objective, status: target.status, clearedBy: target.cleared_by })),
        requirementSatisfied: recoverySatisfiedWithCorrections(chainTargets, corrected),
      }
    : null;

  // The activity/rubric/completion links epic 6 extends: the release's
  // tracker items as done/not-done activities (required or optional), and
  // the required test as the scored activity carrying its PUBLISHED rubric
  // contract (disclosed policy only — no answer key anywhere). The builders
  // carry explicit return types (the viewOf pattern) — the literal pins
  // (schemaVersion) and role strings stay exact under them.
  const trackerLinkOf = (item: { id: string; required: boolean }): ActivityCompletionLink => ({
    schemaVersion: ACTIVITY_COMPLETION_LINK_VERSION,
    activityId: item.id,
    role: item.required ? "required-item" : "optional-activity",
    objectiveIndexes: [],
    rubric: null,
  });
  const testLink: ActivityCompletionLink = {
    schemaVersion: ACTIVITY_COMPLETION_LINK_VERSION,
    activityId: REQUIRED_TEST_ID,
    role: "required-test",
    objectiveIndexes: [...new Set(input.publishedSnapshot.items.map(item => item.objectiveIndex))].sort((a, b) => a - b),
    rubric: {
      pointsScale: pointsScaleOf(input.publishedSnapshot),
      totalPoints: input.publishedSnapshot.totalPoints,
      answerRule: input.publishedSnapshot.answerRule,
      rubric: input.publishedSnapshot.rubric,
      passMarkPercent: input.publishedSnapshot.passMarkPercent,
      passMarkOverride: passMarkOverrideOf(input.publishedSnapshot),
    },
  };
  const activities: ActivityCompletionLink[] = [...input.trackerItems.map(trackerLinkOf), testLink];

  return {
    release: input.release,
    awards: {
      miniCourse: input.award ? awardViewOf(input.award) : null,
      parents,
    },
    marks,
    evaluatorVerdict: deriveEvaluatorVerdict({
      courseId,
      courseVersion: input.release.version,
      publishedPolicy: policyPinOf(input.publishedSnapshot),
      attempts: input.attempts,
      targets: input.targets,
      disputes: input.disputes,
      award: input.award,
    }),
    reporting: {
      attempts: attemptsProjection,
      recovery,
      provisionalGrades: attemptsProjection.filter(projection => projection.gradeKind === "provisional").length,
    },
    activities,
  };
}
