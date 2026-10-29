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

// ---------------------------------------------------------------------------
// Story 5 — the one-way unclear-item flag. Attempt/retest rows are immutable
// (AD-5), so unlike the diagnostic's in-row markUnclear the flag lives in its
// own insert-once table: one row per (owner, graded container item), never
// updated, never unset — recording WITH the evidence while changing no
// outcome. attempt_id is the graded ordinary attempt (for a retest flag, the
// retest's own root attempt); retest_id is null except on retest-item flags.
// ---------------------------------------------------------------------------

export type FlagRow = {
  id: string;
  root_id: string;
  owner_id: string;
  attempt_id: string;
  retest_id: string | null;
  position: number;
  flagged_at: Date;
};

// Insert one flag. The partial UNIQUE indexes (owner, attempt, position)
// WHERE retest_id IS NULL and (owner, retest, position) WHERE retest_id IS
// NOT NULL make "one flag per graded container item" structural: a raced or
// repeated flag (replay miss, new commandKey) inserts nothing (false) and the
// first row stands forever.
export async function insertFlag(
  client: PoolClient,
  row: { id: string; ownerId: string; rootId: string; attemptId: string; retestId: string | null; position: number },
): Promise<boolean> {
  const inserted = await client.query(
    `INSERT INTO app.assessment_flag(id,root_id,owner_id,attempt_id,retest_id,position,flagged_at)
     VALUES($1,$2,$3,$4,$5,$6,clock_timestamp())
     ON CONFLICT DO NOTHING`,
    [row.id, row.rootId, row.ownerId, row.attemptId, row.retestId, row.position],
  );
  return inserted.rowCount === 1;
}

// Every flag of an owner and root, oldest first for stable serving.
export async function flagsForRoot(client: PoolClient, ownerId: string, rootId: string): Promise<FlagRow[]> {
  const result = await client.query<FlagRow>(
    "SELECT id,root_id,owner_id,attempt_id,retest_id,position,flagged_at FROM app.assessment_flag WHERE owner_id=$1 AND root_id=$2 ORDER BY flagged_at,id",
    [ownerId, rootId],
  );
  return result.rows;
}

// ---------------------------------------------------------------------------
// Story 6 — the whole-mini-course roadmap READ MODEL (owner-scoped batch
// reads; the roadmap.ts derivation is pure over these facts and this module
// gains NO write anywhere). Every query below is owner_id-scoped exactly like
// the per-root reads above; the bounds mirror listStudies (at most 100
// confirmed studies). Epic-1/2 state (plan revisions, study batches, course
// rows, tracker item states) is consumed READ-ONLY — the cross-module
// read-only precedent of itemStates/practiceSummariesForCourse.
// ---------------------------------------------------------------------------

// The owner's confirmed, non-deleted studies — the roadmap's node source
// (R4 "after goal selection": only a confirmed plan carries a node; a
// deleted/revoked study is an unauthorized node and never renders). The
// confirmation pointer lives on app.study_batch (the batchRow precedent —
// app.material predates batching and carries no row for later studies).
// Carries the confirmed plan revision's jsonb so the node can name the
// plan-pinned mini-course title/topic, and the confirmation instant (the
// standalone recommended order). Oldest confirmation first for stable
// serving.
export type ConfirmedRootRow = { rootId: string; confirmedAt: Date; plan: unknown };
export async function confirmedRootsForOwner(client: PoolClient, ownerId: string): Promise<ConfirmedRootRow[]> {
  const result = await client.query<ConfirmedRootRow>(
    `SELECT r.id AS "rootId", pc.confirmed_at AS "confirmedAt", pr.plan
     FROM app.lifecycle_root r
     JOIN app.study_batch b ON b.id = r.id
     JOIN app.plan_revision pr ON pr.id = b.confirmed_id
     JOIN app.plan_confirmation pc ON pc.plan_id = pr.id
     WHERE r.owner_id=$1 AND r.deleted_at IS NULL AND b.confirmed_id IS NOT NULL
     ORDER BY pc.confirmed_at, r.id
     LIMIT 100`,
    [ownerId],
  );
  return result.rows;
}

// Every explicit studied-release pointer of the owner (story 4's switch
// state) — the resolution override each node honors before the default.
export async function studiedReleasesForOwner(client: PoolClient, ownerId: string): Promise<Array<{ root_id: string; course_id: string }>> {
  const result = await client.query<{ root_id: string; course_id: string }>(
    "SELECT root_id,course_id FROM app.studied_release WHERE owner_id=$1",
    [ownerId],
  );
  return result.rows;
}

