import type { PoolClient } from "pg";
import type { Identity } from "../../contracts/setup";
import { uuid } from "../../contracts/setup";
import {
  approveVersionSchema,
  confirmEnrollmentSchema,
  createCourseSchema,
  manualCourseItem,
  saveDraftSchema,
  storedManualContent,
  enrollmentPreviewSchema,
  type ApprovalsState,
  type EnrollmentPreviewResult,
  type EnrolledCourseSummary,
  type EnrolledCourseView,
  type InstructorCourseDetail,
  type InstructorCourseSummary,
  type InstructorReceipt,
} from "../../contracts/instructor-courses";
import { transaction } from "../../adapters/postgres/database";
import { authorize } from "../identity-access/access";
import { fail } from "../../platform/errors";
import { parse, requestHash } from "../../platform/commands";
import * as repository from "./repository";

// Epic-5 entry 1: the manual-course approval-enrollment tracer. Every command
// runs in one transaction with the session re-authorized first (AD-2/AD-3);
// instructor endpoints additionally require the admin-assigned instructor
// role AND course ownership, and every denial — wrong role, foreign course,
// non-enrolled learner, ordinary admin, missing course — is the identical
// FORBIDDEN_OR_NOT_FOUND, so nothing leaks existence. No AI, no dispatch, no
// queue jobs: all effects are synchronous SQL.

async function requireInstructor(client: PoolClient, identity: Identity) {
  const principal = await authorize(client, identity);
  if (principal.role !== "instructor") fail("FORBIDDEN_OR_NOT_FOUND");
  return principal;
}

export async function listInstructorCourses(
  identity: Identity,
): Promise<{ courses: InstructorCourseSummary[] }> {
  return transaction(async client => {
    await requireInstructor(client, identity);
    return { courses: await repository.listCourses(client, identity.userId) };
  });
}

export async function createCourse(
  identity: Identity,
  raw: unknown,
): Promise<InstructorReceipt> {
  const command = parse(createCourseSchema, raw);
  const hash = requestHash({ command });
  return transaction(async client => {
    await requireInstructor(client, identity);
    const repeated = await repository.replay<InstructorReceipt>(
      client, identity.userId, command, "create-course", hash,
    );
    if (repeated) return repeated;
    const courseId = crypto.randomUUID();
    await client.query(
      "INSERT INTO app.instructor_course(id,owner_id,title) VALUES($1,$2,$3)",
      [courseId, identity.userId, command.title],
    );
    return repository.receipt(client, identity.userId, command, "create-course", hash, courseId, {
      courseId,
      state: "created",
    });
  });
}

export async function getCourseDetail(
  identity: Identity,
  rawId: string,
): Promise<InstructorCourseDetail> {
  const courseId = parse(uuid, rawId);
  return transaction(async client => {
    await requireInstructor(client, identity);
    const course = await repository.ownedCourse(client, identity.userId, courseId);
    const [versions, enrollments] = await Promise.all([
      repository.versionsOf(client, courseId),
      repository.enrollmentsOf(client, courseId),
    ]);
    return {
      courseId: course.id,
      title: course.title,
      createdAt: course.created_at.toISOString(),
      versions: versions.map(repository.versionSummary),
      enrollments,
    };
  });
}

// Saves the course's next manual version. expectedRevision is the course's
// current version count and at most one unapproved version may exist, so a
// concurrent or repeated-with-new-key save conflicts honestly; the full
// authoring substrate (iterative edits, invalidation) is entry 2.
export async function saveDraft(
  identity: Identity,
  raw: unknown,
): Promise<InstructorReceipt> {
  const command = parse(saveDraftSchema, raw);
  const content = { contentVersion: 1 as const, lesson: command.lesson };
  const digest = requestHash(content);
  const hash = requestHash({ command });
  return transaction(async client => {
    await requireInstructor(client, identity);
    const repeated = await repository.replay<InstructorReceipt>(
      client, identity.userId, command, "save-draft", hash,
    );
    if (repeated) return repeated;
    const course = await repository.ownedCourse(client, identity.userId, command.courseId);
    const count = await repository.versionCount(client, course.id);
    if (count !== command.expectedRevision) fail("CONFLICT");
    if (await repository.hasPendingDraft(client, course.id)) fail("CONFLICT");
    const versionId = await repository.insertVersion(
      client, course.id, count + 1, content, digest,
    );
    return repository.receipt(client, identity.userId, command, "save-draft", hash, course.id, {
      courseId: course.id,
      versionId,
      version: count + 1,
      state: "draft",
    });
  });
}

// The D4 exact-version approval: a deliberate authenticated action recording
// approver, time and the stored content digest. Approving an already-approved
// version under a fresh command is idempotent (the existing record returns;
// the version PK keeps exactly one approval row); a foreign or unknown
// versionId is the standard no-leak denial.
export async function approveVersion(
  identity: Identity,
  raw: unknown,
): Promise<InstructorReceipt> {
  const command = parse(approveVersionSchema, raw);
  const hash = requestHash({ command });
  return transaction(async client => {
    await requireInstructor(client, identity);
    const repeated = await repository.replay<InstructorReceipt>(
      client, identity.userId, command, "approve-version", hash,
    );
    if (repeated) return repeated;
    const course = await repository.ownedCourse(client, identity.userId, command.courseId);
    const version = await repository.versionById(client, course.id, command.versionId);
    if (!version) fail("FORBIDDEN_OR_NOT_FOUND");
    const existing = await repository.approvalOf(client, version.id);
    const approvalId =
      existing?.id ??
      (await repository.insertApproval(client, version.id, identity.userId, version.content_digest));
    return repository.receipt(client, identity.userId, command, "approve-version", hash, course.id, {
      courseId: course.id,
      versionId: version.id,
      version: version.version,
      approvalId,
      state: "approved",
    });
  });
}

