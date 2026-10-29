import type { PoolClient } from "pg";
import type { Command } from "../../contracts/setup";
import type {
  EnrollmentRecord,
  InstructorCourseSummary,
  VersionSummary,
} from "../../contracts/instructor-courses";
import { fail } from "../../platform/errors";

// Epic-5 entry 1 SQL. Every write path serializes on the course row
// (SELECT ... FOR UPDATE) so concurrent drafts/confirms conflict honestly;
// UNIQUE/PK constraints arbitrate duplicate effects structurally (AD-2).

export type CourseRow = { id: string; owner_id: string; title: string; created_at: Date };

// Instructor-only fence: the caller holds the principal lock from authorize().
export async function ownedCourse(
  client: PoolClient,
  ownerId: string,
  courseId: string,
): Promise<CourseRow> {
  const result = await client.query<CourseRow>(
    "SELECT id,owner_id,title,created_at FROM app.instructor_course WHERE id=$1 AND owner_id=$2 FOR UPDATE",
    [courseId, ownerId],
  );
  if (!result.rows[0]) fail("FORBIDDEN_OR_NOT_FOUND");
  return result.rows[0];
}

export async function listCourses(
  client: PoolClient,
  ownerId: string,
): Promise<InstructorCourseSummary[]> {
  const result = await client.query<{
    id: string;
    title: string;
    created_at: Date;
    current_version: number | null;
    approved_version: number | null;
    enrolled_count: number;
  }>(
    `SELECT c.id,c.title,c.created_at,
      (SELECT max(v.version) FROM app.instructor_course_version v WHERE v.course_id=c.id) AS current_version,
      (SELECT max(v.version) FROM app.instructor_course_version v
         JOIN app.instructor_approval a ON a.version_id=v.id WHERE v.course_id=c.id) AS approved_version,
      (SELECT count(*)::int FROM app.instructor_enrollment e WHERE e.course_id=c.id) AS enrolled_count
     FROM app.instructor_course c WHERE c.owner_id=$1 ORDER BY c.created_at DESC`,
    [ownerId],
  );
  return result.rows.map(row => ({
    courseId: row.id,
    title: row.title,
    createdAt: row.created_at.toISOString(),
    currentVersion: row.current_version,
    approvedVersion: row.approved_version,
    pendingDraft: row.current_version !== null && row.current_version !== row.approved_version,
    enrolledCount: row.enrolled_count,
  }));
}

export type VersionRow = {
  id: string;
  course_id: string;
  version: number;
  content: unknown;
  content_digest: string;
  created_at: Date;
};

export async function versionsOf(
  client: PoolClient,
  courseId: string,
): Promise<Array<VersionRow & { approver_name: string | null; approved_at: Date | null }>> {
  const result = await client.query<{
    id: string;
    course_id: string;
    version: number;
    content: unknown;
    content_digest: string;
    created_at: Date;
    approver_name: string | null;
    approved_at: Date | null;
  }>(
    `SELECT v.id,v.course_id,v.version,v.content,v.content_digest,v.created_at,u.name AS approver_name,a.approved_at
     FROM app.instructor_course_version v
     LEFT JOIN app.instructor_approval a ON a.version_id=v.id
     LEFT JOIN auth."user" u ON u.id=a.approver_id
     WHERE v.course_id=$1 ORDER BY v.version DESC`,
    [courseId],
  );
  return result.rows;
}

export function versionSummary(
  row: VersionRow & { approver_name: string | null; approved_at: Date | null },
): VersionSummary {
  return {
    versionId: row.id,
    version: row.version,
    createdAt: row.created_at.toISOString(),
    digest: row.content_digest,
    approved: row.approved_at !== null,
    approval:
      row.approved_at !== null
        ? { approverName: row.approver_name ?? "", approvedAt: row.approved_at.toISOString() }
        : null,
  };
}

