import type { PoolClient } from "pg";
import type { AnyAttemptSnapshot, AttemptAnswer, ParentManifest, RetestSnapshot } from "../../contracts/assessment";

// Module-owned rows for the epic-3 assessment tracer and its targeted
// recovery (story 2). Write ownership: ONLY this module writes
// app.test_attempt (migration 021), app.retest_attempt and app.recovery_target
// (migration 022). Epic-1/2 state is read through their exported surfaces
// (getCourse) and fenced through the shared lifecycle helpers — never written
// here; there are deliberately no queue or processor-configuration writes
// anywhere in this module.
//
// Story 3 changed NO stored shape: the snapshot jsonb carries the new fields
// (pointsScale, passMarkOverride, per-item partialCredit) additively inside
// the immutable at-start pin, and the earned/total integer columns already
// hold scaled-integer values — so no migration exists for 3.3 and 021/022's
// CHECKs are untouched. An attempt row's snapshot is the served full-credit
// root build OR the partial-credit fixture build (AnyAttemptSnapshot); both
// share the core shape the grading path reads.
//
// Story 4 (migration 023) adds the MONOTONIC award layer under the same
// ownership: app.completion_award (mini-course award rows INSERTED ONCE per
// (owner, course release) — never updated or deleted by policy — plus
// parent-path manifest carriers whose single status-guarded transition sets
// awarded_at) and app.studied_release (the explicit version-switch pointer,
// the switch verb's only mutable state). Epic-2 tracker evidence is consumed
// READ-ONLY through course-generation's scoped repository reads.

export type AttemptRow = {
  id: string;
  root_id: string;
  owner_id: string;
  course_id: string;
  course_version: number;
  plan_revision_id: string;
  status: "active" | "graded";
  snapshot: AnyAttemptSnapshot;
  answers: AttemptAnswer[] | null;
  earned_points: number | null;
  total_points: number | null;
  passed: boolean | null;
  created_at: Date;
  graded_at: Date | null;
};

// One failed objective group of one root attempt: ledgered OPEN in the same
// transaction as the failed grade, with the group's initial result computed
// under that attempt's own snapshot; the status-guarded clear records which
// retest cleared it and when.
export type RecoveryTargetRow = {
  id: string;
  root_attempt_id: string;
  owner_id: string;
  root_id: string;
  course_id: string;
  course_version: number;
  objective_index: number;
  objective: string;
  initial_earned: number;
  initial_total: number;
  status: "open" | "cleared";
  cleared_by: string | null;
  cleared_at: Date | null;
  created_at: Date;
};

// A fresh same-demand retest: mirrors the ordinary attempt row shape but
// grades PER OBJECTIVE GROUP (no overall earned/total/pass — group_results
// jsonb carries { objectiveIndex, earned, total, cleared } per declared
// target), pins the ROOT attempt's course/version/plan revision (recovery
// stays pinned to the root attempt's course version through the chain) and
// declares its non-empty subset of open targets.
export type StoredGroupResult = { objectiveIndex: number; earned: number; total: number; cleared: boolean };
export type RetestRow = {
  id: string;
  root_attempt_id: string;
  root_id: string;
  owner_id: string;
  course_id: string;
  course_version: number;
  plan_revision_id: string;
  status: "active" | "graded";
  target_objective_indexes: number[];
  snapshot: RetestSnapshot;
  answers: AttemptAnswer[] | null;
  group_results: StoredGroupResult[] | null;
  created_at: Date;
  graded_at: Date | null;
};

const attemptColumns =
  "id,root_id,owner_id,course_id,course_version,plan_revision_id,status,snapshot,answers,earned_points,total_points,passed,created_at,graded_at";
const targetColumns =
  "id,root_attempt_id,owner_id,root_id,course_id,course_version,objective_index,objective,initial_earned,initial_total,status,cleared_by,cleared_at,created_at";
const retestColumns =
  "id,root_attempt_id,root_id,owner_id,course_id,course_version,plan_revision_id,status,target_objective_indexes,snapshot,answers,group_results,created_at,graded_at";

// Insert one open attempt. The partial UNIQUE index (owner_id, root_id)
// WHERE status='active' makes "one open attempt" structural: a raced second
// start is a no-op (false) and the caller returns the winner's row.
export async function insertAttempt(
  client: PoolClient,
  row: { id: string; rootId: string; ownerId: string; courseId: string; courseVersion: number; planRevisionId: string; snapshot: AnyAttemptSnapshot },
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
    `SELECT ${attemptColumns} FROM app.test_attempt WHERE id=$1 AND owner_id=$2`,
    [attemptId, ownerId],
  );
  return result.rows[0] ?? null;
}

