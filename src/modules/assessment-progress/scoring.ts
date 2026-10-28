import {
  DEFAULT_PASS_MARK_PERCENT,
  type AttemptAnswer,
  type AttemptSnapshot,
  type GradeDecision,
  type ParentManifestChild,
  type PartialCreditSnapshot,
  type RecoveryTargetView,
  type RetestGroupResult,
  type RetestSnapshot,
  type RoadmapNode,
  type SnapshotItem,
} from "../../contracts/assessment";
import { fail } from "../../platform/errors";

// Pure AD-8 arithmetic for the scored-attempt tracer, its targeted recovery
// and the story-3 scoring surface (disclosed finite-precision partial
// credit). The pass decision is the exact integer cross-product
// `earned x 100 >= mark x total` — no float division ever decides anything —
// and it is SCALE-INVARIANT: earned and total are scaled integers in the
// snapshot's declared pointsScale, so the same cross-product decides at
// whole points (7996/10000) and at hundredths (799600/1000000). The display
// is honest: one decimal unless the one-decimal rounding would contradict
// the verdict, in which case two decimals are shown. The SAME cross-product
// decides each objective group's fate (story 2): a recovery target clears
// only when its retest group independently reaches the ROOT attempt's
// snapshotted mark. Golden examples (story Design Notes):
//   earned=7996, total=10000 -> 7996x100 < 80x10000 -> Not passed; display
//   "79.96%" (one-decimal "80.0%" would mislead).
//   earned=8000 -> 8000x100 >= 80x10000 -> Pass; display "80.0%".

export type ScoreResult = {
  earned: number;
  total: number;
  passMarkPercent: number;
  passed: boolean;
  displayPercent: string;
};

// Tenths/hundredths of a percent from integer arithmetic only.
const tenthsOfPercent = (earned: number, total: number) => Math.round((earned * 1000) / total);
const hundredthsOfPercent = (earned: number, total: number) => Math.round((earned * 10000) / total);

export function displayPercentOf(earned: number, total: number, passMarkPercent: number, passed: boolean): string {
  const oneDecimal = tenthsOfPercent(earned, total) / 10;
  // One decimal only when it cannot contradict the verdict: showing a value
  // at/above the mark on a Not passed verdict (or below it on a Pass) would
  // mislead, so the honest two-decimal value is shown instead.
  const misleading = passed ? oneDecimal < passMarkPercent : oneDecimal >= passMarkPercent;
  if (!misleading) return `${oneDecimal.toFixed(1)}%`;
  return `${(hundredthsOfPercent(earned, total) / 100).toFixed(2)}%`;
}

export function scoreAttempt(earned: number, total: number, passMarkPercent: number = DEFAULT_PASS_MARK_PERCENT): ScoreResult {
  // Invalid/zero-total rubrics are rejected (AD-8), never repaired.
  if (!Number.isInteger(earned) || !Number.isInteger(total) || !Number.isInteger(passMarkPercent)) fail("INVALID_INPUT");
  if (earned < 0 || total <= 0 || earned > total) fail("INVALID_INPUT");
  if (passMarkPercent < 1 || passMarkPercent > 100) fail("INVALID_INPUT");
  // Overflow-safe by construction on this scale; the guard keeps the promise
  // structural if the point scale ever grows.
  if (!Number.isSafeInteger(earned * 100) || !Number.isSafeInteger(passMarkPercent * total)) fail("INVALID_INPUT");
  const passed = earned * 100 >= passMarkPercent * total;
  return { earned, total, passMarkPercent, passed, displayPercent: displayPercentOf(earned, total, passMarkPercent, passed) };
}

// The spine's honest verdict line, e.g. `79.96% — Not passed (mark is 80%)`.
export function verdictLine(score: ScoreResult): string {
  return `${score.displayPercent} — ${score.passed ? "Pass" : "Not passed"} (mark is ${score.passMarkPercent}%)`;
}