export async function enrollmentsOf(
  client: PoolClient,
  courseId: string,
): Promise<EnrollmentRecord[]> {
  const result = await client.query<{
    id: string;
    invited_name: string;
    invited_email: string;
    enrolled_at: Date;
  }>(
    "SELECT id,invited_name,invited_email,enrolled_at FROM app.instructor_enrollment WHERE course_id=$1 ORDER BY enrolled_at",
    [courseId],
  );
  return result.rows.map(row => ({
    enrollmentId: row.id,
    name: row.invited_name,
    email: row.invited_email,
    enrolledAt: row.enrolled_at.toISOString(),
  }));
}

export async function versionById(
  client: PoolClient,
  courseId: string,
  versionId: string,
): Promise<VersionRow | null> {
  const result = await client.query<VersionRow>(
    "SELECT id,course_id,version,content,content_digest,created_at FROM app.instructor_course_version WHERE id=$1 AND course_id=$2",
    [versionId, courseId],
  );
  return result.rows[0] ?? null;
}

export async function approvalOf(
  client: PoolClient,
  versionId: string,
): Promise<{ id: string; approver_id: string; version_digest: string; approved_at: Date } | null> {
  const result = await client.query<{
    id: string;
    approver_id: string;
    version_digest: string;
    approved_at: Date;
  }>(
    "SELECT id,approver_id,version_digest,approved_at FROM app.instructor_approval WHERE version_id=$1",
    [versionId],
  );
  return result.rows[0] ?? null;
}

export async function insertApproval(
  client: PoolClient,
  versionId: string,
  approverId: string,
  digest: string,
): Promise<string> {
  const id = crypto.randomUUID();
  await client.query(
    "INSERT INTO app.instructor_approval(id,version_id,approver_id,version_digest) VALUES($1,$2,$3,$4)",
    [id, versionId, approverId, digest],
  );
  return id;
}

export async function versionCount(client: PoolClient, courseId: string): Promise<number> {
  const result = await client.query<{ count: number }>(
    "SELECT count(*)::int AS count FROM app.instructor_course_version WHERE course_id=$1",
    [courseId],
  );
  return result.rows[0].count;
}

export async function hasPendingDraft(client: PoolClient, courseId: string): Promise<boolean> {
  const result = await client.query<{ exists: boolean }>(
    `SELECT EXISTS(
      SELECT 1 FROM app.instructor_course_version v WHERE v.course_id=$1
        AND NOT EXISTS(SELECT 1 FROM app.instructor_approval a WHERE a.version_id=v.id)) AS exists`,
    [courseId],
  );
  return result.rows[0].exists;
}

export async function insertVersion(
  client: PoolClient,
  courseId: string,
  version: number,
  content: unknown,
  digest: string,
): Promise<string> {
  const id = crypto.randomUUID();
  await client.query(
    "INSERT INTO app.instructor_course_version(id,course_id,version,content,content_digest) VALUES($1,$2,$3,$4,$5)",
    [id, courseId, version, JSON.stringify(content), digest],
  );
  return id;
}

// The verified-account match (AD-14): association happens ONLY here, server-
// side. In this local system — no email surface exists and accounts are
// operator-provisioned — an identity_principal row IS the verified-account
// marker (better-auth signUpEmail leaves emailVerified false). Recorded as the
// revisit point when entry 4 builds real invitation mechanics.
export async function provisionedAccountByEmail(
  client: PoolClient,
  email: string,
): Promise<{ userId: string; name: string } | null> {
  const result = await client.query<{ id: string; name: string }>(
    `SELECT u.id,u.name FROM auth."user" u
     JOIN app.identity_principal p ON p.user_id=u.id
     WHERE lower(u.email)=$1 LIMIT 1`,
    [email],
  );
  return result.rows[0] ? { userId: result.rows[0].id, name: result.rows[0].name } : null;
}

