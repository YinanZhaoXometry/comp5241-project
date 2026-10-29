import {
  DAILY_GENERATION_LIMIT,
  type GenerationUseView,
} from "../../contracts/assessment";
import type { AttemptRow, DisputeRow, RecoveryTargetRow } from "./repository";

// Story 7 — the pure, deterministic dispute-correction derivations (D3
// quality/correction and retry honesty; C6: policy edits and invalid-item
// findings can never revoke earned passes/completion — only pending/unearned
// decisions pause). Every input is already-recorded typed evidence; nothing
// here writes, awards or revokes anything. The two rules:
//
//   Pause          — the unearned completion decision of release C pauses
//                    while an OPEN dispute could affect it: while NO untainted
//                    satisfaction path exists on C. A passing attempt is
//                    tainted by an open dispute on THAT attempt's items; a
//                    failed attempt's recovery chain (the attempt and its
//                    retests — a retest-item dispute carries the chain's
//                    root attempt id) is tainted by any open dispute on the
//                    chain. Resolved (corrected) disputes never pause,
//                    disputes on other releases never pause C, and earned
//                    awards are structurally untouchable — the pause only
//                    gates the award INSERT in evaluateAwardOnCourse.
//   Correction     — a ledgered target group is satisfied when CLEARED by a
//                    retest (3.2) or CORRECTED by a replacement that cleared
//                    the group on a dispute of that same (root attempt,
//                    group). The additive predicate keeps the served recovery
//                    panel, the award evaluation and the roadmap on one
//                    shared truth; with zero disputes it is byte-identical
//                    to 3.2's recoverySatisfied.

export type PauseInputs = {
  courseId: string;
  attempts: AttemptRow[];
  targets: RecoveryTargetRow[];
  disputes: DisputeRow[];
};

// The single pure pause predicate (unit-covered). Attempts and disputes are
// the root's rows (the caller already scopes by owner+root); only rows
// pinning THIS release participate. Retest rows never enter directly: a
// retest-item dispute carries its chain's ROOT attempt id, so keying the
// taint on attempt_id covers the attempt and its whole chain at once.
export function deriveCompletionPause(inputs: PauseInputs): boolean {
  const open = inputs.disputes.filter(dispute => dispute.course_id === inputs.courseId && dispute.status === "under-review");
  if (!open.length) return false;
  const attempts = inputs.attempts.filter(attempt => attempt.course_id === inputs.courseId);
  // Clean pass path: a final graded passing attempt on this release whose
  // own items carry no open dispute. A dispute on an older failed attempt
  // or its retests cannot taint a newer pass — the decision rests on it.
  const cleanPass = attempts.some(
    attempt =>
      attempt.status === "graded" &&
      attempt.passed === true &&
      !open.some(dispute => dispute.attempt_id === attempt.id && dispute.retest_id === null),
  );
  if (cleanPass) return false;
  // Clean recovery path: a graded-failed attempt whose ledger is fully
  // cleared-or-corrected and whose chain (the attempt and its retests —
  // a retest-item dispute carries the chain's root attempt id) carries no
  // open dispute.
  const ledgerOf = (attemptId: string) => inputs.targets.filter(target => target.root_attempt_id === attemptId);
  const corrected = inputs.disputes.filter(dispute => dispute.status === "corrected");
  const cleanRecovery = attempts.some(
    attempt =>
      attempt.status === "graded" &&
      attempt.passed === false &&
      recoverySatisfiedWithCorrections(ledgerOf(attempt.id), corrected) &&
      !open.some(dispute => dispute.attempt_id === attempt.id),
  );
  return !cleanRecovery;
}

// The additive requirement predicate: every ledgered target reads CLEARED
// (a retest cleared it, 3.2) or CORRECTED (an open-then-corrected dispute
// covers that (root attempt, group) and its replacement cleared). An
// empty/absent ledger can never satisfy it; uncleared, untested and
// uncorrected targets are never inferred passed (AD-8).
export function recoverySatisfiedWithCorrections(
  targets: Array<Pick<RecoveryTargetRow, "root_attempt_id" | "objective_index" | "status">>,
  correctedDisputes: Array<Pick<DisputeRow, "attempt_id" | "objective_index" | "status">>,
): boolean {
  return (
    targets.length > 0 &&
    targets.every(
      target =>
        target.status === "cleared" ||
        correctedDisputes.some(dispute => dispute.attempt_id === target.root_attempt_id && dispute.objective_index === target.objective_index && dispute.status === "corrected"),
    )
  );
}

// The honest quota-delay notice (D3 retries): states the limit and its
// reset, names that saved work is unchanged and NO failed attempt was
// recorded, and never promises unlimited free generation. The pause is a
// resource limit only — pedagogical retries are unlimited, which the
// notice also states so the two limits can never be confused.
export const GENERATION_DELAY_NOTICE =
  `Daily fresh-question generation limit reached (${DAILY_GENERATION_LIMIT} per day — retests and corrected replacements; retaking the test itself is never limited). Your open work and history are saved and unchanged, and no failed attempt was recorded. Try again tomorrow.`;

// The served generation view (the surface states the named limit plainly).
export function generationUseView(usedToday: number): GenerationUseView {
  return { dailyLimit: DAILY_GENERATION_LIMIT, usedToday };
}

// Whether a start may proceed under the budget. Pure over the counter
// value; the repository's atomic upsert-increment supplies it, and a denied
// start fails INSIDE the verb's transaction so the rollback leaves zero
// rows — the structural "a quota delay never records a failed attempt".
export function generationAllows(usedToday: number): boolean {
  return usedToday < DAILY_GENERATION_LIMIT;
}
