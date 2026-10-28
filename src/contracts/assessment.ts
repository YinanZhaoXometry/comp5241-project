import { z } from "zod";
import { commandSchema, uuid } from "./setup";

// Epic-3 story-1 (plan-to-roadmap scored-attempt tracer) contracts. One
// REQUIRED objective-linked test per ready course: snapshotted at start
// (blueprint, questions, answer key, answer rules, rubric, point scale and
// the 80% default mark), submitted exactly once, scored deterministically by
// unrounded scaled-integer cross-product, and driving a DERIVED roadmap node
// (In progress -> Completed). The tracer slice deliberately carries no
// partial credit, gap guidance, award, review-due or instructor-override
// fields anywhere. Story 2 (3.2) ADDS the targeted-recovery surface below —
// the failed-grade ledger and the fresh same-demand retest chain — with
// AD-8's fence: only an originally FAILED ordinary attempt opens recovery,
// passed groups are preserved and never re-tested, and the original score is
// never rewritten (recovery credit is shown separately, never merged).
//
// Answer withholding (D3/AD-8): the correct answer of every item lives ONLY
// in the stored snapshot (server-side) and in the graded view of the attempt
// or retest that submitted it. No GET payload before that attempt/retest is
// graded carries an answerId or correctChoiceId field.

export const REQUIRED_TEST_ID = "required-test-1";
// Story 2: the fresh same-demand retest of the required test's failed
// objective groups. A separate testId keeps retest snapshots distinguishable
// from ordinary attempt snapshots while reusing the same item shape.
export const RETEST_TEST_ID = "targeted-retest-1";
// The user-selected default pass mark (D3): snapshotted per attempt so later
// policy changes could only affect new attempts, never a started one.
export const DEFAULT_PASS_MARK_PERCENT = 80;

export const attemptStatuses = ["active", "graded"] as const;
export type AttemptStatus = (typeof attemptStatuses)[number];
export const retestStatuses = ["active", "graded"] as const;
export type RetestStatus = (typeof retestStatuses)[number];
export const recoveryTargetStatuses = ["open", "cleared"] as const;
export type RecoveryTargetStatus = (typeof recoveryTargetStatuses)[number];
export const roadmapNodes = ["not-started", "in-progress", "completed"] as const;
export type RoadmapNode = (typeof roadmapNodes)[number];

export const assessmentChoiceSchema = z.strictObject({
  id: z.string().trim().min(1).max(8),
  text: z.string().trim().min(1).max(400),
});
export type AssessmentChoice = z.infer<typeof assessmentChoiceSchema>;

// The stored at-start SNAPSHOT (server-side shape, answer key included). The
// served views below are built from it MINUS the answerId of every item until
// that attempt is graded.
export const snapshotItemSchema = z
  .strictObject({
    position: z.number().int().min(1).max(5),
    // The course objective this item assesses (its own index field), linked
    // positionally at start.
    objectiveIndex: z.number().int().min(0).max(7),
    objective: z.string().trim().min(1).max(300),
    prompt: z.string().trim().min(1).max(1200),
    choices: z.array(assessmentChoiceSchema).min(2).max(4),
    // Answer key — never part of any pre-grade view.
    answerId: z.string().trim().min(1).max(8),
    points: z.number().int().min(1).max(100000),
  })
  .refine(item => item.choices.some(choice => choice.id === item.answerId), {
    message: "The declared answer must match a declared choice.",
  })
  .refine(item => new Set(item.choices.map(choice => choice.id)).size === item.choices.length, {
    message: "Choice ids must be unique.",
  });
export type SnapshotItem = z.infer<typeof snapshotItemSchema>;

// The shared snapshot core: positions, points, pinning refines and the
// declared total all behave identically for ordinary attempts and retests.
const snapshotCoreSchema = z.strictObject({
  schemaVersion: z.literal(1),
  testId: z.string().trim().min(1).max(64),
  title: z.string().trim().min(1).max(160),
  source: z.literal("manual-synthetic"),
  passMarkPercent: z.number().int().min(1).max(100),
  answerRule: z.string().trim().min(1).max(600),
  rubric: z.string().trim().min(1).max(600),
  totalPoints: z.number().int().min(1).max(1000000),
  items: z.array(snapshotItemSchema).min(1).max(5),
});
const sequentialPositions = (snapshot: { items: Array<{ position: number }> }, index: number) =>
  snapshot.items[index]?.position === index + 1;
const pointsSumToTotal = (snapshot: { totalPoints: number; items: Array<{ points: number }> }) =>
  snapshot.items.reduce((sum, item) => sum + item.points, 0) === snapshot.totalPoints;

