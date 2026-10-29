import { DEFAULT_PASS_MARK_PERCENT, type RoadmapNode } from "../../contracts/assessment";
import { fail } from "../../platform/errors";

// Pure AD-8 arithmetic for the scored-attempt tracer. The pass decision is
// the exact integer cross-product `earned x 100 >= mark x total` — no float
// division ever decides anything — and the display is honest: one decimal
// unless the one-decimal rounding would contradict the verdict, in which case
// two decimals are shown. Golden examples (story Design Notes):
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

// The DERIVED roadmap node (no award rows anywhere): completed requires every
// required item of the current course version done AND a passed attempt on
// that same version; in progress means real engagement without completion;
// not started means neither. Pure over its inputs so the derivation is unit-
// covered and the service only gathers facts.
export type RoadmapInputs = {
  requiredItems: { total: number; done: number };
  passedAttemptOnCurrentVersion: boolean;
  anyAttempt: boolean;
};
export function deriveRoadmapNode(inputs: RoadmapInputs): RoadmapNode {
  if (
    inputs.requiredItems.total > 0 &&
    inputs.requiredItems.done >= inputs.requiredItems.total &&
    inputs.passedAttemptOnCurrentVersion
  )
    return "completed";
  if (inputs.anyAttempt || inputs.requiredItems.done > 0) return "in-progress";
  return "not-started";
}