// Story 3 — DECLARED-CREDIT EARNING (D3/AD-8): the earned points of one
// item. The declared correct answer earns the item's full points (the
// answer-rule default); any other choice earns its DECLARED partial credit
// when the item carries a disclosed rubric, otherwise zero (an absent
// rubric means full credit only — the whole 3.1/3.2 behavior); an
// unanswered item earns zero. Every credit is a nonnegative scaled integer
// validated at snapshot build (never exceeding the item's points, never
// keyed on the answer), so the earning is exact by construction — no float
// ever runs.
export function earnedOfItem(item: Pick<SnapshotItem, "answerId" | "points" | "partialCredit">, chosenChoiceId: string | null): number {
  if (chosenChoiceId === null) return 0;
  if (chosenChoiceId === item.answerId) return item.points;
  return item.partialCredit?.credits[chosenChoiceId] ?? 0;
}

// Story 3 — SCALE-AWARE POINT DISPLAY: renders a scaled-integer point value
// for humans — whole points at scale 1, exactly two decimals at scale 100 —
// using integer arithmetic only. Display never decides anything; it renders
// the snapshot's declared scale and can never contradict the verdict (the
// verdict comes from the cross-product on the raw integers).
export function displayPointsOf(value: number, pointsScale: number): string {
  if (!Number.isInteger(value) || value < 0) fail("INVALID_INPUT");
  if (pointsScale === 100) {
    const whole = Math.floor(value / 100);
    const hundredths = value % 100;
    return `${whole}.${hundredths.toString().padStart(2, "0")}`;
  }
  return `${value}`;
}

// Story 3 — the PROVISIONAL-GRADE FENCE (D3/AD-8): completion accepts only
// a FINAL graded pass (or full recovery). A provisional-typed decision
// carries no `passed` field at all, so this guard — the single gate every
// completion derivation routes through — structurally cannot read a pass
// off it. Epic 5 confirms provisional instructor grades; until then no
// writer produces one, and nothing provisional can award completion.
export function gradeAwardsCompletion(decision: GradeDecision): boolean {
  return decision.gradeKind === "final" && decision.passed;
}

// Story 2 — per-objective-group arithmetic (AD-8 targeted credit). One group
// per distinct objectiveIndex a snapshot's items carry, ordered by first
// appearance: earned sums the mirrored items' EARNED amounts (story 3: the
// declared-credit rule — full points, declared partial credit or zero per
// item); total sums the group's per-item points. Pure over its inputs; the
// service validates answers against the snapshot BEFORE calling.
export type GroupResult = {
  objectiveIndex: number;
  objective: string;
  earned: number;
  total: number;
};
export function groupResultsOf(
  snapshot: AttemptSnapshot | RetestSnapshot | PartialCreditSnapshot,
  answers: AttemptAnswer[],
): GroupResult[] {
  const chosen = new Map(answers.map(answer => [answer.position, answer.choiceId]));
  const groups: GroupResult[] = [];
  for (const item of snapshot.items) {
    let group = groups.find(candidate => candidate.objectiveIndex === item.objectiveIndex);
    if (!group) {
      group = { objectiveIndex: item.objectiveIndex, objective: item.objective, earned: 0, total: 0 };
      groups.push(group);
    }
    group.total += item.points;
    group.earned += earnedOfItem(item, chosen.get(item.position) ?? null);
  }
  return groups;
}

// A group clears only when it INDEPENDENTLY reaches the root attempt's
// snapshotted pass mark by the same integer cross-product — no averaging, no
// cross-group credit.
export function groupCleared(group: Pick<GroupResult, "earned" | "total">, passMarkPercent: number = DEFAULT_PASS_MARK_PERCENT): boolean {
  if (!Number.isInteger(group.earned) || !Number.isInteger(group.total) || !Number.isInteger(passMarkPercent)) fail("INVALID_INPUT");
  if (group.earned < 0 || group.total <= 0 || group.earned > group.total) fail("INVALID_INPUT");
  if (passMarkPercent < 1 || passMarkPercent > 100) fail("INVALID_INPUT");
  if (!Number.isSafeInteger(group.earned * 100) || !Number.isSafeInteger(passMarkPercent * group.total)) fail("INVALID_INPUT");
  return group.earned * 100 >= passMarkPercent * group.total;
}