export const attemptSnapshotSchema = snapshotCoreSchema
  .extend({ testId: z.literal(REQUIRED_TEST_ID) })
  .refine(snapshot => snapshot.items.every((_, index) => sequentialPositions(snapshot, index)), {
    message: "Items must be numbered sequentially from 1.",
  })
  .refine(pointsSumToTotal, {
    message: "Per-item points must sum to the declared total.",
  });
export type AttemptSnapshot = z.infer<typeof attemptSnapshotSchema>;

// Story 2: the at-start snapshot of one targeted retest. It reuses the same
// item shape (snapshotItemSchema), renumbers positions 1..n within the
// retest, and MIRRORS the root attempt's per-group item structure one-for-one
// (same objective slots, same per-item points, the ROOT attempt's pinned pass
// mark/answer rule/rubric — root policy fixed through the chain; a new policy
// means a new ordinary attempt). Comparability is structural, not asserted.
export const retestSnapshotSchema = snapshotCoreSchema
  .extend({ testId: z.literal(RETEST_TEST_ID) })
  .refine(snapshot => snapshot.items.every((_, index) => sequentialPositions(snapshot, index)), {
    message: "Items must be numbered sequentially from 1.",
  })
  .refine(pointsSumToTotal, {
    message: "Per-item points must sum to the declared total.",
  });
export type RetestSnapshot = z.infer<typeof retestSnapshotSchema>;

// Commands. Start resolves the latest ready course version server-side (no
// client-supplied course pin); submit carries the attempt id and the chosen
// answer for each answered item — an unanswered item simply earns zero under
// the full-credit rubric, and any answer that does not match a snapshot
// choice or position is INVALID_INPUT, never repaired.
export const startTestSchema = commandSchema;
export const attemptAnswerSchema = z.strictObject({
  position: z.number().int().min(1).max(5),
  choiceId: z.string().trim().min(1).max(8),
});
export const submitAttemptSchema = commandSchema.extend({
  attemptId: uuid,
  answers: z.array(attemptAnswerSchema).min(0).max(5),
});
export type AttemptAnswer = z.infer<typeof attemptAnswerSchema>;
export type StartTest = z.infer<typeof startTestSchema>;
export type SubmitAttempt = z.infer<typeof submitAttemptSchema>;

// Story 2 commands. A retest start names the graded-failed ROOT ordinary
// attempt and declares a NON-EMPTY subset of its open target groups (each
// index must be an open target of that root — a foreign index is
// INVALID_INPUT, never repaired); the snapshot is built server-side from the
// root attempt's own pinned snapshot. A retest submit carries the retest id
// and one chosen answer per answered retest item — same rules as the
// ordinary submit (unanswered earns zero; anything unmatched is
// INVALID_INPUT).
export const startRetestSchema = commandSchema.extend({
  attemptId: uuid,
  targetIndexes: z.array(z.number().int().min(0).max(7)).min(1).max(8),
});
export const submitRetestSchema = commandSchema.extend({
  retestId: uuid,
  answers: z.array(attemptAnswerSchema).min(0).max(5),
});
export type StartRetest = z.infer<typeof startRetestSchema>;
export type SubmitRetest = z.infer<typeof submitRetestSchema>;

// Served views — none of these types has an answer field for an ungraded
// attempt; the graded view is the sole reveal path.
export type AssessmentItemView = {
  position: number;
  // The stable objective-group key (the ledger, clearing and retest grouping
  // all key on it; the objective TEXT is display only and may repeat).
  objectiveIndex: number;
  objective: string;
  prompt: string;
  choices: AssessmentChoice[];
  points: number;
};
export type GradedItemView = AssessmentItemView & {
  chosenChoiceId: string | null;
  correctChoiceId: string;
  earned: number;
};
export type TestDescriptorView = {
  testId: string;
  title: string;
  source: "manual-synthetic";
  passMarkPercent: number;
  totalPoints: number;
  itemCount: number;
  itemPoints: number[];
  answerRule: string;
  rubric: string;
};
export type ActiveAttemptView = {
  attemptId: string;
  courseId: string;
  courseVersion: number;
  planRevisionId: string;
  startedAt: string;
  items: AssessmentItemView[];
};
export type GradedAttemptView = {
  attemptId: string;
  courseId: string;
  courseVersion: number;
  planRevisionId: string;
  startedAt: string;
  gradedAt: string;
  earnedPoints: number;
  totalPoints: number;
  passMarkPercent: number;
  passed: boolean;
  displayPercent: string;
  // The honest verdict line, e.g. `79.96% — Not passed (mark is 80%)`.
  verdict: string;
  items: GradedItemView[];
};
export type AttemptSummary = {
  attemptId: string;
  courseId: string;
  courseVersion: number;
  planRevisionId: string;
  status: AttemptStatus;
  startedAt: string;
  gradedAt: string | null;
  earnedPoints: number | null;
  totalPoints: number | null;
  passed: boolean | null;
  displayPercent: string | null;
};

