import { z } from "zod";
import { commandSchema, uuid } from "./setup";

// Epic-2 S1 (confirmed-plan-to-generated-course tracer) contracts. A generated
// course is a VERSIONED derivative of the exact confirmed plan revision: one
// lesson with per-section source locations, resolved objectives, and ONE
// recall item. The recall item's canonical answer and rationale are NEVER part
// of any read model — they exist only in the stored content and in submission
// feedback. There are deliberately no score, grade, attempt-evidence,
// completion or credit fields here: typed practice evidence belongs to entry 5.

export const COURSE_QUEUE = "course-generation";
// The synthetic fixture's honest model provenance: local, deterministic,
// zero-token. A live processor (gate F-A) would record its own model string.
export const SYNTHETIC_COURSE_MODEL = "local-synthetic-course-fixture-v1";

const sourceRefSchema = z.strictObject({
  extractionId: uuid,
  filename: z.string().trim().min(1).max(184),
  locator: z.string().trim().min(1).max(120),
});

export const courseSectionSchema = z.strictObject({
  text: z.string().trim().min(1).max(2000),
  sourceRef: sourceRefSchema,
});
export const courseObjectiveSchema = z.strictObject({
  index: z.number().int().min(0).max(7),
  text: z.string().trim().min(1).max(300),
});
// Canonical answer/rationale live here and in the submission feedback ONLY.
export const courseRecallSchema = z.strictObject({
  objectiveIndex: z.number().int().min(0).max(7),
  sourceRef: sourceRefSchema,
  prompt: z.string().trim().min(1).max(1200),
  answer: z.string().trim().min(1).max(800),
  rationale: z.string().trim().min(1).max(800),
});
export const courseContentSchema = z.strictObject({
  // The lesson title is taken from the confirmed plan's own lesson list by the
  // strict parser — the processor never supplies or renames it.
  lessonTitle: z.string().trim().min(1).max(200),
  sections: z.array(courseSectionSchema).min(1).max(8),
  objectives: z.array(courseObjectiveSchema).min(1).max(8),
  recall: courseRecallSchema,
});
export type CourseContent = z.infer<typeof courseContentSchema>;
export type CourseSourceRef = z.infer<typeof sourceRefSchema>;

// The processor's DRAFT shape: index/position links only. Everything that
// identifies a source or objective is resolved against the confirmed plan and
// the handoff's source list by the strict parser — never trusted from output.
export const courseDraftSectionSchema = z.strictObject({
  text: z.string().trim().min(1).max(2000),
  sourcePosition: z.number().int().min(0).max(9),
  locator: z.string().trim().min(1).max(120),
});
export const courseDraftRecallSchema = z.strictObject({
  objectiveIndex: z.number().int().min(0).max(7),
  sourcePosition: z.number().int().min(0).max(9),
  locator: z.string().trim().min(1).max(120),
  prompt: z.string().trim().min(1).max(1200),
  answer: z.string().trim().min(1).max(800),
  rationale: z.string().trim().min(1).max(800),
});
export const courseDraftSchema = z.strictObject({
  sections: z.array(courseDraftSectionSchema).min(1).max(8),
  objectiveIndexes: z.array(z.number().int().min(0).max(7)).min(1).max(8),
  recall: courseDraftRecallSchema,
});
export type CourseDraft = z.infer<typeof courseDraftSchema>;

// Restart-safe job envelope: id = request id, one attempt (retryLimit 0), the
// recorded owner identity re-authorizes every fence at consume time.
export const courseJobSchema = z.strictObject({
  schemaVersion: z.literal(1),
  requestId: uuid,
  admissionId: uuid,
  rootId: uuid,
  ownerId: uuid,
  sessionId: uuid,
});
export type CourseJob = z.infer<typeof courseJobSchema>;

// Recall submission: the plain command envelope plus the attempted recall
// text. Feedback is computed and returned (and replayed by command key); no
// attempt-evidence row is written (entry 5 owns typed practice evidence).
export const submitRecallSchema = commandSchema.extend({
  attempted: z.string().trim().min(1).max(2000),
});
export type SubmitRecall = z.infer<typeof submitRecallSchema>;

export type CourseUsage = { inputTokens: number; outputTokens: number; totalTokens: number };

// Owner-scoped study state. `none` is the honest empty state of a confirmed
// plan whose course has not been generated; the recall answer appears in no
// state below, only in RecallFeedback after submission.
export type CourseState =
  | { state: "none"; rootId: string; revision: number }
  | { state: "pending"; rootId: string; revision: number; requestId: string }
  | { state: "failed"; rootId: string; revision: number; requestId: string; failureCode: string | null }
  | { state: "ready"; rootId: string; revision: number; course: CourseView };

