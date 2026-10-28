import {
  REQUIRED_TEST_ID,
  RETEST_TEST_ID,
  attemptSnapshotSchema,
  retestSnapshotSchema,
  DEFAULT_PASS_MARK_PERCENT,
  type AssessmentChoice,
  type AttemptSnapshot,
  type RetestSnapshot,
} from "../../contracts/assessment";
import { fail } from "../../platform/errors";

// MANUALLY AUTHORED SYNTHETIC TEST BANK — NOT generator output. This is the
// D7 fixture the story plan names: every item's correct choice must be
// trivially, self-evidently true against its synthetic claim (the per-item
// verification list is recorded in the story plan's Implementation Notes),
// the rubric declares full credit only, and the per-item points
// [1999, 1999, 1999, 1999, 2004] sum to exactly 10000 — the 2004-point fifth
// item is what makes the honest 79.96% boundary reachable: correct on the
// first four items and wrong on the fifth earns 7996/10000, which the
// unrounded cross-product correctly holds below the 80% mark.
//
// {objective} is the only course-derived substitution, resolved positionally
// at start: item position p (1-based) links to the course objective at array
// position (p - 1) mod objectives.length, so every course objective set of
// size 1..8 resolves every link — nothing is renumbered or fabricated.
//
// Story 2 adds the FRESH retest pool below: one fresh single-choice item per
// bank position with the SAME objective slot resolution and the SAME
// per-item points, manually checked the same way. Retest comparability is
// structural (D3/AD-8): each target group's retest items mirror the root
// blueprint's per-item points for that group one-for-one with fresh
// questions, and the ROOT attempt's pinned pass mark/rubric/answer rule ride
// the retest snapshot unchanged.

export const TEST_ITEM_POINTS = [1999, 1999, 1999, 1999, 2004] as const;
export const TEST_TOTAL_POINTS = TEST_ITEM_POINTS.reduce((sum, points) => sum + points, 0);

const objectiveSlot = "{objective}";

type BankItem = { prompt: string; choices: AssessmentChoice[]; answerId: string };

const bankItems: BankItem[] = [
  {
    prompt: `A scored practice test for the outcome "${objectiveSlot}" reports 79.96% against an 80% pass mark. Which statement is true?`,
    choices: [
      { id: "a", text: "79.96% rounds to 80.0%, so the attempt passes." },
      { id: "b", text: "The unrounded comparison decides: 79.96% is below the 80% mark, so the attempt does not pass." },
      { id: "c", text: "Any score within one percentage point of the mark counts as a pass." },
      { id: "d", text: "The display should be changed to 80.0% so the result looks consistent." },
    ],
    answerId: "b",
  },
  {
    prompt: `While working toward "${objectiveSlot}", a newer version of the mini-course is published after your test attempt started. Which behavior is correct for the started attempt?`,
    choices: [
      { id: "a", text: "The attempt silently switches to the new version's questions mid-attempt." },
      { id: "b", text: "The attempt is graded against the question set snapshotted when it started; newer versions apply only to new attempts." },
      { id: "c", text: "The attempt is deleted so it can be retaken on the new version." },
      { id: "d", text: "The pass mark is recalculated from the new version before grading." },
    ],
    answerId: "b",
  },
  {
    prompt: `Which practice keeps the evidence for "${objectiveSlot}" honest while you take a required test?`,
    choices: [
      { id: "a", text: "Previewing the correct answers before submitting, to check your work." },
      { id: "b", text: "Withholding the correct answers until the attempt is submitted, then revealing them with the result." },
      { id: "c", text: "Marking the test passed after reading the lesson once, without submitting an attempt." },
      { id: "d", text: "Letting an AI assistant answer, then reporting the attempt as unaided." },
    ],
    answerId: "b",
  },
  {
    prompt: `You fail a required test once and later pass a fresh attempt on the same material for "${objectiveSlot}". What should the record show?`,
    choices: [
      { id: "a", text: "Only the passing attempt; the failed one is overwritten." },
      { id: "b", text: "A single merged average score for the two attempts." },
      { id: "c", text: "Both attempts listed separately; the earlier failure is never overwritten or hidden." },
      { id: "d", text: "The failed attempt is regraded against the later answers." },
    ],
    answerId: "c",
  },
  {
    prompt: `For the outcome "${objectiveSlot}", when does a mini-course node honestly read Completed?`,
    choices: [
      { id: "a", text: "When the page has been open long enough, regardless of answers." },
      { id: "b", text: "When the required items are explicitly done and the required test has passed at its threshold." },
      { id: "c", text: "When a celebratory animation has played at the end of the last lesson." },
      { id: "d", text: "When an AI assistant certifies understanding without a submitted attempt." },
    ],
    answerId: "b",
  },
];

