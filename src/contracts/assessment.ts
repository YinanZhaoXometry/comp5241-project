import { z } from "zod";
import { commandSchema, uuid } from "./setup";

// Epic-3 story-1 (plan-to-roadmap scored-attempt tracer) contracts. One
// REQUIRED objective-linked test per ready course: snapshotted at start
// (blueprint, questions, answer key, answer rules, rubric, point scale and
// the 80% default mark), submitted exactly once, scored deterministically by
// unrounded scaled-integer cross-product, and driving a DERIVED roadmap node
// (In progress -> Completed). Story 2 (3.2) ADDS the targeted-recovery surface
// below — the failed-grade ledger and the fresh same-demand retest chain —
// with AD-8's fence: only an originally FAILED ordinary attempt opens
// recovery, passed groups are preserved and never re-tested, and the original
// score is never rewritten (recovery credit is shown separately, never
// merged). Story 3 (3.3) completes the D3/AD-8 scoring surface: per-item
// OPTIONAL disclosed partial-credit rubrics with DECLARED FINITE PRECISION
// (a per-snapshot integer pointsScale — every earned amount stays a scaled
// integer, no float ever decides), and the instructor pass-mark override
// carried as an attempt-snapshotted { source, provenance, value } CONTRACT
// (personal study always carries source "default" at the 80% default — no
// instructor route or UI exists here; epic 5 supplies the writer). The
// provisional-grade state is typed beside the statuses as a contract ONLY:
// it structurally carries no pass decision, so nothing downstream can read a
// pass off it and it can never award completion (see GradeDecision).
//
// Answer withholding (D3/AD-8): the correct answer of every item lives ONLY
// in the stored snapshot (server-side) and in the graded view of the attempt
// or retest that submitted it. No GET payload before that attempt/retest is
// graded carries an answerId or correctChoiceId field. A partial-credit
// rubric's credits map is disclosure, not a key: it names no answerId (the
// correct answer is structurally absent from it), and an absent choice is
// indistinguishable from a zero-credit choice.
//
// Story 4 (3.4) adds the MONOTONIC COMPLETION-AWARD layer (AD-5/AD-8/D1):
// required content items done + every required test ordinarily passed (final
// grade through the provisional fence) or fully recovered awards a UNIQUE
// version-scoped mini-course completion — inserted once per (owner, course
// release), never updated, revoked or re-derived; the roadmap node now
// derives FROM award rows (a passed/recovered attempt with no award yet
// still reads honestly In progress). A parent manifest pins required and
// optional child RELEASES; a parent award exists only when every required
// child release is awarded (optional children never block). Version
// switching is an explicit informed command that discloses changed required
// work BEFORE moving the studied release and never erases prior awards.

export const REQUIRED_TEST_ID = "required-test-1";
// Story 2: the fresh same-demand retest of the required test's failed
// objective groups. A separate testId keeps retest snapshots distinguishable
// from ordinary attempt snapshots while reusing the same item shape.
export const RETEST_TEST_ID = "targeted-retest-1";
// Story 3: the manually checked partial-credit FIXTURE test (D7). It is a
// distinct testId so a rubric-carrying snapshot can never masquerade as the
// ordinary required test; the served personal-study path always builds the
// full-credit root test.
export const PARTIAL_CREDIT_TEST_ID = "required-test-partial-credit";
// The user-selected default pass mark (D3): snapshotted per attempt so later
// policy changes could only affect new attempts, never a started one.
export const DEFAULT_PASS_MARK_PERCENT = 80;
// The carried default override contract every personal-study snapshot rides.
export const DEFAULT_PASS_MARK_OVERRIDE = { source: "default", value: DEFAULT_PASS_MARK_PERCENT } as const;

export const attemptStatuses = ["active", "graded"] as const;
export type AttemptStatus = (typeof attemptStatuses)[number];
export const retestStatuses = ["active", "graded"] as const;
export type RetestStatus = (typeof retestStatuses)[number];
export const recoveryTargetStatuses = ["open", "cleared"] as const;
export type RecoveryTargetStatus = (typeof recoveryTargetStatuses)[number];
export const roadmapNodes = ["not-started", "in-progress", "completed"] as const;
export type RoadmapNode = (typeof roadmapNodes)[number];