export async function enrollmentFor(
  client: PoolClient,
  courseId: string,
  learnerId: string,
): Promise<string | null> {
  const result = await client.query<{ id: string }>(
    "SELECT id FROM app.instructor_enrollment WHERE course_id=$1 AND learner_id=$2",
    [courseId, learnerId],
  );
  return result.rows[0]?.id ?? null;
}

export async function insertEnrollment(
  client: PoolClient,
  courseId: string,
  learnerId: string,
  name: string,
  email: string,
): Promise<string> {
  const id = crypto.randomUUID();
  await client.query(
    "INSERT INTO app.instructor_enrollment(id,course_id,learner_id,invited_name,invited_email) VALUES($1,$2,$3,$4,$5)",
    [id, courseId, learnerId, name, email],
  );
  return id;
}

// ── approval inspector reads ────────────────────────────────────────────────

export type PendingRow = {
  versionId: string;
  version: number;
  digest: string;
  createdAt: Date;
  content: unknown;
  courseId: string;
  courseTitle: string;
};
export type ApprovedRow = {
  versionId: string;
  version: number;
  digest: string;
  approvedAt: Date;
  approverName: string;
  courseId: string;
  courseTitle: string;
};

// Raw inspector rows; the service validates stored content (storedManualContent)
// and derives the required item — never trusting raw jsonb to be a view.
export async function pendingRows(
  client: PoolClient,
  ownerId: string,
): Promise<PendingRow[]> {
  const result = await client.query<{
    version_id: string;
    version: number;
    content_digest: string;
    created_at: Date;
    content: unknown;
    course_id: string;
    course_title: string;
  }>(
    `SELECT v.id AS version_id,v.version,v.content_digest,v.created_at,v.content,c.id AS course_id,c.title AS course_title
     FROM app.instructor_course_version v
     JOIN app.instructor_course c ON c.id=v.course_id
     WHERE c.owner_id=$1 AND NOT EXISTS(SELECT 1 FROM app.instructor_approval a WHERE a.version_id=v.id)
     ORDER BY v.created_at`,
    [ownerId],
  );
  return result.rows.map(row => ({
    versionId: row.version_id,
    version: row.version,
    digest: row.content_digest,
    createdAt: row.created_at,
    content: row.content,
    courseId: row.course_id,
    courseTitle: row.course_title,
  }));
}

export async function approvedRows(
  client: PoolClient,
  ownerId: string,
): Promise<ApprovedRow[]> {
  const result = await client.query<{
    version_id: string;
    version: number;
    digest: string;
    approved_at: Date;
    approver_name: string | null;
    course_id: string;
    course_title: string;
  }>(
    `SELECT v.id AS version_id,v.version,a.version_digest AS digest,a.approved_at,u.name AS approver_name,c.id AS course_id,c.title AS course_title
     FROM app.instructor_approval a
     JOIN app.instructor_course_version v ON v.id=a.version_id
     JOIN app.instructor_course c ON c.id=v.course_id
     LEFT JOIN auth."user" u ON u.id=a.approver_id
     WHERE c.owner_id=$1 ORDER BY a.approved_at DESC`,
    [ownerId],
  );
  return result.rows.map(row => ({
    versionId: row.version_id,
    version: row.version,
    digest: row.digest,
    approvedAt: row.approved_at,
    approverName: row.approver_name ?? "",
    courseId: row.course_id,
    courseTitle: row.course_title,
  }));
}

// ── learner-shell reads ─────────────────────────────────────────────────────

export async function enrollmentExists(
  client: PoolClient,
  courseId: string,
  learnerId: string,
): Promise<boolean> {
  const result = await client.query<{ exists: boolean }>(
    "SELECT EXISTS(SELECT 1 FROM app.instructor_enrollment WHERE course_id=$1 AND learner_id=$2) AS exists",
    [courseId, learnerId],
  );
  return result.rows[0].exists;
}

