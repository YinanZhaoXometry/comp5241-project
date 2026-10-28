import { z } from "zod";
import { commandSchema, uuid } from "./setup";

// Epic-3 story-1 (plan-to-roadmap scored-attempt tracer) contracts. One
// REQUIRED objective-linked test per ready course: snapshotted at start
// (blueprint, questions, answer key, answer rules, rubric, point scale and
// the 80% default mark), submitted exactly once, scored deterministically by
// unrounded scaled-integer cross-product, and driving a DERIVED roadmap node
// (In progress -> Completed). This is the layer tracer, not full D3/AD-8
// acceptance: there are deliberately no recovery, partial credit, gap
// guidance, award, review-due or instructor-override fields anywhere.
//
// Answer withholding (D3/AD-8): the correct answer of every item lives ONLY
// in the stored snapshot (server-side) and in the graded view of the attempt
// that submitted it. No GET payload before that attempt is graded carries an
// answerId or correctChoiceId field.

export const REQUIRED_TEST_ID = "required-test-1";
// The user-selected default pass mark (D3): snapshotted per attempt so later
// policy changes could only affect new attempts, never a started one.
export const DEFAULT_PASS_MARK_PERCENT = 80;

export const attemptStatuses = ["active", "graded"] as const;
export type AttemptStatus = (typeof attemptStatuses)[number];
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

export const attemptSnapshotSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    testId: z.literal(REQUIRED_TEST_ID),
    title: z.string().trim().min(1).max(160),
    source: z.literal("manual-synthetic"),
    passMarkPercent: z.number().int().min(1).max(100),
    answerRule: z.string().trim().min(1).max(600),
    rubric: z.string().trim().min(1).max(600),
    totalPoints: z.number().int().min(1).max(1000000),
    items: z.array(snapshotItemSchema).min(1).max(5),
  })
  .refine(snapshot => snapshot.items.every((item, index) => item.position === index + 1), {
    message: "Items must be numbered sequentially from 1.",
  })
  .refine(snapshot => snapshot.items.reduce((sum, item) => sum + item.points, 0) === snapshot.totalPoints, {
    message: "Per-item points must sum to the declared total.",
  });
export type AttemptSnapshot = z.infer<typeof attemptSnapshotSchema>;

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

// Served views — none of these types has an answer field for an ungraded
// attempt; the graded view is the sole reveal path.
export type AssessmentItemView = {
  position: number;
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

// Owner-scoped assessment state. `none` is the honest empty state (no
// studyable course yet — unconfirmed or not generated; prior attempts, if a
// regeneration is in flight, stay listed on their pinned versions);
// `offered` shows the threshold, available points and scoring criteria
// BEFORE any start; `active` is the open attempt; `graded` is the latest
// attempt's result with the full history. The roadmap node is DERIVED from
// epic-2 tracker state read through getCourse plus this module's attempts:
// completed requires every required item done AND a passed attempt on the
// current course version — no award rows exist.
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
};

// Command results. The submit receipt recorded in command_receipt is
// CONTENT-FREE (no answers, no attempt text, no score): a replay rebuilds the
// identical graded view deterministically from the stored snapshot row.
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
