import { afterAll, describe, expect, it } from "vitest";
import { auth } from "../../src/modules/identity-access/auth";
import { provisionSynthetic } from "../../src/modules/identity-access/provision";
import {
  approveVersion,
  confirmEnrollment,
  createCourse,
  getApprovals,
  getCourseDetail,
  learnerCourse,
  learnerEnrollments,
  listInstructorCourses,
  previewEnrollment,
  saveDraft,
} from "../../src/modules/instructor-courses/service";
import { personalRemoval } from "../../src/modules/lifecycle-platform/service";
import { database, closeDatabase } from "../../src/adapters/postgres/database";
import type { Identity } from "../../src/contracts/setup";
import type { DependencyPreview } from "../../src/modules/lifecycle-platform/dependencies";

// LOCAL SYNTHETIC coverage of the epic-5 entry-1 manual-course approval-
// enrollment tracer: the full instructor path (create → manual draft v1 →
// exact-version approval with approver/time/version recorded → single-row
// enrollment preview/confirm), duplicate-command idempotency (exactly one
// receipt and one effect row each), learner visibility of ONLY the approved
// version (a later draft is invisible), the identical no-existence-leak
// denial for a non-enrolled learner / second instructor / ordinary admin,
// approved-version immutability at the database level, and registration of
// the tracer's records in the epic-1 lifecycle inventory. Real PostgreSQL;
// zero network; no AI anywhere (manual authoring only).

const command = (revision = 0) => ({ schemaVersion: 1 as const, commandKey: crypto.randomUUID(), expectedRevision: revision });

async function actor(label: string, role: "learner" | "instructor" | "admin") {
  const credentials = await provisionSynthetic(label, role);
  const response = await auth().api.signInEmail({ body: { email: credentials.email, password: credentials.password }, asResponse: true });
  const body = await response.json();
  const session = await database().query<{ id: string }>("SELECT id FROM auth.session WHERE token=$1", [body.token]);
  return { identity: { userId: credentials.userId, sessionId: session.rows[0].id } satisfies Identity, credentials };
}

const LESSON = { title: "Manual tracer lesson", sections: [{ text: "Synthetic manual lesson body for the approval-enrollment tracer." }] };

async function deniedBy(actorIdentity: Identity, courseId: string) {
  // The identical no-existence-leak denial: same code, same message, for a
  // non-enrolled learner, a second instructor, an ordinary admin and a
  // missing course alike.
  await expect(learnerCourse(actorIdentity, courseId)).rejects.toThrow("This item is unavailable.");
}

afterAll(async () => {
  await closeDatabase();
});