// The latest APPROVED version of one course (content included), or null when
// no approved version exists. Drafts and superseded versions are never read on
// the learner path.
export async function latestApprovedVersion(
  client: PoolClient,
  courseId: string,
): Promise<(VersionRow & { approved_at: Date; title: string }) | null> {
  const result = await client.query<
    VersionRow & { approved_at: Date; title: string }
  >(
    `SELECT v.id,v.course_id,v.version,v.content,v.content_digest,v.created_at,a.approved_at,c.title
     FROM app.instructor_course_version v
     JOIN app.instructor_approval a ON a.version_id=v.id
     JOIN app.instructor_course c ON c.id=v.course_id
     WHERE v.course_id=$1 ORDER BY v.version DESC LIMIT 1`,
    [courseId],
  );
  return result.rows[0] ?? null;
}

export async function enrolledCourses(
  client: PoolClient,
  learnerId: string,
): Promise<
  Array<{
    courseId: string;
    title: string;
    version: number | null;
    approvedAt: Date | null;
    lessonTitle: string | null;
  }>
> {
  const result = await client.query<{
    course_id: string;
    title: string;
    version: number | null;
    approved_at: Date | null;
    lesson_title: string | null;
  }>(
    `SELECT e.course_id,c.title,
       (SELECT max(v.version) FROM app.instructor_course_version v
          JOIN app.instructor_approval a ON a.version_id=v.id WHERE v.course_id=e.course_id) AS version,
       (SELECT a.approved_at FROM app.instructor_course_version v
          JOIN app.instructor_approval a ON a.version_id=v.id WHERE v.course_id=e.course_id
          ORDER BY v.version DESC LIMIT 1) AS approved_at,
       (SELECT v.content->'lesson'->>'title' FROM app.instructor_course_version v
          JOIN app.instructor_approval a ON a.version_id=v.id WHERE v.course_id=e.course_id
          ORDER BY v.version DESC LIMIT 1) AS lesson_title
     FROM app.instructor_enrollment e JOIN app.instructor_course c ON c.id=e.course_id
     WHERE e.learner_id=$1 ORDER BY e.enrolled_at`,
    [learnerId],
  );
  return result.rows.map(row => ({
    courseId: row.course_id,
    title: row.title,
    version: row.version,
    approvedAt: row.approved_at,
    lessonTitle: row.lesson_title,
  }));
}

// ── command receipts (course-anchored, the command_receipt shape) ──────────

export async function replay<T>(
  client: PoolClient,
  ownerId: string,
  command: Command,
  action: string,
  hash: string,
): Promise<T | undefined> {
  const found = await client.query<{
    action: string;
    request_hash: string;
    result: T;
    course_id: string;
  }>(
    "SELECT action,request_hash,result,course_id FROM app.instructor_command_receipt WHERE owner_id=$1 AND command_key=$2",
    [ownerId, command.commandKey],
  );
  if (!found.rows[0]) return;
  if (found.rows[0].action !== action || found.rows[0].request_hash !== hash)
    fail("CONFLICT");
  // The receipt's course must still belong to the caller (no course deletion
  // exists in this tracer, but the fence is cheap and honest).
  const owned = await client.query<{ exists: boolean }>(
    "SELECT EXISTS(SELECT 1 FROM app.instructor_course WHERE id=$1 AND owner_id=$2) AS exists",
    [found.rows[0].course_id, ownerId],
  );
  if (!owned.rows[0].exists) fail("FORBIDDEN_OR_NOT_FOUND");
  return found.rows[0].result;
}

export async function receipt<T>(
  client: PoolClient,
  ownerId: string,
  command: Command,
  action: string,
  hash: string,
  courseId: string,
  result: T,
): Promise<T> {
  await client.query(
    "INSERT INTO app.instructor_command_receipt(owner_id,command_key,action,request_hash,course_id,result) VALUES($1,$2,$3,$4,$5,$6)",
    [ownerId, command.commandKey, action, hash, courseId, JSON.stringify(result)],
  );
  return result;
}