// The one open attempt of an owner and root, if any.
export async function openAttempt(client: PoolClient, ownerId: string, rootId: string): Promise<AttemptRow | null> {
  const result = await client.query<AttemptRow>(
    `SELECT ${attemptColumns} FROM app.test_attempt WHERE owner_id=$1 AND root_id=$2 AND status='active' LIMIT 1`,
    [ownerId, rootId],
  );
  return result.rows[0] ?? null;
}

// Every attempt of an owner and root, newest first — the history that is
// listed, never overwritten (D3).
export async function attemptsForRoot(client: PoolClient, ownerId: string, rootId: string): Promise<AttemptRow[]> {
  const result = await client.query<AttemptRow>(
    `SELECT ${attemptColumns} FROM app.test_attempt WHERE owner_id=$1 AND root_id=$2 ORDER BY created_at DESC, id DESC`,
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

// ---------------------------------------------------------------------------
// Story 2 — targeted recovery ledger (app.recovery_target, migration 022).
// ---------------------------------------------------------------------------

// Ledger every FAILED objective group OPEN, in the same transaction as the
// failed grade that computed the groups (the caller holds the just-claimed
// grade, so no prior ledger can exist; UNIQUE (root_attempt_id,
// objective_index) keeps one row per group per root attempt). Passing groups
// are simply never inserted — preserved and never re-tested (AD-8/D3).
export async function insertTargets(
  client: PoolClient,
  rows: Array<{
    rootAttemptId: string;
    ownerId: string;
    rootId: string;
    courseId: string;
    courseVersion: number;
    objectiveIndex: number;
    objective: string;
    initialEarned: number;
    initialTotal: number;
  }>,
): Promise<void> {
  for (const row of rows) {
    await client.query(
      `INSERT INTO app.recovery_target(id,root_attempt_id,owner_id,root_id,course_id,course_version,objective_index,objective,initial_earned,initial_total)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [crypto.randomUUID(), row.rootAttemptId, row.ownerId, row.rootId, row.courseId, row.courseVersion, row.objectiveIndex, row.objective, row.initialEarned, row.initialTotal],
    );
  }
}

// Every ledger row of an owner and root (all chains — group by
// root_attempt_id at the caller), oldest attempt's rows first for stable
// serving.
export async function targetsForRoot(client: PoolClient, ownerId: string, rootId: string): Promise<RecoveryTargetRow[]> {
  const result = await client.query<RecoveryTargetRow>(
    `SELECT ${targetColumns} FROM app.recovery_target WHERE owner_id=$1 AND root_id=$2 ORDER BY created_at, objective_index`,
    [ownerId, rootId],
  );
  return result.rows;
}

// The one ledger of a root attempt, objective-index order.
export async function targetsForAttempt(client: PoolClient, ownerId: string, rootAttemptId: string): Promise<RecoveryTargetRow[]> {
  const result = await client.query<RecoveryTargetRow>(
    `SELECT ${targetColumns} FROM app.recovery_target WHERE owner_id=$1 AND root_attempt_id=$2 ORDER BY objective_index`,
    [ownerId, rootAttemptId],
  );
  return result.rows;
}

// Status-guarded open -> cleared transition, called ONLY inside the clearing
// retest's grade transaction: a raced or repeated clear sees no row and the
// ledger never regresses. Returns the cleared row's id (null when the guard
// matched nothing).
export async function clearTarget(
  client: PoolClient,
  rootAttemptId: string,
  objectiveIndex: number,
  clearedBy: string,
): Promise<string | null> {
  const result = await client.query<{ id: string }>(
    `UPDATE app.recovery_target
     SET status='cleared',cleared_by=$3,cleared_at=clock_timestamp()
     WHERE root_attempt_id=$1 AND objective_index=$2 AND status='open' RETURNING id`,
    [rootAttemptId, objectiveIndex, clearedBy],
  );
  return result.rows[0]?.id ?? null;
}

// ---------------------------------------------------------------------------
// Story 2 — fresh retests (app.retest_attempt, migration 022).
// ---------------------------------------------------------------------------

// Insert one open retest. The partial UNIQUE index on (root_attempt_id)
// WHERE status='active' makes "one open retest per root attempt" structural:
// a raced second start is a no-op (false) and the caller returns the winner.
export async function insertRetest(
  client: PoolClient,
  row: {
    id: string;
    rootAttemptId: string;
    ownerId: string;
    rootId: string;
    courseId: string;
    courseVersion: number;
    planRevisionId: string;
    targetIndexes: number[];
    snapshot: RetestSnapshot;
  },
): Promise<boolean> {
  const inserted = await client.query(
    `INSERT INTO app.retest_attempt(id,root_attempt_id,root_id,owner_id,course_id,course_version,plan_revision_id,status,target_objective_indexes,snapshot)
     VALUES($1,$2,$3,$4,$5,$6,$7,'active',$8,$9)
     ON CONFLICT (root_attempt_id) WHERE status='active' DO NOTHING`,
    [row.id, row.rootAttemptId, row.rootId, row.ownerId, row.courseId, row.courseVersion, row.planRevisionId, JSON.stringify(row.targetIndexes), row.snapshot],
  );
  return inserted.rowCount === 1;
}

export async function retestById(client: PoolClient, ownerId: string, retestId: string): Promise<RetestRow | null> {
  const result = await client.query<RetestRow>(
    `SELECT ${retestColumns} FROM app.retest_attempt WHERE id=$1 AND owner_id=$2`,
    [retestId, ownerId],
  );
  return result.rows[0] ?? null;
}

// The one open retest of a root attempt, if any.
export async function openRetestForRootAttempt(client: PoolClient, ownerId: string, rootAttemptId: string): Promise<RetestRow | null> {
  const result = await client.query<RetestRow>(
    `SELECT ${retestColumns} FROM app.retest_attempt WHERE owner_id=$1 AND root_attempt_id=$2 AND status='active' LIMIT 1`,
    [ownerId, rootAttemptId],
  );
  return result.rows[0] ?? null;
}

// Every retest of an owner and root, newest first — the recovery history
// that is listed, never overwritten.
export async function retestsForRoot(client: PoolClient, ownerId: string, rootId: string): Promise<RetestRow[]> {
  const result = await client.query<RetestRow>(
    `SELECT ${retestColumns} FROM app.retest_attempt WHERE owner_id=$1 AND root_id=$2 ORDER BY created_at DESC, id DESC`,
    [ownerId, rootId],
  );
  return result.rows;
}

// Status-guarded terminal grade transition (the gradeAttempt pattern): the
// single UPDATE lands the whole graded state atomically — answers, per-group
// results, timestamp — or nothing (a raced duplicate delivery sees no row).
// A retest is submitted exactly once; a graded row never changes again.
export async function gradeRetest(
  client: PoolClient,
  retestId: string,
  graded: { answers: AttemptAnswer[]; groupResults: StoredGroupResult[] },
): Promise<string | null> {
  const result = await client.query<{ id: string }>(
    `UPDATE app.retest_attempt
     SET status='graded',answers=$2,group_results=$3,graded_at=clock_timestamp()
     WHERE id=$1 AND status='active' RETURNING id`,
    [retestId, JSON.stringify(graded.answers), JSON.stringify(graded.groupResults)],
  );
  return result.rows[0]?.id ?? null;
}

// ---------------------------------------------------------------------------
// Story 4 — completion awards, parent manifests and the studied-release
// pointer (migration 023). Awards are MONOTONIC: mini-course rows are
// inserted once and never updated or deleted by any code path; parent rows
// carry their manifest from plant time and take the single status-guarded
// awarded_at transition. No repository function here ever clears, rewrites
// or re-derives an earned award.
// ---------------------------------------------------------------------------

export type AwardRow = {
  id: string;
  owner_id: string;
  root_id: string;
  kind: "mini-course" | "parent-path";
  course_id: string | null;
  course_version: number | null;
  plan_revision_id: string | null;
  manifest_id: string | null;
  manifest: ParentManifest | null;
  awarded_at: Date | null;
  created_at: Date;
};

const awardColumns =
  "id,owner_id,root_id,kind,course_id,course_version,plan_revision_id,manifest_id,manifest,awarded_at,created_at";

// Insert one mini-course award. The UNIQUE (owner_id, course_id, kind)
// constraint makes "awarded exactly once per (owner, course release)"
// structural: a raced or repeated trigger is a no-op (false) and the row
// from the first trigger stands — byte-identical forever after.
export async function insertAward(
  client: PoolClient,
  row: { id: string; ownerId: string; rootId: string; courseId: string; courseVersion: number; planRevisionId: string },
): Promise<boolean> {
  const inserted = await client.query(
    `INSERT INTO app.completion_award(id,owner_id,root_id,kind,course_id,course_version,plan_revision_id,awarded_at)
     VALUES($1,$2,$3,'mini-course',$4,$5,$6,clock_timestamp())
     ON CONFLICT (owner_id, course_id, kind) DO NOTHING`,
    [row.id, row.ownerId, row.rootId, row.courseId, row.courseVersion, row.planRevisionId],
  );
  return inserted.rowCount === 1;
}

// The mini-course award pinning one course release, if any.
export async function awardForCourse(client: PoolClient, ownerId: string, courseId: string): Promise<AwardRow | null> {
  const result = await client.query<AwardRow>(
    `SELECT ${awardColumns} FROM app.completion_award WHERE owner_id=$1 AND course_id=$2 AND kind='mini-course'`,
    [ownerId, courseId],
  );
  return result.rows[0] ?? null;
}

// Which of the given course releases carry a mini-course award (owner-
// scoped) — the parent predicate's awarded-children input.
export async function awardedCourseIds(client: PoolClient, ownerId: string, courseIds: string[]): Promise<string[]> {
  if (!courseIds.length) return [];
  const result = await client.query<{ course_id: string }>(
    `SELECT course_id FROM app.completion_award WHERE owner_id=$1 AND kind='mini-course' AND course_id=ANY($2::uuid[])`,
    [ownerId, courseIds],
  );
  return result.rows.map(row => row.course_id);
}

// Every EARNED award of an owner and root (mini-course and awarded parent
// rows), oldest award first for stable serving — listed, never overwritten.
export async function awardsForRoot(client: PoolClient, ownerId: string, rootId: string): Promise<AwardRow[]> {
  const result = await client.query<AwardRow>(
    `SELECT ${awardColumns} FROM app.completion_award WHERE owner_id=$1 AND root_id=$2 AND awarded_at IS NOT NULL ORDER BY awarded_at, id`,
    [ownerId, rootId],
  );
  return result.rows;
}

// Plant one parent manifest (the "parent award INTENT row"): the pinned
// child releases ride the row from creation and NEVER change — a manifest
// edit is a new manifest identity, never a rewrite. The partial UNIQUE
// (owner_id, manifest_id) makes a repeat plant a no-op (false). Awarded_at
// stays null until every required child release is awarded.
export async function insertParentManifest(
  client: PoolClient,
  row: { id: string; manifestId: string; ownerId: string; rootId: string; manifest: ParentManifest },
): Promise<boolean> {
  const inserted = await client.query(
    `INSERT INTO app.completion_award(id,owner_id,root_id,kind,manifest_id,manifest)
     VALUES($1,$2,$3,'parent-path',$4,$5)
     ON CONFLICT (owner_id, manifest_id) WHERE kind='parent-path' DO NOTHING`,
    [row.id, row.ownerId, row.rootId, row.manifestId, row.manifest],
  );
  return inserted.rowCount === 1;
}

// Every parent manifest row of an owner (any root — a parent path may group
// mini-courses across a personal owner's studies). Pending and awarded rows
// alike: evaluation is idempotent either way.
export async function parentManifestsFor(client: PoolClient, ownerId: string): Promise<AwardRow[]> {
  const result = await client.query<AwardRow>(
    `SELECT ${awardColumns} FROM app.completion_award WHERE owner_id=$1 AND kind='parent-path' ORDER BY created_at, id`,
    [ownerId],
  );
  return result.rows;
}

// The single status-guarded parent transition: sets awarded_at once, on the
// manifest row planted for exactly this award condition. A raced or repeated
// evaluation sees no row (null) and the ledger never regresses; nothing ever
// clears an earned parent award.
export async function awardParent(client: PoolClient, awardId: string): Promise<string | null> {
  const result = await client.query<{ id: string }>(
    `UPDATE app.completion_award SET awarded_at=clock_timestamp()
     WHERE id=$1 AND kind='parent-path' AND awarded_at IS NULL RETURNING id`,
    [awardId],
  );
  return result.rows[0]?.id ?? null;
}

// The explicit studied-release pointer of an owner and root, if a switch
// ever moved it (absent = default latest-ready resolution).
export async function studiedRelease(client: PoolClient, ownerId: string, rootId: string): Promise<{ course_id: string } | null> {
  const result = await client.query<{ course_id: string }>(
    "SELECT course_id FROM app.studied_release WHERE owner_id=$1 AND root_id=$2",
    [ownerId, rootId],
  );
  return result.rows[0] ?? null;
}

// The switch verb's only mutable write: move the pointer to an explicitly
// chosen ready release. An idempotent re-switch to the same release updates
// only switched_at; a purged release cascades the pointer away.
export async function upsertStudiedRelease(
  client: PoolClient,
  row: { id: string; ownerId: string; rootId: string; courseId: string },
): Promise<void> {
  await client.query(
    `INSERT INTO app.studied_release(id,owner_id,root_id,course_id)
     VALUES($1,$2,$3,$4)
     ON CONFLICT (owner_id, root_id) DO UPDATE SET course_id=EXCLUDED.course_id, switched_at=clock_timestamp()`,
    [row.id, row.ownerId, row.rootId, row.courseId],
  );
}