// Story 3 — the PROVISIONAL-GRADE CONTRACT, typed BESIDE the attempt
// statuses (never inside them: a test_attempt row is a deterministic
// objective grade and always final). D3/AD-8: an instructor-course
// subjective grade stays Provisional until the instructor confirms it and
// cannot award completion while pending. The fence is structural: a pass
// decision (`passed`) exists ONLY on the final variant — the provisional
// variant has no such field at all, so no consumer can read a pass off it
// and the completion derivations (scoring.ts gradeAwardsCompletion /
// deriveRoadmapNode / recoverySatisfied) ignore it by construction. No
// writer produces it in personal study; this is the typed contract epic 5
// confirms.
export const gradeKinds = ["final", "provisional"] as const;
export type GradeKind = (typeof gradeKinds)[number];
export type FinalGrade = { gradeKind: "final"; passed: boolean };
export type ProvisionalGrade = { gradeKind: "provisional"; pendingSince: string };
export type GradeDecision = FinalGrade | ProvisionalGrade;

// The instructor pass-mark override, carried ON THE SNAPSHOT at start like
// every policy (source / provenance / value — the provenance.ts precedent:
// strict shape, forbidden fields structurally absent). "default" is the
// personal-study contract (value === the 80% default); "instructor" is the
// epic-5 contract — an instructor-set mark with its recording time as
// provenance. There is deliberately NO writer for the instructor variant in
// this build; the schema exists so the carried contract is exact when epic 5
// lands one. The snapshot's passMarkPercent IS the applicable mark; the
// refine on each snapshot schema pins override.value === passMarkPercent, so
// the verdict can never disagree with the contract it discloses.
export const passMarkOverrideSchema = z.discriminatedUnion("source", [
  z.strictObject({ source: z.literal("default"), value: z.number().int().min(1).max(100) }),
  z.strictObject({ source: z.literal("instructor"), value: z.number().int().min(1).max(100), recordedAt: z.iso.datetime() }),
]);
export type PassMarkOverride = z.infer<typeof passMarkOverrideSchema>;

// One item's DISCLOSED partial-credit rubric (D3: partial credit is allowed
// only where a disclosed rubric defines it; no negative marking). The
// disclosure is the pre-start text the learner sees; credits maps a choice id
// to the exact earned points — a nonnegative scaled INTEGER in the
// snapshot's declared pointsScale (a float credit is rejected by the schema:
// non-precision-conforming rubrics are never repaired). The declared correct
// answer is structurally ABSENT from the map: it earns the item's full points
// under the answer rule (the full-credit default), and a map that tries to
// declare a diminished "correct" credit is rejected.
export const itemPartialCreditSchema = z.strictObject({
  disclosure: z.string().trim().min(1).max(600),
  credits: z.record(z.string().trim().min(1).max(8), z.number().int().min(0).max(10000000)),
});
export type ItemPartialCredit = z.infer<typeof itemPartialCreditSchema>;

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
    // Raw scaled-integer points in the SNAPSHOT's declared pointsScale
    // (scale 1 = whole points, scale 100 = hundredths of a point). The
    // raised bound keeps the cross-products overflow-safe at the largest
    // allowed scale (5 items x 10000000 total 50000000: earned x 100 and
    // mark x total both stay far inside Number.MAX_SAFE_INTEGER).
    points: z.number().int().min(1).max(10000000),
    // OPTIONAL disclosed partial-credit rubric — absent means full credit
    // only (the whole-points 3.1/3.2 behavior, byte-identical).
    partialCredit: itemPartialCreditSchema.optional(),
  })
  .refine(item => item.choices.some(choice => choice.id === item.answerId), {
    message: "The declared answer must match a declared choice.",
  })
  .refine(item => new Set(item.choices.map(choice => choice.id)).size === item.choices.length, {
    message: "Choice ids must be unique.",
  })
  .refine(item => item.partialCredit === undefined || Object.keys(item.partialCredit.credits).every(key => item.choices.some(choice => choice.id === key)), {
    message: "A declared credit must name a declared choice.",
  })
  .refine(item => item.partialCredit === undefined || !(item.answerId in item.partialCredit.credits), {
    message: "The declared correct answer earns full points under the answer rule; its credit is never a declared diminished value.",
  })
  .refine(item => item.partialCredit === undefined || Object.values(item.partialCredit.credits).every(credit => credit <= item.points), {
    message: "A declared partial credit can never exceed the item's full points.",
  })
  .refine(item => {
    if (item.partialCredit === undefined) return true;
    // Withholding: a rubric that declares a credit for EVERY non-correct
    // choice would disclose the answer by elimination in the pre-grade
    // descriptor (absent ≡ zero-credit must stay indistinguishable).
    const nonCorrect = item.choices.filter(choice => choice.id !== item.answerId);
    return nonCorrect.some(choice => !(choice.id in item.partialCredit!.credits));
  }, {
    message: "A disclosed rubric can never declare a credit for every non-correct choice.",
  });
