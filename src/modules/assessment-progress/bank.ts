import {
  REQUIRED_TEST_ID,
  attemptSnapshotSchema,
  DEFAULT_PASS_MARK_PERCENT,
  type AssessmentChoice,
  type AttemptSnapshot,
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