// The failed-test requirement is satisfied ONLY when every ledgered target
// reads cleared. An empty/absent ledger can never satisfy it: uncleared or
// untested targets are never inferred passed (AD-8).
export function recoverySatisfied(targets: Array<Pick<RecoveryTargetView, "status">>): boolean {
  return targets.length > 0 && targets.every(target => target.status === "cleared");
}

// Served group view: the honest display rides the group's own verdict; the
// declared point scale rides along so scaled-integer amounts render for
// humans (story 3).
export function groupViewOf(group: GroupResult, passMarkPercent: number, pointsScale: 1 | 100): RetestGroupResult {
  const cleared = groupCleared(group, passMarkPercent);
  return {
    ...group,
    pointsScale,
    cleared,
    displayPercent: displayPercentOf(group.earned, group.total, passMarkPercent, cleared),
  };
}

// The DERIVED roadmap node (story 4: derived FROM AWARD ROWS). Completed
// exists only when an earned version-scoped award pins the studied release —
// the award itself records that every required item was done and the
// required test was passed (final grade through the provisional fence) or
// fully recovered at the moment it landed, and an earned award is monotonic,
// so nothing later un-completes it (supersession, policy edits, review
// outcomes, a later failed retake). A passed or fully-recovered attempt with
// NO award yet keeps the node honestly In progress (pre-award data or an
// evaluation that has not landed); in progress otherwise means real
// engagement (any attempt, or a required item of the studied release done);
// not started means neither. Pure over its inputs so the derivation is
// unit-covered and the service only gathers facts.
export type RoadmapInputs = {
  awardOnCurrentVersion: boolean;
  requiredItems: { total: number; done: number };
  anyAttempt: boolean;
};
export function deriveRoadmapNode(inputs: RoadmapInputs): RoadmapNode {
  if (inputs.awardOnCurrentVersion) return "completed";
  if (inputs.anyAttempt || inputs.requiredItems.done > 0) return "in-progress";
  return "not-started";
}

// ---------------------------------------------------------------------------
// Story 4 — the pure completion and parent predicates (AD-5/AD-8/D1).
// ---------------------------------------------------------------------------

// Mini-course completion is EARNED, never read-time derived: every REQUIRED
// tracker item of the release done (epic-2 evidence, consumed read-only)
// AND the release's required-test requirement satisfied — an ordinary final
// pass (the caller computes it through gradeAwardsCompletion, so a
// provisional-typed grade can never arrive here as a pass) or full recovery
// (every ledger target of a failed attempt on this release cleared).
// Nothing else awards: no dwell, no engagement, no self-report. An empty
// required set can never earn (there is no required work to complete).
export type CompletionEarnedInputs = {
  requiredItems: { total: number; done: number };
  testSatisfied: boolean;
};
export function completionEarned(inputs: CompletionEarnedInputs): boolean {
  return inputs.requiredItems.total > 0 && inputs.requiredItems.done >= inputs.requiredItems.total && inputs.testSatisfied;
}

// Parent completion (AD-5/AD-8): the manifest's REQUIRED child releases must
// all carry awards; OPTIONAL children never block. A manifest with no
// required child has no completion condition and awards nothing — a
// vacuous "every required child awarded" must not auto-award.
export function parentEarned(children: ParentManifestChild[], awardedCourseIds: string[]): boolean {
  const required = children.filter(child => child.required);
  if (!required.length) return false;
  const awarded = new Set(awardedCourseIds);
  return required.every(child => awarded.has(child.courseId));
}