export type SnapshotItem = z.infer<typeof snapshotItemSchema>;

// The shared snapshot core: positions, points, pinning refines and the
// declared total all behave identically for ordinary attempts and retests.
// Story 3 adds the DECLARED FINITE PRECISION (pointsScale: 1 = whole points,
// 100 = hundredths; anything else is non-precision-conforming and rejected)
// and the carried pass-mark override contract. Both default so pre-3.3
// stored snapshots (scale 1, no carried contract) still parse and stay
// gradeable under their own declared scale — stored immutable rows never
// change shape.
const snapshotCoreSchema = z.strictObject({
  schemaVersion: z.literal(1),
  testId: z.string().trim().min(1).max(64),
  title: z.string().trim().min(1).max(160),
  source: z.literal("manual-synthetic"),
  passMarkPercent: z.number().int().min(1).max(100),
  pointsScale: z.union([z.literal(1), z.literal(100)]).default(1),
  passMarkOverride: passMarkOverrideSchema.default(DEFAULT_PASS_MARK_OVERRIDE),
  answerRule: z.string().trim().min(1).max(600),
  rubric: z.string().trim().min(1).max(600),
  totalPoints: z.number().int().min(1).max(50000000),
  items: z.array(snapshotItemSchema).min(1).max(5),
});
const sequentialPositions = (snapshot: { items: Array<{ position: number }> }, index: number) =>
  snapshot.items[index]?.position === index + 1;
const pointsSumToTotal = (snapshot: { totalPoints: number; items: Array<{ points: number }> }) =>
  snapshot.items.reduce((sum, item) => sum + item.points, 0) === snapshot.totalPoints;
const overrideAgrees = (snapshot: { passMarkPercent: number; passMarkOverride: PassMarkOverride }) =>
  snapshot.passMarkOverride.value === snapshot.passMarkPercent;
// The served full-credit-only invariant, enforced at the schema level: the
// required test and its retests never carry a per-item rubric — the
// partial-credit fixture schema is the only rubric carrier.
const noRubrics = (snapshot: { items: Array<{ partialCredit?: ItemPartialCredit }> }) =>
  snapshot.items.every(item => item.partialCredit === undefined);

export const attemptSnapshotSchema = snapshotCoreSchema
  .extend({ testId: z.literal(REQUIRED_TEST_ID) })
  .refine(snapshot => snapshot.items.every((_, index) => sequentialPositions(snapshot, index)), {
    message: "Items must be numbered sequentially from 1.",
  })
  .refine(pointsSumToTotal, {
    message: "Per-item points must sum to the declared total.",
  })
  .refine(overrideAgrees, {
    message: "The carried pass-mark override must equal the snapshot's applicable mark.",
  })
  .refine(noRubrics, {
    message: "The required test is full credit only; only the partial-credit fixture schema carries rubrics.",
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
  })
  .refine(overrideAgrees, {
    message: "The carried pass-mark override must equal the snapshot's applicable mark.",
  })
  .refine(noRubrics, {
    message: "A targeted retest is full credit only; only the partial-credit fixture schema carries rubrics.",
  });
export type RetestSnapshot = z.infer<typeof retestSnapshotSchema>;

// Story 3 — the partial-credit FIXTURE snapshot (D7, manually checked in
// bank.ts): the same shared core under its own testId, with at least one
// item carrying a disclosed partial-credit rubric and the snapshot's points
// scale declared at hundredths so fractional credits are exact scaled
// integers. It rides an ordinary attempt row exactly like an AttemptSnapshot
// (same items/answers/grading shape); only the testId contract differs.
export const partialCreditSnapshotSchema = snapshotCoreSchema
  .extend({ testId: z.literal(PARTIAL_CREDIT_TEST_ID) })
  .refine(snapshot => snapshot.items.every((_, index) => sequentialPositions(snapshot, index)), {
    message: "Items must be numbered sequentially from 1.",
  })
  .refine(pointsSumToTotal, {
    message: "Per-item points must sum to the declared total.",
  })
  .refine(overrideAgrees, {
    message: "The carried pass-mark override must equal the snapshot's applicable mark.",
  })
  .refine(snapshot => snapshot.items.some(item => item.partialCredit !== undefined), {
    message: "A partial-credit fixture snapshot must carry at least one disclosed rubric.",
  });