export const ANSWER_RULE =
  "Single choice per item: exactly one declared correct answer earns the item's full points; any other choice or an unanswered item earns zero. No negative marking.";
export const RUBRIC =
  "Full credit only — an item's points are awarded whole when the chosen answer matches the declared correct answer, otherwise zero. No partial credit.";

// The FRESH retest pool (story 2's D7 fixture): exactly one fresh item per
// root bank position, manually checked like the root items (the per-item
// verification list is recorded in the story plan's Implementation Notes).
// Every question is NEW — a retest never reuses the root questions — and
// targets the targeted-recovery policy itself, so the correct choice is
// trivially true against D3/AD-8 and each wrong choice self-evidently false.
const retestItems: BankItem[] = [
  {
    prompt: `After a failed required test covering "${objectiveSlot}", which sections does a targeted retest cover?`,
    choices: [
      { id: "a", text: "The whole test again, including the sections that already passed." },
      { id: "b", text: "Only the objective groups that failed — passing groups are preserved and never re-tested." },
      { id: "c", text: "Every section, plus one extra section that was never taught." },
      { id: "d", text: "No sections — the failing score is rounded up to a pass instead." },
    ],
    answerId: "b",
  },
  {
    prompt: `In a targeted retest for "${objectiveSlot}", when does a failed objective group count as cleared?`,
    choices: [
      { id: "a", text: "When the average of the original and retest scores reaches the pass mark." },
      { id: "b", text: "When the retest's fresh items for that group independently reach the original attempt's pass mark." },
      { id: "c", text: "When you spend at least ten minutes reviewing that group." },
      { id: "d", text: "When the retest includes at least one correct answer for that group." },
    ],
    answerId: "b",
  },
  {
    prompt: `After clearing every failed objective group for "${objectiveSlot}", what happens to the original failing score?`,
    choices: [
      { id: "a", text: "It is rewritten to the retest percentage." },
      { id: "b", text: "It is replaced with the word Recovered." },
      { id: "c", text: "It stays unchanged in the record; the recovery credit is shown separately beside it." },
      { id: "d", text: "It is averaged with the retest result into one new score." },
    ],
    answerId: "c",
  },
  {
    prompt: `For the outcome "${objectiveSlot}", when is the failed-test requirement satisfied through targeted recovery?`,
    choices: [
      { id: "a", text: "When every failed objective group of that attempt has independently cleared — no untested group is inferred passed." },
      { id: "b", text: "When the learner promises to study the remaining groups later." },
      { id: "c", text: "When at least half of the failed groups have cleared." },
      { id: "d", text: "When an AI assistant judges the remaining groups mastered." },
    ],
    answerId: "a",
  },
  {
    prompt: `A targeted retest for "${objectiveSlot}" uses fresh questions. What must stay comparable to the original attempt?`,
    choices: [
      { id: "a", text: "Only the original pass mark — coverage and demand may change freely." },
      { id: "b", text: "The literal original questions, reused word for word." },
      { id: "c", text: "A lower pass mark, because retests are meant to be easier." },
      { id: "d", text: "The same intended demand and comparable points coverage per objective group, with the original pass mark and rubric." },
    ],
    answerId: "d",
  },
];