// Read-only single-row preview (D5): resolves the email server-side against
// operator-provisioned accounts and commits nothing — confirmation is a
// separate explicit command that re-resolves the row itself.
export async function previewEnrollment(
  identity: Identity,
  rawId: string,
  raw: unknown,
): Promise<EnrollmentPreviewResult> {
  const courseId = parse(uuid, rawId);
  const row = parse(enrollmentPreviewSchema, raw);
  return transaction(async client => {
    await requireInstructor(client, identity);
    const course = await repository.ownedCourse(client, identity.userId, courseId);
    const account = await repository.provisionedAccountByEmail(client, row.email);
    const alreadyEnrolled = account
      ? await repository.enrollmentFor(client, course.id, account.userId)
      : null;
    return {
      courseId: course.id,
      name: row.name,
      email: row.email,
      matched: account !== null,
      accountName: account?.name ?? null,
      alreadyEnrolled: alreadyEnrolled !== null,
    };
  });
}

export async function confirmEnrollment(
  identity: Identity,
  raw: unknown,
): Promise<InstructorReceipt> {
  const command = parse(confirmEnrollmentSchema, raw);
  const hash = requestHash({ command });
  return transaction(async client => {
    await requireInstructor(client, identity);
    const repeated = await repository.replay<InstructorReceipt>(
      client, identity.userId, command, "confirm-enrollment", hash,
    );
    if (repeated) return repeated;
    const course = await repository.ownedCourse(client, identity.userId, command.courseId);
    // The confirm row is re-resolved SERVER-SIDE; a client assertion of a
    // matched account is never accepted (AD-14).
    const account = await repository.provisionedAccountByEmail(client, command.email);
    if (!account) fail("INVALID_INPUT");
    const existing = await repository.enrollmentFor(client, course.id, account.userId);
    const enrollmentId =
      existing ?? (await repository.insertEnrollment(
        client, course.id, account.userId, command.name, command.email,
      ));
    return repository.receipt(client, identity.userId, command, "confirm-enrollment", hash, course.id, {
      courseId: course.id,
      enrollmentId,
      state: existing ? "already-enrolled" : "enrolled",
    });
  });
}

// ── approval inspector ──────────────────────────────────────────────────────

export async function getApprovals(identity: Identity): Promise<ApprovalsState> {
  return transaction(async client => {
    await requireInstructor(client, identity);
    const [pending, approved] = await Promise.all([
      repository.pendingRows(client, identity.userId),
      repository.approvedRows(client, identity.userId),
    ]);
    return {
      pending: pending.flatMap(row => {
        const content = storedManualContent(row.content);
        // A stored document that matches no contract version is served to no
        // inspector (honest RETRYABLE_FAILURE), never repaired.
        if (!content) fail("RETRYABLE_FAILURE");
        return [{
          courseId: row.courseId,
          courseTitle: row.courseTitle,
          versionId: row.versionId,
          version: row.version,
          createdAt: row.createdAt.toISOString(),
          digest: row.digest,
          lesson: content.lesson,
          item: manualCourseItem(content.lesson),
        }];
      }),
      approved: approved.map(row => ({
        courseId: row.courseId,
        courseTitle: row.courseTitle,
        versionId: row.versionId,
        version: row.version,
        digest: row.digest,
        approverName: row.approverName,
        approvedAt: row.approvedAt.toISOString(),
      })),
    };
  });
}

// ── learner shell ───────────────────────────────────────────────────────────

export async function learnerEnrollments(
  identity: Identity,
): Promise<{ courses: EnrolledCourseSummary[] }> {
  return transaction(async client => {
    await authorize(client, identity);
    const rows = await repository.enrolledCourses(client, identity.userId);
    return {
      courses: rows.map(row => ({
        courseId: row.courseId,
        title: row.title,
        state: row.version === null ? ("pending-approval" as const) : ("ready" as const),
        version: row.version,
        approvedAt: row.approvedAt?.toISOString() ?? null,
        lessonTitle: row.lessonTitle,
      })),
    };
  });
}

// The enrolled study path: ONLY the latest approved version is ever read —
// drafts, superseded versions and the roster are invisible, and every
// non-enrolled requester gets the identical no-existence-leak denial.
export async function learnerCourse(
  identity: Identity,
  rawId: string,
): Promise<EnrolledCourseView> {
  const courseId = parse(uuid, rawId);
  return transaction(async client => {
    await authorize(client, identity);
    const course = await client.query<{ title: string }>(
      "SELECT title FROM app.instructor_course WHERE id=$1",
      [courseId],
    );
    if (!course.rows[0] || !(await repository.enrollmentExists(client, courseId, identity.userId)))
      fail("FORBIDDEN_OR_NOT_FOUND");
    const approved = await repository.latestApprovedVersion(client, courseId);
    if (!approved) return { state: "pending-approval", courseId, title: course.rows[0].title };
    const content = storedManualContent(approved.content);
    if (!content) fail("RETRYABLE_FAILURE");
    return {
      state: "ready",
      courseId,
      title: course.rows[0].title,
      version: approved.version,
      approvedAt: approved.approved_at.toISOString(),
      lesson: {
        number: 1,
        title: content.lesson.title,
        sections: content.lesson.sections.map(section => ({ text: section.text })),
      },
      item: manualCourseItem(content.lesson),
    };
  });
}