export type PartialCreditSnapshot = z.infer<typeof partialCreditSnapshotSchema>;
// Any snapshot an ordinary attempt row may carry (the served full-credit
// root build or the planted partial-credit fixture).
export type AnyAttemptSnapshot = AttemptSnapshot | PartialCreditSnapshot;

// Legacy tolerance for PRE-3.3 stored rows (written before pointsScale /
// passMarkOverride existed): they are whole-point snapshots under the
// default-mark contract by construction. Every read-side builder normalizes
// through these so a stored immutable row never needs rewriting.
export type LegacySnapshotCore = {
  passMarkPercent: number;
  pointsScale?: number;
  passMarkOverride?: PassMarkOverride;
};
export function pointsScaleOf(snapshot: LegacySnapshotCore): 1 | 100 {
  return snapshot.pointsScale === 100 ? 100 : 1;
}
export function passMarkOverrideOf(snapshot: LegacySnapshotCore): PassMarkOverride {
  return snapshot.passMarkOverride ?? { source: "default", value: snapshot.passMarkPercent };
}

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
  // Story 3: the declared finite precision and the carried override contract
  // ride the disclosure, plus the per-item disclosed partial-credit rubrics
  // (null on every full-credit item — the whole 3.1/3.2 surface unchanged).
  pointsScale: 1 | 100;
  passMarkOverride: PassMarkOverride;
  totalPoints: number;
  itemCount: number;
  itemPoints: number[];
  items: Array<{ position: number; points: number; partialCredit: ItemPartialCredit | null }>;
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
  // Story 3: the grade kind (a deterministic objective attempt is always
  // "final" here; a provisional-typed grade would serve labeled Provisional
  // and award nothing), the declared point scale and the carried override
  // provenance ride the graded view.
  gradeKind: GradeKind;
  pointsScale: 1 | 100;
  passMarkOverride: PassMarkOverride;
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
  pointsScale: 1 | 100;
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
  // Story 3: the root attempt's declared point scale rides the ledger view
  // so scaled-integer amounts render for humans without changing value.
  pointsScale: 1 | 100;
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
  pointsScale: 1 | 100;
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
  // The RETEST's own declared point scale (its snapshot's — the root
  // attempt's, mirrored): retest amounts render from this, never from the
  // latest attempt descriptor's scale.
  pointsScale: 1 | 100;
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
  pointsScale: 1 | 100;
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

// ---------------------------------------------------------------------------
// Story 4 — completion awards, parent manifests and the version switch.
// ---------------------------------------------------------------------------

export const awardKinds = ["mini-course", "parent-path"] as const;
export type AwardKind = (typeof awardKinds)[number];

// A parent manifest pins its child RELEASES (AD-5): each child is a course
// release id with its required/optional standing. The manifest is planted
// through the assessment module's own writer — personal study has one
// mini-course per root, so multi-child shapes are synthetic fixtures (the
// 3.3 planted-fixture precedent), not new learner-facing structure. Child
// releases must be unique; a manifest with no required child has no
// completion condition and awards nothing.
export const parentManifestSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    children: z
      .array(z.strictObject({ courseId: uuid, required: z.boolean() }))
      .min(1)
      .max(16),
  })
  .refine(manifest => new Set(manifest.children.map(child => child.courseId)).size === manifest.children.length, {
    message: "A parent manifest pins each child release at most once.",
  });
export type ParentManifest = z.infer<typeof parentManifestSchema>;
export type ParentManifestChild = ParentManifest["children"][number];

// The served award view — version-scoped and monotonic: an award pins the
// course release it was earned on (mini-course rows) or the parent manifest
// it satisfied (parent-path rows), records WHEN completion was earned, and is
// listed forever once it exists. Earned awards on prior versions stay
// readable and listed; nothing overwrites them.
export type CompletionAwardView = {
  awardId: string;
  kind: AwardKind;
  // Mini-course rows: the awarded course release pin. Parent rows: null.
  courseId: string | null;
  courseVersion: number | null;
  planRevisionId: string | null;
  // Parent rows: the pinned child manifest. Mini-course rows: null.
  manifest: ParentManifest | null;
  awardedAt: string;
};

