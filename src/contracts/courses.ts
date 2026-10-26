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
// Legacy single-lesson content (pre-2.3 stored rows). Kept verbatim so those
// rows keep serving unchanged; the v2 union below wraps them at read time —
// no regeneration-on-read, no silent rewrite.
export const courseContentV1Schema = z.strictObject({
  // The lesson title is taken from the confirmed plan's own lesson list by the
  // strict parser — the processor never supplies or renames it.
  lessonTitle: z.string().trim().min(1).max(200),
  sections: z.array(courseSectionSchema).min(1).max(8),
  objectives: z.array(courseObjectiveSchema).min(1).max(8),
  recall: courseRecallSchema,
});
export type CourseContentV1 = z.infer<typeof courseContentV1Schema>;

// ---------------------------------------------------------------------------
// Epic-2 S3: content v2 — the confirmed plan's FULL lesson set with per-lesson
// sections and explicit tracker items. Required items are the lessons' own
// readings; optional enrichment is generated, labeled and never blocks. There
// are deliberately no score, credit, completion, dwell or scroll fields: done
// is ONLY an explicit learner action recorded in the owner-scoped tracker
// table (migration 017), never inferred from anything here.
// ---------------------------------------------------------------------------

export const courseItemKinds = ["reading", "enrichment"] as const;
export type CourseItemKind = (typeof courseItemKinds)[number];
// Stable tracker identity per (course version, lesson, item kind) — plain
// string ids so no new uuid surface enters URLs.
export const courseItemIdPattern = /^(lesson:[1-8]:reading|enrichment:[1-8])$/u;

export const courseItemSchema = z.strictObject({
  id: z.string().regex(courseItemIdPattern),
  kind: z.enum(courseItemKinds),
  required: z.boolean(),
  title: z.string().trim().min(1).max(200),
});
export type CourseItem = z.infer<typeof courseItemSchema>;

export const courseLessonSchema = z.strictObject({
  // From the confirmed plan's own lesson list — the strict parser substitutes
  // titles in plan order; the processor never supplies or renames them.
  title: z.string().trim().min(1).max(200),
  sections: z.array(courseSectionSchema).min(1).max(8),
  items: z.array(courseItemSchema).min(1).max(4),
});

// Optional enrichment: exactly one overall, labeled optional, never blocking.
export const courseEnrichmentSchema = z.strictObject({
  id: z.literal("enrichment:1"),
  kind: z.literal("enrichment"),
  required: z.literal(false),
  title: z.string().trim().min(1).max(200),
  text: z.string().trim().min(1).max(2000),
  sourceRef: sourceRefSchema,
});
export type CourseEnrichment = z.infer<typeof courseEnrichmentSchema>;

// Each lesson carries EXACTLY its own required reading item, identified by its
// 1-based position in the numbered sequence (shared by content v2 and v3).
function refinePositionalReadingItems(
  content: { lessons: Array<{ items: CourseItem[] }> },
  context: z.RefinementCtx,
): void {
  content.lessons.forEach((lesson, index) => {
    const expected = `lesson:${index + 1}:reading`;
    const ok = lesson.items.length === 1
      && lesson.items[0].id === expected
      && lesson.items[0].kind === "reading"
      && lesson.items[0].required === true;
    if (!ok)
      context.addIssue({
        code: "custom",
        path: ["lessons", index, "items"],
        message: `lesson ${index + 1} must carry exactly its required reading item ${expected}`,
      });
  });
}

export const courseContentV2Schema = z
  .strictObject({
    contentVersion: z.literal(2),
    lessons: z.array(courseLessonSchema).min(1).max(8),
    objectives: z.array(courseObjectiveSchema).min(1).max(8),
    recall: courseRecallSchema,
    enrichment: courseEnrichmentSchema.optional(),
  })
  .superRefine((content, context) => refinePositionalReadingItems(content, context));
export type CourseContentV2 = z.infer<typeof courseContentV2Schema>;

// ---------------------------------------------------------------------------
// Epic-2 S4: content v3 — background/goal adaptation. The FACTUAL core (lesson
// titles and order, per-section text and source links, objectives, required
// tracker items, the recall item and the optional enrichment) is IDENTICAL
// across tracks; only the TREATMENT differs — one framing paragraph per lesson
// (rendered before that lesson's sections) plus the course-level adaptation
// record. Keeping the framing OUT of the factual sections is what makes
// "identical factual claims and source links across tracks" structurally
// checkable (see adaptation.ts) rather than eyeballed. The track itself is
// never processor-supplied: deterministic code derives it from the stated
// background, exactly like lesson titles come from the confirmed plan.
// ---------------------------------------------------------------------------