export type CourseView = {
  courseId: string;
  requestId: string;
  planRevisionId: string;
  selectionId: string;
  version: number;
  // A newer ready course version exists for this root (re-confirm → regenerate).
  superseded: boolean;
  // The course belongs to a previous confirmed plan revision.
  historical: boolean;
  model: string;
  usage: CourseUsage | null;
  createdAt: string;
  settledAt: string;
  lesson: {
    title: string;
    sections: Array<{ text: string; source: { filename: string; locator: string } }>;
  };
  objectives: Array<{ index: number; text: string }>;
  recall: {
    prompt: string;
    objective: string;
    source: { filename: string; locator: string };
  };
};

// Released exactly once per submission command; the sole reveal path for the
// canonical answer and rationale.
export type RecallFeedback = {
  rootId: string;
  revision: number;
  courseId: string;
  outcome: "correct" | "incorrect";
  attempted: string;
  answer: string;
  rationale: string;
  source: { filename: string; locator: string };
};

// ---------------------------------------------------------------------------
// Epic-2 S2: bounded source retrieval and attributed supplementation. A
// supplement pass runs over ONE ready course version: the processor only ever
// PROPOSES candidate public sources for the plan's declared gaps; the bounded
// fetcher retrieves them; deterministic code verifies every claimed passage
// against the fetched bytes. There are deliberately no score, credit or
// completion semantics here, and supplements never rewrite uploads.
// ---------------------------------------------------------------------------

export const SUPPLEMENT_QUEUE = "supplement-fetch-v1";
// The synthetic proposal fixture's honest model provenance (the fetch side
// is not a model at all). A live proposal processor (F-A) would record its
// own model string.
export const SYNTHETIC_PROPOSAL_MODEL = "local-synthetic-supplement-proposal-fixture-v1";

// The dispatch command pins the exact ready course version being
// supplemented (the stage knows it from the served course view).
export const requestSupplementsSchema = commandSchema.extend({ courseId: uuid });
export type RequestSupplements = z.infer<typeof requestSupplementsSchema>;

// Restart-safe job envelope: id = request id, one attempt (retryLimit 0), the
// recorded owner identity re-authorizes every fence at consume time.
export const supplementJobSchema = z.strictObject({
  schemaVersion: z.literal(1),
  requestId: uuid,
  admissionId: uuid,
  courseId: uuid,
  rootId: uuid,
  ownerId: uuid,
  sessionId: uuid,
});
export type SupplementJob = z.infer<typeof supplementJobSchema>;

// One declared gap, derived server-side from the confirmed plan's own
// missingExplanations plus the generated lesson's outcome context — never
// model-supplied.
export type CourseGap = { index: number; description: string; objective: string };
export const supplementOutcomes = ["supported", "conflict", "unsupported"] as const;
export type SupplementOutcome = (typeof supplementOutcomes)[number];

// The processor's DRAFT shape: index links only. Host must be allowlisted,
// the claim must restate the gap it answers, and everything identifying real
// content (the gap, the outcome, the upload section) is resolved against the
// course and plan by the strict parser — never trusted from output.
export const supplementCandidateDraftSchema = z.strictObject({
  gapIndex: z.number().int().min(0).max(7),
  host: z.string().trim().toLowerCase().min(4).max(253),
  // A path only: no query, no fragment, no credentials — the fetch URL is
  // built as https://{allowlisted host}{path} and revalidated by the boundary.
  path: z.string().max(512).regex(/^\/[A-Za-z0-9._~!$&'()*+,;=:@/-]*$/u),
  claim: z.string().trim().min(1).max(300),
  expectedPassage: z.string().trim().min(1).max(2000),
  outcomeIndex: z.number().int().min(0).max(7),
  sectionIndex: z.number().int().min(0).max(7),
});
export const supplementProposalDraftSchema = z.strictObject({
  candidates: z.array(supplementCandidateDraftSchema).min(1).max(8),
});
export type SupplementCandidateDraft = z.infer<typeof supplementCandidateDraftSchema>;

// A persisted, verified supplement record (served shape). 'unsupported'
// carries no passage/hash — only the honest record that the claimed passage
// was checked against the fetched source and not found.
export type SupplementRecord = {
  position: number;
  outcome: SupplementOutcome;
  url: string;
  origin: string;
  locator: string | null;
  passage: string | null;
  contentHash: string | null;
  retrievedAt: string | null;
  claim: string;
  conflict: { uploadExcerpt: string; uploadSource: string } | null;
};
export type GapResolution = { gap: CourseGap; outcome: SupplementOutcome | "unaddressed"; supplement: SupplementRecord | null };

// Owner-scoped supplement state for one course version. `none` is the honest
// state of gaps the pass has not run on; per-gap outcomes are honest in every
// state and never become a scored item. `gapCount` is the plan's DECLARED gap
// total — `gaps` carries at most the first MAX_GAPS (8) and `gapsTruncated`
// states honestly when the release's cap dropped declared gaps.
export type SupplementsState = {
  state: "none" | "pending" | "failed" | "ready";
  rootId: string;
  revision: number;
  courseId: string;
  version: number;
  gapCount: number;
  gapsTruncated: boolean;
  requestId?: string;
  failureCode?: string | null;
  gaps: GapResolution[];
};