// Build the at-start snapshot for one course's objective set. Deterministic
// and pure: the same objectives always produce the byte-identical snapshot,
// which is what makes the offered view and the pinned attempt agree.
export function buildSnapshot(objectives: Array<{ index: number; text: string }>): AttemptSnapshot {
  if (!objectives.length) fail("INVALID_INPUT");
  if (bankItems.length !== TEST_ITEM_POINTS.length) fail("RETRYABLE_FAILURE");
  const items = bankItems.map((item, position) => {
    const linked = objectives[position % objectives.length];
    if (!linked) fail("INVALID_INPUT");
    return {
      position: position + 1,
      objectiveIndex: linked.index,
      objective: linked.text,
      prompt: item.prompt.split(objectiveSlot).join(linked.text),
      choices: item.choices,
      answerId: item.answerId,
      points: TEST_ITEM_POINTS[position],
    };
  });
  return attemptSnapshotSchema.parse({
    schemaVersion: 1,
    testId: REQUIRED_TEST_ID,
    title: "Required test — honest assessment fundamentals",
    source: "manual-synthetic",
    passMarkPercent: DEFAULT_PASS_MARK_PERCENT,
    answerRule: ANSWER_RULE,
    rubric: RUBRIC,
    totalPoints: TEST_TOTAL_POINTS,
    items,
  });
}

// Build one targeted retest's snapshot from the ROOT attempt's own pinned
// snapshot and the declared non-empty subset of target objective indexes.
// Pure and deterministic. Structural comparability (D3/AD-8): every root
// item whose objectiveIndex is targeted is MIRRORED one-for-one — same
// objective slot, same per-item points — by a FRESH manually checked
// question from the pool position matching the root item's own bank
// position; positions renumber 1..n within the retest; the ROOT attempt's
// pinned pass mark, answer rule and rubric ride unchanged (root policy is
// fixed through the recovery chain). Anything malformed — duplicates, an
// index no root item carries, an empty selection, a pool mismatch — is
// INVALID_INPUT, never repaired.
export function buildRetestSnapshot(rootSnapshot: AttemptSnapshot, targetIndexes: number[]): RetestSnapshot {
  if (new Set(targetIndexes).size !== targetIndexes.length) fail("INVALID_INPUT");
  if (retestItems.length !== TEST_ITEM_POINTS.length) fail("RETRYABLE_FAILURE");
  const selected = rootSnapshot.items.filter(item => targetIndexes.includes(item.objectiveIndex));
  // Every declared target must be carried by at least one mirrored root item.
  const covered = new Set(selected.map(item => item.objectiveIndex));
  if (targetIndexes.some(index => !covered.has(index)) || !selected.length) fail("INVALID_INPUT");
  const items = selected.map((rootItem, index) => {
    const fresh = retestItems[rootItem.position - 1];
    if (!fresh || TEST_ITEM_POINTS[rootItem.position - 1] !== rootItem.points) fail("INVALID_INPUT");
    return {
      position: index + 1,
      objectiveIndex: rootItem.objectiveIndex,
      objective: rootItem.objective,
      prompt: fresh.prompt.split(objectiveSlot).join(rootItem.objective),
      choices: fresh.choices,
      answerId: fresh.answerId,
      points: rootItem.points,
    };
  });
  return retestSnapshotSchema.parse({
    schemaVersion: 1,
    testId: RETEST_TEST_ID,
    title: `Targeted retest — ${rootSnapshot.title}`,
    source: "manual-synthetic",
    passMarkPercent: rootSnapshot.passMarkPercent,
    answerRule: rootSnapshot.answerRule,
    rubric: rootSnapshot.rubric,
    totalPoints: items.reduce((sum, item) => sum + item.points, 0),
    items,
  });
}