export const courseTracks = ["beginner", "advanced", "neutral"] as const;
export type CourseTrack = (typeof courseTracks)[number];

// The stored adaptation basis: the deterministic track derived from the stated
// background (empty, missing or unmatched ⇒ neutral — no invention) plus a
// bounded summary of what was actually stated. `backgroundSummary` may be
// empty; the served pitch line renders only for a non-neutral track.
export const courseAdaptationSchema = z.strictObject({
  track: z.enum(courseTracks),
  backgroundSummary: z.string().trim().max(400),
});
export type CourseAdaptation = z.infer<typeof courseAdaptationSchema>;

// v3 lesson = the v2 lesson shape plus the treatment framing paragraph. The
// framing is prose only: it may pitch plain language, examples, prerequisites
// or trade-off depth, never a factual claim its sources do not state.
export const courseLessonV3Schema = courseLessonSchema.extend({
  framing: z.string().trim().min(1).max(600),
});

export const courseContentV3Schema = z
  .strictObject({
    contentVersion: z.literal(3),
    lessons: z.array(courseLessonV3Schema).min(1).max(8),
    objectives: z.array(courseObjectiveSchema).min(1).max(8),
    recall: courseRecallSchema,
    enrichment: courseEnrichmentSchema.optional(),
    adaptation: courseAdaptationSchema,
    // SHA-256 hex over the FACTUAL core only (lesson titles in order, every
    // section's text, its source's filename + locator — the study-independent
    // ref parts — objectives, the full recall item including its answer, and
    // the optional enrichment; everything the cross-track validator calls the
    // factual core, a narrower digest could report false identity). Computed
    // by the strict parser at settle time and stored with the content so any
    // consumer (entry 7's provenance surface included) can check cross-course
    // fact identity cheaply. Treatment (framing, adaptation) and per-upload
    // extraction ids never enter the digest.
    factsDigest: z.string().regex(/^[0-9a-f]{64}$/u),
  })
  .superRefine((content, context) => refinePositionalReadingItems(content, context));
export type CourseContentV3 = z.infer<typeof courseContentV3Schema>;

// The stored-content union: v3 rows parse natively; pre-2.4 v2 rows keep their
// exact stored shape (no adaptation field ⇒ neutral presentation, nothing
// invented); pre-2.3 v1 rows keep theirs and wrap at read time.
export const courseContentSchema = z.union([courseContentV3Schema, courseContentV2Schema, courseContentV1Schema]);
export type CourseContent = CourseContentV3 | CourseContentV2 | CourseContentV1;
// What every settled row serves as after storedCourseContent: v3 native or v2
// (a wrapped legacy v1 row is its own single-lesson v2 degenerate case).
export type CourseContentServing = CourseContentV3 | CourseContentV2;
export type CourseSection = z.infer<typeof courseSectionSchema>;
export type CourseSourceRef = z.infer<typeof sourceRefSchema>;

// The single required reading item a lesson (or a wrapped legacy lesson)
// carries. Pure and shared by the parser and the legacy wrap below.
export function readingItemFor(lessonIndex: number, title: string): CourseItem {
  return {
    id: `lesson:${lessonIndex + 1}:reading`,
    kind: "reading",
    required: true,
    title: `Read lesson ${lessonIndex + 1}: ${title}`.slice(0, 200),
  };
}

// One serving path, no forked UI: a stored v1 row wraps into the v2 shape as
// its own single-lesson degenerate case (derived tracker item, no enrichment —
// v1 content never gains content it did not store).
export function wrapLegacyCourseContent(v1: CourseContentV1): CourseContentV2 {
  return {
    contentVersion: 2,
    lessons: [{
      title: v1.lessonTitle,
      sections: v1.sections,
      items: [readingItemFor(0, v1.lessonTitle)],
    }],
    objectives: v1.objectives,
    recall: v1.recall,
  };
}