// The DEFAULT course resolution per root, mirroring getCourse's own order:
// the current confirmed revision's latest course row (ANY status — a pending
// or failed generation of the confirmed plan is the honest resolution), else
// the latest READY row (any plan revision). DISTINCT ON takes the first row
// per root under that priority; the confirmed pointer reads app.study_batch
// (the batchRow precedent).
export type ResolvedCourseRow = { root_id: string; course_id: string; version: number | null; status: "pending" | "ready" | "failed"; content: unknown };
export async function resolvedCoursesForRoots(client: PoolClient, ownerId: string, rootIds: string[]): Promise<Map<string, ResolvedCourseRow>> {
  if (!rootIds.length) return new Map();
  const result = await client.query<ResolvedCourseRow>(
    `SELECT DISTINCT ON (c.root_id) c.root_id, c.id AS course_id, c.version, c.status, c.content
     FROM app.generated_course c
     JOIN app.study_batch b ON b.id = c.root_id
     WHERE c.owner_id=$1 AND c.root_id=ANY($2::uuid[])
     ORDER BY c.root_id,
       CASE WHEN b.confirmed_id IS NOT NULL AND c.plan_revision_id = b.confirmed_id THEN 0 WHEN c.status='ready' THEN 1 ELSE 2 END,
       c.created_at DESC, c.id DESC`,
    [ownerId, rootIds],
  );
  return new Map(result.rows.map(row => [row.root_id, row]));
}

// The newest READY per-root version (the Version-superseded honesty input:
// the node names it when the studied release is older than the newest ready
// one — switching stays the learner's explicit choice).
export async function latestReadyVersionsForRoots(client: PoolClient, ownerId: string, rootIds: string[]): Promise<Map<string, number>> {
  if (!rootIds.length) return new Map();
  const result = await client.query<{ root_id: string; version: number }>(
    "SELECT root_id,max(version) AS version FROM app.generated_course WHERE owner_id=$1 AND root_id=ANY($2::uuid[]) AND status='ready' GROUP BY root_id",
    [ownerId, rootIds],
  );
  return new Map(result.rows.map(row => [row.root_id, row.version]));
}

// Course rows by id (owner-scoped): serves the pointer-override reads (the
// switch target must be a ready release of this owner) and the manifest
// child courseId -> rootId mapping (a path groups STUDIES, so a child
// release resolves to the root whose node renders in the path).
export async function coursesForIds(client: PoolClient, ownerId: string, courseIds: string[]): Promise<Array<{ course_id: string; root_id: string; version: number | null; status: "pending" | "ready" | "failed"; content: unknown }>> {
  if (!courseIds.length) return [];
  const result = await client.query<{ course_id: string; root_id: string; version: number | null; status: "pending" | "ready" | "failed"; content: unknown }>(
    "SELECT id AS course_id,root_id,version,status,content FROM app.generated_course WHERE owner_id=$1 AND id=ANY($2::uuid[])",
    [ownerId, courseIds],
  );
  return result.rows;
}

// The owner's earned mini-course award pins (course release ids) — the ONLY
// input that can make a node Completed (the story-4 monotonic rule).
export async function miniCourseAwardsForOwner(client: PoolClient, ownerId: string): Promise<string[]> {
  const result = await client.query<{ course_id: string }>(
    "SELECT course_id FROM app.completion_award WHERE owner_id=$1 AND kind='mini-course' AND course_id IS NOT NULL",
    [ownerId],
  );
  return result.rows.map(row => row.course_id);
}

// Every attempt of the owner across the given roots, newest first (the
// nodeNeedsPractice chain rule reads newest-first, exactly like
// attemptsForRoot in getAssessment/guidance serving).
export async function attemptsForOwner(client: PoolClient, ownerId: string, rootIds: string[]): Promise<AttemptRow[]> {
  if (!rootIds.length) return [];
  const result = await client.query<AttemptRow>(
    `SELECT ${attemptColumns} FROM app.test_attempt WHERE owner_id=$1 AND root_id=ANY($2::uuid[]) ORDER BY created_at DESC, id DESC`,
    [ownerId, rootIds],
  );
  return result.rows;
}

// Every recovery-target row of the owner across the given roots (the
// Needs-practice pill input).
export async function targetsForOwner(client: PoolClient, ownerId: string, rootIds: string[]): Promise<RecoveryTargetRow[]> {
  if (!rootIds.length) return [];
  const result = await client.query<RecoveryTargetRow>(
    `SELECT ${targetColumns} FROM app.recovery_target WHERE owner_id=$1 AND root_id=ANY($2::uuid[]) ORDER BY created_at, objective_index`,
    [ownerId, rootIds],
  );
  return result.rows;
}