// Story 2: targeted-recovery views. One ledger row per failed objective
// group of the root attempt, with the group's INITIAL result computed under
// that attempt's own snapshot; uncleared/untested targets are never inferred
// passed (AD-8).
export type RecoveryTargetView = {
  objectiveIndex: number;
  objective: string;
  initialEarned: number;
  initialTotal: number;
  initialDisplayPercent: string;
  status: RecoveryTargetStatus;
  clearedBy: string | null;
  clearedAt: string | null;
};
// A retest's per-objective-group outcome. `cleared` is the independent
// cross-product verdict of THAT group at the root attempt's snapshotted pass
// mark — the only way a target clears.
export type RetestGroupResult = {
  objectiveIndex: number;
  objective: string;
  earned: number;
  total: number;
  cleared: boolean;
  displayPercent: string;
};
export type ActiveRetestView = {
  retestId: string;
  rootAttemptId: string;
  courseId: string;
  courseVersion: number;
  planRevisionId: string;
  targetIndexes: number[];
  startedAt: string;
  items: AssessmentItemView[];
};
export type GradedRetestView = {
  retestId: string;
  rootAttemptId: string;
  courseId: string;
  courseVersion: number;
  planRevisionId: string;
  targetIndexes: number[];
  startedAt: string;
  gradedAt: string;
  groups: RetestGroupResult[];
  items: GradedItemView[];
};
export type RetestSummary = {
  retestId: string;
  rootAttemptId: string;
  courseVersion: number;
  targetIndexes: number[];
  status: RetestStatus;
  startedAt: string;
  gradedAt: string | null;
  groups: RetestGroupResult[] | null;
};
// The recovery chain of one root attempt (the newest graded-failed ordinary
// attempt that has a ledger — recovery opens only at grade time): its target
// ledger, its retests and whether the failed-test requirement is satisfied.
// `requirementSatisfied` is true ONLY when every target reads cleared; a
// missing/untested target can never satisfy it.
export type RecoveryState = {
  rootAttemptId: string;
  targets: RecoveryTargetView[];
  retest: ActiveRetestView | GradedRetestView | null;
  retests: RetestSummary[];
  requirementSatisfied: boolean;
};

// Owner-scoped assessment state. `none` is the honest empty state (no
// studyable course yet — unconfirmed or not generated; prior attempts, if a
// regeneration is in flight, stay listed on their pinned versions);
// `offered` shows the threshold, available points and scoring criteria
// BEFORE any start; `active` is the open attempt; `graded` is the latest
// attempt's result with the full history. The roadmap node is DERIVED from
// epic-2 tracker state read through getCourse plus this module's attempts:
// completed requires every required item done AND a passed OR fully-recovered
// failed attempt on the current course version — no award rows exist.
// `recovery` is the targeted-recovery chain of the newest graded-failed
// attempt that has a ledger (null before any failed grade) — served NEXT TO
// the attempt result, never merged into it.
export type AssessmentState = {
  state: "none" | "offered" | "active" | "graded";
  rootId: string;
  revision: number;
  courseId: string | null;
  version: number | null;
  planRevisionId: string | null;
  test: TestDescriptorView | null;
  attempt: ActiveAttemptView | GradedAttemptView | null;
  attempts: AttemptSummary[];
  node: RoadmapNode;
  recovery: RecoveryState | null;
};

// Command results. The submit receipt recorded in command_receipt is
// CONTENT-FREE (no answers, no attempt text, no score): a replay rebuilds the
// identical graded view deterministically from the stored snapshot row. The
// retest receipts follow the same rule, and — like the ordinary start — the
// returned retest's OWN pin (the root attempt's plan revision) rides the
// result in every branch.
export type StartedAttempt = {
  rootId: string;
  operationId: string;
  planRevisionId: string;
  revision: number;
  state: "active";
};
export type SubmittedAttempt = GradedAttemptView & {
  rootId: string;
  revision: number;
  state: "graded";
};
export type StartedRetest = {
  rootId: string;
  operationId: string;
  planRevisionId: string;
  targetIndexes: number[];
  revision: number;
  state: "active";
};
export type SubmittedRetest = GradedRetestView & {
  rootId: string;
  revision: number;
  state: "graded";
};