// Parse any stored content row into the serving shape; null when the stored
// document matches neither version (the honest RETRYABLE_FAILURE path).
export function storedCourseContent(raw: unknown): CourseContentServing | null {
  const v3 = courseContentV3Schema.safeParse(raw);
  if (v3.success) return v3.data;
  const v2 = courseContentV2Schema.safeParse(raw);
  if (v2.success) return v2.data;
  const v1 = courseContentV1Schema.safeParse(raw);
  if (v1.success) return wrapLegacyCourseContent(v1.data);
  return null;
}

// Treatment accessors over the serving union: pre-2.4 rows (v2, wrapped v1)
// carry no adaptation and no framing — they present neutrally, exactly as
// stored, and nothing is invented for them.
export function contentAdaptation(content: CourseContentServing): CourseAdaptation | null {
  return "adaptation" in content ? content.adaptation : null;
}
export function lessonFraming(lesson: CourseContentServing["lessons"][number]): string | null {
  return "framing" in lesson ? lesson.framing : null;
}
// The stored factual-core digest (v3 rows); null on pre-2.4 rows.
export function contentFactsDigest(content: CourseContentServing): string | null {
  return "factsDigest" in content ? content.factsDigest : null;
}

// Flat tracker-item derivation from content (pure): required reading per
// lesson plus the optional overall enrichment, in sequence order.
export type CourseItemServing = {
  id: string;
  kind: CourseItemKind;
  required: boolean;
  title: string;
  lessonNumber: number | null;
  text: string | null;
  source: { filename: string; locator: string } | null;
};
export function courseTrackerItems(content: CourseContentServing): CourseItemServing[] {
  const items: CourseItemServing[] = [];
  content.lessons.forEach((lesson, index) => {
    for (const item of lesson.items)
      items.push({ id: item.id, kind: item.kind, required: item.required, title: item.title, lessonNumber: index + 1, text: null, source: null });
  });
  if (content.enrichment)
    items.push({
      id: content.enrichment.id,
      kind: "enrichment",
      required: false,
      title: content.enrichment.title,
      lessonNumber: null,
      text: content.enrichment.text,
      source: { filename: content.enrichment.sourceRef.filename, locator: content.enrichment.sourceRef.locator },
    });
  return items;
}

// The processor's DRAFT shapes: index/position links only. Everything that
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

// Epic-2 S3 v2 draft: one lessons entry per CONFIRMED PLAN lesson, in listed
// order (the parser enforces count/order and substitutes every title), plus an
// optional overall enrichment passage. Lesson count and titles are plan-owned.
export const courseDraftLessonSchema = z.strictObject({
  sections: z.array(courseDraftSectionSchema).min(1).max(8),
});
export const courseDraftEnrichmentSchema = z.strictObject({
  sourcePosition: z.number().int().min(0).max(9),
  locator: z.string().trim().min(1).max(120),
  text: z.string().trim().min(1).max(2000),
});
// Epic-2 S4 v3 draft: the v2 shape plus the per-lesson TREATMENT framing
// paragraph. The track itself is NEVER part of the reply — deterministic code
// derives it from the stated background (adaptation.ts) and the parser
// substitutes the adaptation record, exactly like it substitutes lesson titles
// from the plan.
export const courseDraftLessonV3Schema = courseDraftLessonSchema.extend({
  framing: z.string().trim().min(1).max(600),
});
export const courseDraftV3Schema = z.strictObject({
  lessons: z.array(courseDraftLessonV3Schema).min(1).max(8),
  objectiveIndexes: z.array(z.number().int().min(0).max(7)).min(1).max(8),
  recall: courseDraftRecallSchema,
  enrichment: courseDraftEnrichmentSchema.optional(),
});
export type CourseDraftV3 = z.infer<typeof courseDraftV3Schema>;

// The legacy single-lesson draft shape (pre-2.3 processors); kept so the
// contract record stays complete. Generation now emits and accepts v3 only.
export const courseDraftV1Schema = z.strictObject({
  sections: z.array(courseDraftSectionSchema).min(1).max(8),
  objectiveIndexes: z.array(z.number().int().min(0).max(7)).min(1).max(8),
  recall: courseDraftRecallSchema,
});
export type CourseDraftV1 = z.infer<typeof courseDraftV1Schema>;