// Explicit version switch (D1: learners remain on their studied version
// until explicitly choosing another). The command names the target course
// release and carries the learner's ACKNOWLEDGMENT of the exact disclosed
// change set — added/removed required item ids and whether the required
// test's objectives changed — which the verb re-computes server-side and
// must match exactly, so a switch can never confirm a disclosure it did not
// see. A mismatch is CONFLICT (stale/unconfirmed), never repaired.
export const switchCourseVersionSchema = commandSchema.extend({
  courseId: uuid,
  acknowledged: z.strictObject({
    addedRequiredItemIds: z.array(z.string().trim().min(3).max(40)).max(64),
    removedRequiredItemIds: z.array(z.string().trim().min(3).max(40)).max(64),
    requiredTestChanged: z.boolean(),
  }),
});
export type SwitchCourseVersion = z.infer<typeof switchCourseVersionSchema>;

// The served disclosure shown BEFORE any switch: the changed required work
// between the currently studied release and the target release.
export type SwitchDisclosure = {
  rootId: string;
  revision: number;
  from: { courseId: string | null; version: number | null; requiredItemCount: number };
  to: { courseId: string; version: number; requiredItemCount: number };
  addedRequiredItems: Array<{ id: string; title: string }>;
  removedRequiredItems: Array<{ id: string; title: string }>;
  requiredTestChanged: boolean;
};

// The switch receipt: content-free (no course content, no award data).
export type SwitchedCourseVersion = {
  rootId: string;
  operationId: string;
  revision: number;
  state: "switched";
  courseId: string;
  version: number;
};

// ---------------------------------------------------------------------------
// Story 5 — evidence-linked gap guidance and the unclear-item flag.
// ---------------------------------------------------------------------------

// The two honest guidance statuses (D2): Needs practice is OBSERVED difficulty
// from graded evidence — its cause is deliberately unnamed; Unknown is an
// UNASSESSED objective — not weakness. Practice evidence never flips Unknown:
// practice rows deliberately carry no score (AD-7), so classification is a
// scored-evidence-only dimension while practice renders as its own labeled
// lane.
export const guidanceStatuses = ["needs-practice", "unknown"] as const;
export type GuidanceStatus = (typeof guidanceStatuses)[number];

// A lean scored citation: WHICH graded container's item (by position) the
// recommendation draws on and what it earned there. Full item detail (prompt,
// chosen vs correct) stays on the graded view — the surface links to it,
// never duplicates it (Flow 2: guidance links each recommendation to its
// evidence).
export type GuidanceScoredCitation = {
  source: "attempt" | "targeted-retest";
  evidenceId: string;
  position: number;
  earned: number;
  points: number;
};

// The practice lane — structurally its own field so it can never merge with
// scored citations (D2/AD-7 evidence separation): counts per declared kind,
// plus the latest incorrect response as the citable practice evidence.
export type GuidancePracticeLatest = { attempted: string; evidenceKind: "unaided" | "assisted"; submittedAt: string };
export type GuidancePracticeLane = {
  unaidedCorrect: number;
  unaidedIncorrect: number;
  assistedCorrect: number;
  assistedIncorrect: number;
  latestIncorrect: GuidancePracticeLatest | null;
};

// One guidance entry per objective needing attention: a still-failed or
// partially-recovered group (with its cited scored evidence) or an unassessed
// objective (no scored citations by definition; practice may still render).
export type GuidanceEntry = {
  objectiveIndex: number;
  objective: string;
  status: GuidanceStatus;
  scored: GuidanceScoredCitation[];
  practice: GuidancePracticeLane | null;
};

// The fixed uncertainty note rides the view so every surface states the same
// limits in text (the accessibility floor: uncertainty stated, never hidden
// behind iconography or color alone).
export const GUIDANCE_UNCERTAINTY_NOTE =
  "Needs practice names observed difficulty — it does not claim a cause (forgetting, misunderstanding or a flawed question) or mastery. Unknown means not yet assessed, not weakness. Practice evidence is labeled by its kind and never merges with unaided scored evidence.";
export type GuidanceView = { entries: GuidanceEntry[]; note: string };

