import type { PoolClient } from "pg";
import type { AttemptAnswer, AttemptSnapshot } from "../../contracts/assessment";

// Module-owned rows for the epic-3 assessment tracer. Write ownership: ONLY
// this module writes app.test_attempt (migration 021). Epic-1/2 state is read
// through their exported surfaces (getCourse) and fenced through the shared
// lifecycle helpers — never written here; there are deliberately no queue,
// processor-configuration or award writes anywhere in this module.

export type AttemptRow = {
  id: string;
  root_id: string;
  owner_id: string;
  course_id: string;
  course_version: number;
  plan_revision_id: string;
  status: "active" | "graded";
  snapshot: AttemptSnapshot;
  answers: AttemptAnswer[] | null;
  earned_points: number | null;
  total_points: number | null;
  passed: boolean | null;
  created_at: Date;
  graded_at: Date | null;
};

const columns =
  "id,root_id,owner_id,course_id,course_version,plan_revision_id,status,snapshot,answers,earned_points,total_points,passed,created_at,graded_at";

// Insert one open attempt. The partial UNIQUE index (owner_id, root_id)
// WHERE status='active' makes "one open attempt" structural: a raced second
// start is a no-op (false) and the caller returns the winner's row.
export async function insertAttempt(
  client: PoolClient,
  row: { id: string; rootId: string; ownerId: string; courseId: string; courseVersion: number; planRevisionId: string; snapshot: AttemptSnapshot },
): Promise<boolean> {
  const inserted = await client.query(
    `INSERT INTO app.test_attempt(id,root_id,owner_id,course_id,course_version,plan_revision_id,status,snapshot)
     VALUES($1,$2,$3,$4,$5,$6,'active',$7)
     ON CONFLICT (owner_id,root_id) WHERE status='active' DO NOTHING`,
    [row.id, row.rootId, row.ownerId, row.courseId, row.courseVersion, row.planRevisionId, row.snapshot],
  );
  return inserted.rowCount === 1;
}

export async function attemptById(client: PoolClient, ownerId: string, attemptId: string): Promise<AttemptRow | null> {
  const result = await client.query<AttemptRow>(
    `SELECT ${columns} FROM app.test_attempt WHERE id=$1 AND owner_id=$2`,
    [attemptId, ownerId],
  );
  return result.rows[0] ?? null;
}

// The one open attempt of an owner and root, if any.
export async function openAttempt(client: PoolClient, ownerId: string, rootId: string): Promise<AttemptRow | null> {
  const result = await client.query<AttemptRow>(
    `SELECT ${columns} FROM app.test_attempt WHERE owner_id=$1 AND root_id=$2 AND status='active' LIMIT 1`,
    [ownerId, rootId],
  );
  return result.rows[0] ?? null;
}

// Every attempt of an owner and root, newest first — the history that is
// listed, never overwritten (D3).
export async function attemptsForRoot(client: PoolClient, ownerId: string, rootId: string): Promise<AttemptRow[]> {
  const result = await client.query<AttemptRow>(
    `SELECT ${columns} FROM app.test_attempt WHERE owner_id=$1 AND root_id=$2 ORDER BY created_at DESC, id DESC`,
    [ownerId, rootId],
  );
  return result.rows;
}

// Status-guarded terminal grade transition (the claimReady pattern): the
// single UPDATE lands the whole graded state atomically — answers, unrounded
// integer points, pass flag and timestamp — or nothing (a raced duplicate
// delivery sees no row). An attempt is submitted exactly once; a graded row
// never changes again.
export async function gradeAttempt(
  client: PoolClient,
  attemptId: string,
  graded: { answers: AttemptAnswer[]; earned: number; total: number; passed: boolean },
): Promise<string | null> {
  const result = await client.query<{ id: string }>(
    `UPDATE app.test_attempt
     SET status='graded',answers=$2,earned_points=$3,total_points=$4,passed=$5,graded_at=clock_timestamp()
     WHERE id=$1 AND status='active' RETURNING id`,
    // The jsonb answers column takes the JSON text form explicitly — node-pg
    // would otherwise serialize a JS array as a Postgres array literal.
    [attemptId, JSON.stringify(graded.answers), graded.earned, graded.total, graded.passed],
  );
  return result.rows[0]?.id ?? null;
}