// The pre-2.4 multi-lesson draft shape (no framing); kept so the contract
// record stays complete. A draft without per-lesson framing is now INVALID —
// the v3 parser rejects it, never repairs it.
export const courseDraftV2Schema = z.strictObject({
  lessons: z.array(courseDraftLessonSchema).min(1).max(8),
  objectiveIndexes: z.array(z.number().int().min(0).max(7)).min(1).max(8),
  recall: courseDraftRecallSchema,
  enrichment: courseDraftEnrichmentSchema.optional(),
});
export type CourseDraftV2 = z.infer<typeof courseDraftV2Schema>;

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

// The request-time PIN of the pitch-relevant preference fields, stored on the
// generated_course row (migration 018's nullable preference_pin jsonb). The
// worker consumes the pin — never a live re-read — so a background edited
// between request and worker-run cannot re-pitch the settled course. Rows
// without a valid pin (pre-review legacy rows) fall back to the current
// preference row.
export const coursePreferencePinSchema = z.strictObject({
  goal: z.string().max(200),
  topic: z.string().max(160),
  background: z.string().max(400),
});
export type CoursePreferencePin = z.infer<typeof coursePreferencePinSchema>;

// Recall submission: the plain command envelope plus the attempted recall
// text. Feedback is computed and returned (and replayed by command key); no
// attempt-evidence row is written (entry 5 owns typed practice evidence).
export const submitRecallSchema = commandSchema.extend({
  attempted: z.string().trim().min(1).max(2000),
});
export type SubmitRecall = z.infer<typeof submitRecallSchema>;

// Epic-2 S3 explicit content-item mark-done: the plain command envelope plus
// the exact ready course version and the stable item id being marked. Only
// required items are markable — optional enrichment is labeled and never
// tracked. Replay rides the existing command_receipt machinery.
export const markItemDoneSchema = commandSchema.extend({
  courseId: uuid,
  itemId: z.string().trim().min(3).max(40),
});
export type MarkItemDone = z.infer<typeof markItemDoneSchema>;

export type CourseUsage = { inputTokens: number; outputTokens: number; totalTokens: number };

// Owner-scoped study state. `none` is the honest empty state of a confirmed
// plan whose course has not been generated; the recall answer appears in no
// state below, only in RecallFeedback after submission.
export type CourseState =
  | { state: "none"; rootId: string; revision: number }
  | { state: "pending"; rootId: string; revision: number; requestId: string }
  | { state: "failed"; rootId: string; revision: number; requestId: string; failureCode: string | null }
  | { state: "ready"; rootId: string; revision: number; course: CourseView };

export type CourseLessonView = {
  // 1-based: the numbered sequence of the player shell.
  number: number;
  title: string;
  // Epic-2 S4 treatment paragraph rendered before this lesson's sections;
  // null on pre-2.4 rows (no adaptation field ⇒ neutral presentation).
  framing: string | null;
  sections: Array<{ text: string; source: { filename: string; locator: string } }>;
};

// One tracker row with its server-persisted done state. `done` is ONLY the
// explicit mark-done outcome — there is no dwell, scroll or visibility
// inference anywhere, and optional rows are served labeled, never blocking.
export type CourseItemView = CourseItemServing & {
  done: boolean;
  doneAt: string | null;
};

export type CourseView = {
  courseId: string;
  requestId: string;
  planRevisionId: string;
  selectionId: string;
  version: number;
  // A newer ready course version exists for this root (re-confirm → regenerate).
  superseded: boolean;
  // The newest ready per-root version number when superseded (what an explicit
  // switch moves to); null otherwise.
  supersededBy: number | null;
  // The course belongs to a previous confirmed plan revision.
  historical: boolean;
  model: string;
  usage: CourseUsage | null;
  createdAt: string;
  settledAt: string;
  // Epic-2 S4 adaptation basis stored with the content (track derived
  // deterministically from the stated background at generation time + the
  // bounded summary of what was stated); null on pre-2.4 rows, which serve
  // unchanged and present neutrally. A neutral track claims no track.
  adaptation: CourseAdaptation | null;
  // SHA-256 hex of the factual core (v3 rows) — two courses generated from
  // the same plan and sources under different tracks share it; null on
  // pre-2.4 rows.
  factsDigest: string | null;
  // The full numbered lesson sequence (a stored v1 course serves as its own
  // single-lesson degenerate case through the same shape).
  lessons: CourseLessonView[];
  // Flat tracker items (required readings per lesson + optional enrichment)
  // with this owner's done state for THIS course version.
  items: CourseItemView[];
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