// The thinnest honest flag (the diagnostic flagItem/CheckFlag precedent,
// assessment-shaped): the command names one GRADED attempt or retest item; the
// flag is one-way, records with the evidence, and changes no outcome.
// Under-review mechanics, decision pauses and corrections are entry 7's, not
// this command's.
export const flagAssessmentItemSchema = commandSchema.extend({
  evidenceKind: z.enum(["attempt", "retest"]),
  evidenceId: uuid,
  position: z.number().int().min(1),
});
export type FlagAssessmentItem = z.infer<typeof flagAssessmentItemSchema>;
export type AssessmentFlag = {
  rootId: string;
  operationId: string;
  revision: number;
  state: "flagged";
  evidenceKind: "attempt" | "retest";
  evidenceId: string;
  position: number;
  flagged: true;
};

// A served flag (the UI hides a flag button once its item is flagged). The
// flag is one-way: it exists or does not; nothing unsets it.
export type AssessmentFlagView = { evidenceKind: "attempt" | "retest"; evidenceId: string; position: number; flaggedAt: string };

// ---------------------------------------------------------------------------
// Story 7 — disputed-item correction and honest retries (D3 quality/
// correction + retries). The story-5 flag extends into a two-state dispute
// machine: one dispute per flag, opening UNDER REVIEW; a clearing corrected
// replacement resolves it CORRECTED. There is deliberately no third state —
// personal study has no adjudicator, so nothing auto-upholds a dispute.
// ---------------------------------------------------------------------------

export const disputeStatuses = ["under-review", "corrected"] as const;
export type DisputeStatus = (typeof disputeStatuses)[number];

// The corrected/replacement assessment's testId (a distinct id keeps
// replacement snapshots distinguishable from ordinary attempts and retests
// while reusing the same item shape and grading arithmetic).
export const REPLACEMENT_TEST_ID = "corrected-replacement-1";

// The honest daily budget for FRESH QUESTION GENERATION (retest and
// replacement starts — ordinary attempt starts reuse the fixed root bank,
// are never limited and never counted). A deliberately bounded module
// constant, not config machinery: it is a local synthetic-derivation
// budget, and every surface that names it states the limit and its reset —
// the product never promises unlimited free generation (D3).
export const DAILY_GENERATION_LIMIT = 20;

// Story 7 — the at-start snapshot of one corrected replacement. It reuses
// the shared core under its own testId and mirrors the ROOT attempt's
// blueprint for the disputed item's WHOLE objective group one-for-one (same
// per-item points, root pass mark/answer rule/rubric/override pinned — the
// retest comparability rules) with questions from the manually checked
// replacement pool only.
export const replacementSnapshotSchema = snapshotCoreSchema
  .extend({ testId: z.literal(REPLACEMENT_TEST_ID) })
  .refine(snapshot => snapshot.items.every((_, index) => sequentialPositions(snapshot, index)), {
    message: "Items must be numbered sequentially from 1.",
  })
  .refine(pointsSumToTotal, {
    message: "Per-item points must sum to the declared total.",
  })
  .refine(overrideAgrees, {
    message: "The carried pass-mark override must equal the snapshot's applicable mark.",
  })
  .refine(noRubrics, {
    message: "A corrected replacement is full credit only; only the partial-credit fixture schema carries rubrics.",
  });
export type ReplacementSnapshot = z.infer<typeof replacementSnapshotSchema>;

// Story 7 commands. A replacement start names the OPEN dispute (the group,
// release and pin derive server-side from the dispute's own evidence —
// nothing client-supplied to tamper with); the submit carries the
// replacement id and one chosen answer per answered item, same rules as the
// ordinary/retest submits (unanswered earns zero; anything unmatched is
// INVALID_INPUT).
export const startReplacementSchema = commandSchema.extend({ disputeId: uuid });
export const submitReplacementSchema = commandSchema.extend({
  replacementId: uuid,
  answers: z.array(attemptAnswerSchema).min(0).max(5),
});
export type StartReplacement = z.infer<typeof startReplacementSchema>;
export type SubmitReplacement = z.infer<typeof submitReplacementSchema>;