describe("epic-5 5.1: manual-course approval-enrollment tracer", () => {
  it("runs the full instructor path with exact-version approval, immutable versions and recorded approver/time", async () => {
    const instructor = await actor("epic5-owner", "instructor");
    const createCommand = command();
    const created = await createCourse(instructor.identity, { ...createCommand, title: "Synthetic tracer course" });
    expect(created).toMatchObject({ state: "created" });
    const courseId = created.courseId;
    // A replayed create command returns the identical receipt (one receipt
    // per command key; no second course row).
    const replayedCreate = await createCourse(instructor.identity, { ...createCommand, title: "Synthetic tracer course" });
    expect(replayedCreate).toEqual(created);
    expect((await database().query("SELECT count(*)::int AS count FROM app.instructor_course WHERE owner_id=$1", [instructor.identity.userId])).rows[0].count).toBe(1);

    const draft = await saveDraft(instructor.identity, { ...command(0), courseId, lesson: LESSON });
    expect(draft).toMatchObject({ courseId, version: 1, state: "draft" });
    const versionId = draft.versionId!;

    // The pending draft is inspectable BEFORE approval; learners see nothing yet.
    const approvalsBefore = await getApprovals(instructor.identity);
    expect(approvalsBefore.pending).toHaveLength(1);
    expect(approvalsBefore.pending[0]).toMatchObject({ courseId, versionId, version: 1 });
    expect(approvalsBefore.pending[0].lesson.title).toBe(LESSON.title);
    expect(approvalsBefore.pending[0].item.id).toBe("lesson:1:reading");
    expect(approvalsBefore.approved).toEqual([]);

    // Approve the EXACT version; approver/time/version digest are recorded.
    const approveCommand = command(0);
    const approved = await approveVersion(instructor.identity, { ...approveCommand, courseId, versionId });
    expect(approved).toMatchObject({ courseId, versionId, version: 1, state: "approved" });
    const approvalRow = (await database().query<{ approver_id: string; version_digest: string; approved_at: Date }>(
      "SELECT approver_id,version_digest,approved_at FROM app.instructor_approval WHERE version_id=$1", [versionId],
    )).rows[0];
    expect(approvalRow.approver_id).toBe(instructor.identity.userId);
    expect(approvalRow.version_digest).toHaveLength(64);
    expect(approvalRow.approved_at).toBeInstanceOf(Date);
    const digest = (await database().query<{ content_digest: string }>("SELECT content_digest FROM app.instructor_course_version WHERE id=$1", [versionId])).rows[0].content_digest;
    expect(approvalRow.version_digest).toBe(digest);

    // Duplicate approve: the SAME command replays the identical receipt…
    const replayed = await approveVersion(instructor.identity, { ...approveCommand, courseId, versionId });
    expect(replayed).toEqual(approved);
    // …and a FRESH command on the approved version stays idempotent: the
    // existing approval returns and exactly one approval row exists.
    const reapproved = await approveVersion(instructor.identity, { ...command(0), courseId, versionId });
    expect(reapproved).toMatchObject({ approvalId: approved.approvalId, state: "approved" });
    expect((await database().query("SELECT count(*)::int AS count FROM app.instructor_approval WHERE version_id=$1", [versionId])).rows[0].count).toBe(1);

    // The approved version is immutable at the database level (AD-5).
    await expect(database().query("UPDATE app.instructor_course_version SET content='{\"tampered\":true}' WHERE id=$1", [versionId])).rejects.toThrow("Immutable revision");

    // Course detail records version + approval for the instructor.
    const detail = await getCourseDetail(instructor.identity, courseId);
    expect(detail.versions).toHaveLength(1);
    expect(detail.versions[0]).toMatchObject({ version: 1, approved: true });
    expect(detail.versions[0].approval?.approverName).toBe("Synthetic epic5-owner");

    // The course summary reports the published state.
    const summary = await listInstructorCourses(instructor.identity);
    expect(summary.courses[0]).toMatchObject({ courseId, currentVersion: 1, approvedVersion: 1, pendingDraft: false, enrolledCount: 0 });
  });

  it("enrolls one verified learner through preview/confirm with exactly one receipt and one row; unmatched rows commit nothing", async () => {
    const instructor = await actor("epic5-enroll-owner", "instructor");
    const learner = await actor("epic5-enrolled", "learner");
    const stranger = await actor("epic5-stranger", "learner");
    const courseId = (await createCourse(instructor.identity, { ...command(), title: "Enrollment tracer course" })).courseId;
    await saveDraft(instructor.identity, { ...command(0), courseId, lesson: LESSON });
    const versionId = (await getApprovals(instructor.identity)).pending[0].versionId;
    await approveVersion(instructor.identity, { ...command(0), courseId, versionId });

    // Preview: matched verified account, zero writes, roster never exposed.
    const preview = await previewEnrollment(instructor.identity, courseId, { schemaVersion: 1, name: "Enrolled Synthetic", email: learner.credentials.email });
    expect(preview).toMatchObject({ matched: true, alreadyEnrolled: false, accountName: "Synthetic epic5-enrolled" });
    expect((await database().query("SELECT count(*)::int AS count FROM app.instructor_enrollment WHERE course_id=$1", [courseId])).rows[0].count).toBe(0);

    // Unmatched preview: an unknown email (or one without a provisioned
    // principal row) is honest and commits nothing.
    const unmatched = await previewEnrollment(instructor.identity, courseId, { schemaVersion: 1, name: "Nobody", email: "nobody@synthetic.invalid" });
    expect(unmatched.matched).toBe(false);

    // Confirm: one enrollment row + receipt.
    const enrollCommand = command(0);
    const enrolled = await confirmEnrollment(instructor.identity, { ...enrollCommand, courseId, name: "Enrolled Synthetic", email: learner.credentials.email });
    expect(enrolled).toMatchObject({ courseId, state: "enrolled" });
    const enrollmentId = enrolled.enrollmentId!;
    expect((await database().query("SELECT count(*)::int AS count FROM app.instructor_enrollment WHERE course_id=$1", [courseId])).rows[0].count).toBe(1);

    // Duplicate enroll command (same key): the identical receipt, still one row.
    const replayedEnroll = await confirmEnrollment(instructor.identity, { ...enrollCommand, courseId, name: "Enrolled Synthetic", email: learner.credentials.email });
    expect(replayedEnroll).toEqual(enrolled);
    // A FRESH command for the same learner: honest already-enrolled, no duplicate.
    const again = await confirmEnrollment(instructor.identity, { ...command(0), courseId, name: "Enrolled Synthetic", email: learner.credentials.email });
    expect(again).toMatchObject({ enrollmentId, state: "already-enrolled" });
    expect((await database().query("SELECT count(*)::int AS count FROM app.instructor_enrollment WHERE course_id=$1", [courseId])).rows[0].count).toBe(1);

    // Confirming an unmatched row is rejected before any commit.
    await expect(confirmEnrollment(instructor.identity, { ...command(0), courseId, name: "Nobody", email: "nobody@synthetic.invalid" })).rejects.toThrow("Check the input.");
    expect((await database().query("SELECT count(*)::int AS count FROM app.instructor_enrollment WHERE course_id=$1", [courseId])).rows[0].count).toBe(1);

    // The enrolled learner studies the APPROVED lesson; a non-enrolled
    // learner gets the identical no-existence-leak denial.
    const study = await learnerCourse(learner.identity, courseId);
    expect(study).toMatchObject({ state: "ready", courseId, version: 1 });
    if (study.state === "ready") {
      expect(study.lesson.title).toBe(LESSON.title);
      expect(study.lesson.sections[0].text).toBe(LESSON.sections[0].text);
      expect(study.item).toMatchObject({ id: "lesson:1:reading", required: true });
    }
    await deniedBy(stranger.identity, courseId);
  });

  it("serves learners ONLY the approved version — a later draft is invisible; pre-approval the state is honest", async () => {
    const instructor = await actor("epic5-visibility-owner", "instructor");
    const learner = await actor("epic5-visibility-learner", "learner");
    const courseId = (await createCourse(instructor.identity, { ...command(), title: "Visibility tracer course" })).courseId;

    // Enrolled before any approval: the honest pending state, no content.
    await saveDraft(instructor.identity, { ...command(0), courseId, lesson: LESSON });
    const draftVersionId = (await getApprovals(instructor.identity)).pending[0].versionId;
    // Enrollment needs no approved version (the roster action is independent).
    await confirmEnrollment(instructor.identity, { ...command(0), courseId, name: "Visibility Learner", email: learner.credentials.email });
    const pendingView = await learnerCourse(learner.identity, courseId);
    expect(pendingView).toMatchObject({ state: "pending-approval", courseId, title: "Visibility tracer course" });
    const pendingIndex = await learnerEnrollments(learner.identity);
    expect(pendingIndex.courses[0]).toMatchObject({ courseId, state: "pending-approval" });

    await approveVersion(instructor.identity, { ...command(0), courseId, versionId: draftVersionId });

    // A SECOND draft (v2) exists while v1 stays the only approved version.
    const draftV2 = { title: "Second draft lesson", sections: [{ text: "Unapproved second-version text that no learner may ever see." }] };
    await saveDraft(instructor.identity, { ...command(1), courseId, lesson: draftV2 });

    const view = await learnerCourse(learner.identity, courseId);
    if (view.state !== "ready") throw new Error("expected ready view");
    expect(view.version).toBe(1);
    expect(view.lesson.title).toBe(LESSON.title);
    const serialized = JSON.stringify(view);
    expect(serialized).not.toContain(draftV2.sections[0].text);
    expect(serialized).not.toContain("Second draft lesson");
    const index = await learnerEnrollments(learner.identity);
    expect(index.courses[0]).toMatchObject({ courseId, state: "ready", version: 1, lessonTitle: LESSON.title });

    // A concurrent second draft conflicts (one pending draft at a time).
    await expect(saveDraft(instructor.identity, { ...command(2), courseId, lesson: draftV2 })).rejects.toThrow("The saved revision changed.");
    // A stale expectedRevision conflicts honestly.
    await expect(saveDraft(instructor.identity, { ...command(0), courseId, lesson: LESSON })).rejects.toThrow("The saved revision changed.");
  });

  it("denies every non-owner and wrong role identically, and never leaks existence", async () => {
    const owner = await actor("epic5-fence-owner", "instructor");
    const secondInstructor = await actor("epic5-fence-second", "instructor");
    const admin = await actor("epic5-fence-admin", "admin");
    const learner = await actor("epic5-fence-learner", "learner");
    const stranger = await actor("epic5-fence-stranger", "learner");
    const courseId = (await createCourse(owner.identity, { ...command(), title: "Fence tracer course" })).courseId;
    const draft = await saveDraft(owner.identity, { ...command(0), courseId, lesson: LESSON });
    await approveVersion(owner.identity, { ...command(0), courseId, versionId: draft.versionId! });
    await confirmEnrollment(owner.identity, { ...command(0), courseId, name: "Fence Learner", email: learner.credentials.email });

    // Learner course access: identical denial for the non-enrolled learner,
    // the second instructor, the ordinary admin AND a missing course.
    const missingId = crypto.randomUUID();
    await deniedBy(stranger.identity, courseId);
    await deniedBy(secondInstructor.identity, courseId);
    await deniedBy(admin.identity, courseId);
    await deniedBy(learner.identity, missingId);

    // Instructor surfaces deny non-instructors and non-owners identically.
    for (const other of [secondInstructor.identity, admin.identity, learner.identity]) {
      await expect(listInstructorCourses(other)).rejects.toThrow("This item is unavailable.");
      await expect(getCourseDetail(other, courseId)).rejects.toThrow("This item is unavailable.");
      await expect(getApprovals(other)).rejects.toThrow("This item is unavailable.");
      await expect(saveDraft(other, { ...command(0), courseId, lesson: LESSON })).rejects.toThrow("This item is unavailable.");
      await expect(approveVersion(other, { ...command(0), courseId, versionId: draft.versionId! })).rejects.toThrow("This item is unavailable.");
      await expect(previewEnrollment(other, courseId, { schemaVersion: 1, name: "X", email: learner.credentials.email })).rejects.toThrow("This item is unavailable.");
      await expect(confirmEnrollment(other, { ...command(0), courseId, name: "X", email: learner.credentials.email })).rejects.toThrow("This item is unavailable.");
    }
    // Admin is NOT an instructor: the instructor studio stays closed to it,
    // while the admin's own enrolled index is simply empty (no leak).
    expect((await learnerEnrollments(admin.identity)).courses).toEqual([]);
  });

  it("registers the tracer's records in the epic-1 lifecycle inventory", async () => {
    const instructor = await actor("epic5-inventory-owner", "instructor");
    const learner = await actor("epic5-inventory-learner", "learner");
    const courseId = (await createCourse(instructor.identity, { ...command(), title: "Inventory tracer course" })).courseId;
    const draft = await saveDraft(instructor.identity, { ...command(0), courseId, lesson: LESSON });
    await approveVersion(instructor.identity, { ...command(0), courseId, versionId: draft.versionId! });
    await confirmEnrollment(instructor.identity, { ...command(0), courseId, name: "Inventory Learner", email: learner.credentials.email });

    const ownerPreview = (await personalRemoval(instructor.identity, { schemaVersion: 1, preview: true })) as DependencyPreview;
    const ownerCategories = Object.fromEntries(ownerPreview.categories.map(category => [category.key, category.count]));
    expect(ownerCategories["instructor-courses"]).toBe(1);
    expect(ownerCategories["instructor-approvals"]).toBe(1);

    const learnerPreview = (await personalRemoval(learner.identity, { schemaVersion: 1, preview: true })) as DependencyPreview;
    const learnerCategories = Object.fromEntries(learnerPreview.categories.map(category => [category.key, category.count]));
    expect(learnerCategories["instructor-enrollments"]).toBe(1);
    // A personal-scope preview never counts another person's records.
    expect(learnerCategories["instructor-courses"]).toBeUndefined();
    expect(ownerCategories["instructor-enrollments"]).toBeUndefined();
  });

  it("keeps every recorded fact durable across a fresh transaction set (restart survival at the data layer)", async () => {
    const instructor = await actor("epic5-restart-owner", "instructor");
    const learner = await actor("epic5-restart-learner", "learner");
    const courseId = (await createCourse(instructor.identity, { ...command(), title: "Restart tracer course" })).courseId;
    const draft = await saveDraft(instructor.identity, { ...command(0), courseId, lesson: LESSON });
    const approval = await approveVersion(instructor.identity, { ...command(0), courseId, versionId: draft.versionId! });
    await confirmEnrollment(instructor.identity, { ...command(0), courseId, name: "Restart Learner", email: learner.credentials.email });

    // New service calls = fresh transactions: everything committed survives
    // and serves identically (the real process restart is the restart smoke).
    const detail = await getCourseDetail(instructor.identity, courseId);
    expect(detail.versions[0].approval?.approvedAt).toHaveLength(24);
    expect(approval.state).toBe("approved");
    const study = await learnerCourse(learner.identity, courseId);
    expect(study.state).toBe("ready");
    const approvals = await getApprovals(instructor.identity);
    expect(approvals.approved[0]).toMatchObject({ courseId, version: 1 });
    expect(approvals.pending).toEqual([]);
  });
});
