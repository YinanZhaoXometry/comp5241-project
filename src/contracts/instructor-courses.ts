import { z } from "zod";
import { commandSchema, uuid } from "./setup";

// Epic-5 entry 1 (manual-course approval-enrollment tracer) contracts. A
// manual course is ONE course with immutable VERSION rows authored by the
// instructor (no AI anywhere in this tracer): each version's content is one
// lesson whose single required reading item is DERIVED from the lesson (the
// epic-2 readingItemFor precedent) — the instructor never authors tracker
// identity. Approval is exact-version (D4): approver, time and the content
// digest are recorded per version, and an unapproved version is invisible to
// learners. There are deliberately no score, test, answer, completion or
// reporting fields here: those belong to later entries.

// ── authored content ────────────────────────────────────────────────────────

export const manualLessonSectionSchema = z.strictObject({
  text: z.string().trim().min(1).max(2000),
});
export const manualLessonSchema = z.strictObject({
  title: z.string().trim().min(1).max(200),
  sections: z.array(manualLessonSectionSchema).min(1).max(4),
});
export type ManualLesson = z.infer<typeof manualLessonSchema>;

// The stored per-version document. contentVersion discriminates the union a
// later entry may grow (the courseContentV1..V4 precedent).
export const manualCourseContentSchema = z.strictObject({
  contentVersion: z.literal(1),
  lesson: manualLessonSchema,
});
export type ManualCourseContent = z.infer<typeof manualCourseContentSchema>;

// Parse a stored content row; null when the document matches no version (the
// honest RETRYABLE_FAILURE path — never repair, never serve partial).
export function storedManualContent(raw: unknown): ManualCourseContent | null {
  const parsed = manualCourseContentSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

// The ONE required content item every manual lesson carries, derived from the
// lesson itself — stable tracker identity, exactly the readingItemFor shape.
export const MANUAL_COURSE_ITEM_ID = "lesson:1:reading";
export type ManualCourseItem = {
  id: typeof MANUAL_COURSE_ITEM_ID;
  kind: "reading";
  required: true;
  title: string;
};
export function manualCourseItem(lesson: { title: string }): ManualCourseItem {
  return {
    id: MANUAL_COURSE_ITEM_ID,
    kind: "reading",
    required: true,
    title: `Read lesson 1: ${lesson.title}`.slice(0, 200),
  };
}

// ── commands ────────────────────────────────────────────────────────────────

export const createCourseSchema = commandSchema.extend({
  title: z.string().trim().min(1).max(160),
});
export type CreateCourse = z.infer<typeof createCourseSchema>;

// Saves the course's next manual version. expectedRevision is the course's
// CURRENT version count (0 for the first draft), so a concurrent save conflicts
// honestly; at most one unapproved version may exist per course at a time.
export const saveDraftSchema = commandSchema.extend({
  courseId: uuid,
  lesson: manualLessonSchema,
});
export type SaveDraft = z.infer<typeof saveDraftSchema>;

// Approves EXACTLY the named version of the instructor's own course (D4):
// the approval record pins approver, time and the stored content digest.
export const approveVersionSchema = commandSchema.extend({
  courseId: uuid,
  versionId: uuid,
});
export type ApproveVersion = z.infer<typeof approveVersionSchema>;

// Single-row enrollment (the CSV import of entry 4 generalizes this). The
// preview is read-only: it resolves the email SERVER-SIDE against
// operator-provisioned accounts and commits nothing.
export const rosterEmailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(254)
  .regex(/^[^@\s]+@[^@\s.]+\.[^@\s]+$/u);
export const rosterNameSchema = z.string().trim().min(1).max(120);
export const enrollmentPreviewSchema = z.strictObject({
  schemaVersion: z.literal(1),
  name: rosterNameSchema,
  email: rosterEmailSchema,
});
export type EnrollmentPreview = z.infer<typeof enrollmentPreviewSchema>;
export const confirmEnrollmentSchema = commandSchema.extend({
  courseId: uuid,
  name: rosterNameSchema,
  email: rosterEmailSchema,
});
export type ConfirmEnrollment = z.infer<typeof confirmEnrollmentSchema>;

// ── receipts and views ──────────────────────────────────────────────────────

export type InstructorReceipt = {
  courseId: string;
  state: string;
  versionId?: string;
  version?: number;
  approvalId?: string;
  enrollmentId?: string;
};

export type InstructorCourseSummary = {
  courseId: string;
  title: string;
  createdAt: string;
  currentVersion: number | null;
  approvedVersion: number | null;
  pendingDraft: boolean;
  enrolledCount: number;
};

export type VersionSummary = {
  versionId: string;
  version: number;
  createdAt: string;
  digest: string;
  approved: boolean;
  approval: { approverName: string; approvedAt: string } | null;
};

export type EnrollmentRecord = {
  enrollmentId: string;
  name: string;
  email: string;
  enrolledAt: string;
};

// The read-only single-row preview result: matched/alreadyEnrolled are
// server-resolved; the preview itself commits nothing.
export type EnrollmentPreviewResult = {
  courseId: string;
  name: string;
  email: string;
  matched: boolean;
  accountName: string | null;
  alreadyEnrolled: boolean;
};

export type InstructorCourseDetail = {
  courseId: string;
  title: string;
  createdAt: string;
  versions: VersionSummary[];
  enrollments: EnrollmentRecord[];
};

// The approval-inspector surfaces (D4): pending exact versions to inspect and
// the committed approval records.
export type ApprovalPendingItem = {
  courseId: string;
  courseTitle: string;
  versionId: string;
  version: number;
  createdAt: string;
  digest: string;
  lesson: ManualLesson;
  item: ManualCourseItem;
};
export type ApprovalRecordView = {
  courseId: string;
  courseTitle: string;
  versionId: string;
  version: number;
  digest: string;
  approverName: string;
  approvedAt: string;
};
export type ApprovalsState = {
  pending: ApprovalPendingItem[];
  approved: ApprovalRecordView[];
};

// Learner-shell views. `pending-approval` is the honest state of an enrolled
// course whose first version is not approved yet; the ready view serves ONLY
// the latest approved version — drafts and superseded versions are invisible.
export type EnrolledCourseSummary = {
  courseId: string;
  title: string;
  state: "ready" | "pending-approval";
  version: number | null;
  approvedAt: string | null;
  lessonTitle: string | null;
};
export type EnrolledCourseView =
  | { state: "pending-approval"; courseId: string; title: string }
  | {
      state: "ready";
      courseId: string;
      title: string;
      version: number;
      approvedAt: string;
      lesson: { number: 1; title: string; sections: Array<{ text: string }> };
      item: ManualCourseItem;
    };