// Served dispute view: which graded container item is disputed, its
// objective group, its status and (once corrected) which replacement
// resolved it and when. The dispute row IS the defect annotation — the
// attempt/retest evidence itself never changes.
export type AssessmentDisputeView = {
  disputeId: string;
  evidenceKind: "attempt" | "retest";
  evidenceId: string;
  position: number;
  objectiveIndex: number;
  objective: string;
  courseVersion: number;
  status: DisputeStatus;
  openedAt: string;
  resolvedAt: string | null;
  resolvedByReplacement: string | null;
  replacements: ReplacementSummary[];
};

// One replacement's history entry (the active/graded views below carry the
// interactive surface; this is the listed history that is never
// overwritten).
export type ReplacementSummary = {
  replacementId: string;
  disputeId: string;
  status: "active" | "graded";
  startedAt: string;
  gradedAt: string | null;
  group: { objectiveIndex: number; earned: number; total: number; cleared: boolean; displayPercent: string } | null;
};

export type ActiveReplacementView = {
  replacementId: string;
  disputeId: string;
  rootAttemptId: string;
  courseId: string;
  courseVersion: number;
  planRevisionId: string;
  objectiveIndex: number;
  pointsScale: 1 | 100;
  startedAt: string;
  items: AssessmentItemView[];
};

export type GradedReplacementView = {
  replacementId: string;
  disputeId: string;
  rootAttemptId: string;
  courseId: string;
  courseVersion: number;
  planRevisionId: string;
  objectiveIndex: number;
  pointsScale: 1 | 100;
  startedAt: string;
  gradedAt: string;
  group: { objectiveIndex: number; earned: number; total: number; cleared: boolean; displayPercent: string };
  items: GradedItemView[];
};

// The honest quota-delay surface: the named daily fresh-generation budget
// and today's use. Served so surfaces state the limit plainly — never an
// "unlimited" promise — and the denial message can name the reset.
export type GenerationUseView = { dailyLimit: number; usedToday: number };

// Owner-scoped assessment state. `none` is the honest empty state (no
// studyable course yet — unconfirmed or not generated; prior attempts, if a
// regeneration is in flight, stay listed on their pinned versions);
// `offered` shows the threshold, available points and scoring criteria
// BEFORE any start; `active` is the open attempt; `graded` is the latest
// attempt's result with the full history. Story 4: the roadmap node derives
// FROM AWARD ROWS — completed exists only when an earned mini-course award
// pins the STUDIED release (a passed/recovered attempt with no award yet
// keeps the node honestly In progress; earned awards never un-complete).
// `awards` lists every earned award of the root, version-scoped, never
// overwritten; `currentAward` is the award pinning the studied release (null
// while none exists). `versions` lists every ready release of the root so
// the switch flow can offer an explicit informed move; the studied release
// is the explicitly switched one when a pointer exists, else the default
// (current confirmed revision, falling back to latest ready). `recovery` is
// the targeted-recovery chain of the newest graded-failed attempt that has a
// ledger (null before any failed grade) — served NEXT TO the attempt
// result, never merged into it. Story 5: `guidance` is the deterministic
// evidence-linked gap view of the STUDIED release (null with no evidence to
// cite or nothing needing attention); `flags` lists this root's one-way
// unclear-item flags so surfaces hide already-flagged buttons.
//
// Story 7: `disputes` lists this root's item disputes (each flag's Under-
// review/Corrected state, its pinned release and its replacement history);
// `replacement` is the root's open-or-latest corrected replacement (null
// with none); `completionPaused` states whether the STUDIED release's
// completion decision is paused by an open dispute (false whenever the
// studied release's award is already earned — earned completion is never
// revoked, and only pending/unearned decisions ever pause); `generation`
// states the named daily fresh-generation budget and today's use.
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
  awards: CompletionAwardView[];
  currentAward: CompletionAwardView | null;
  versions: number[];
  guidance: GuidanceView | null;
  flags: AssessmentFlagView[];
  disputes: AssessmentDisputeView[];
  replacement: ActiveReplacementView | GradedReplacementView | null;
  completionPaused: boolean;
  generation: GenerationUseView;
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
// Story 7 receipts follow the same content-free rule: a replacement's
// replayable receipt records ids and state only — the graded view rebuilds
// deterministically from the stored snapshot row.
export type StartedReplacement = {
  rootId: string;
  operationId: string;
  planRevisionId: string;
  disputeId: string;
  objectiveIndex: number;
  revision: number;
  state: "active";
};
export type SubmittedReplacement = GradedReplacementView & {
  rootId: string;
  revision: number;
  state: "graded";
};
