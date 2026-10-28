import type { PoolClient } from "pg";
import type { AdmissionOutcome } from "../../contracts/consent";
import type { CourseContent, CoursePreferencePin, CourseUsage, SupplementOutcome, WhyDimension, WhySource } from "../../contracts/courses";

// Module-owned rows for the epic-2 course tracer. Write ownership: only
// this module writes app.generated_course, app.course_objective,
// app.course_source and app.practice_attempt. The content-free accounting
// ledger app.ai_dispatch_ledger is deliberately SHARED budget infrastructure
// (012 created it for all AI dispatch accounting): this module appends one
// zero-token row per generation exactly as the entry's plan directs — tokens
// are the processor's own claim, never fabricated.
// Epic-2 S2 adds app.supplement_request and app.course_supplement under the
// same ownership: one tracked supplement pass per command and its verified
// (or honestly unsupported) rows, cascading from the course they explain.
// Epic-2 S3 adds app.course_item_state: owner-scoped, course-version-scoped
// explicit mark-done rows (migration 017). Done is ONLY an explicit learner
// action — the table records no dwell, scroll, visibility or score columns,
// and the ON DELETE CASCADE from generated_course keeps root purge and
// whole-personal removal deleting tracker rows with the course lineage.
// Epic-2 S5 adds app.practice_attempt: typed practice evidence, one row per
// submission event (owner, course version, card, attempted text, outcome,
// learner-declared evidence kind) with NO attempt semantics — cascading from
// the course lineage exactly like the tracker rows.
// Epic-2 S6 adds app.why_explanation (migration 020): one why-explanation
// derivative per (owner, course version, lesson index, depth) — the row is
// both the tracked command (pending→ready/failed, claim-first) and its
// settled result, cascading from the course lineage with NO tracker, credit,
// completion or unlock columns anywhere (depth unlocks nothing).

export type GeneratedCourseRow = {
  id: string;
  root_id: string;
  owner_id: string;
  plan_revision_id: string;
  selection_id: string;
  admission_id: string;
  object_id: string | null;
  status: "pending" | "ready" | "failed";
  failure_code: string | null;
  version: number | null;
  superseded_by: string | null;
  content: CourseContent | null;
  model: string | null;
  usage: CourseUsage | null;
  // Request-time pin of the pitch-relevant preference fields (epic-2 S4
  // review fix): the worker consumes THIS, never a live re-read. Null only on
  // pre-review legacy rows, which fall back to the current preference row.
  preference_pin: CoursePreferencePin | null;
  created_at: Date;
  settled_at: Date | null;
};
export type CourseWithScope = GeneratedCourseRow & { object_ids: string[]; admission_outcome: AdmissionOutcome };

const columns = 'c.id,c.root_id,c.owner_id,c.plan_revision_id,c.selection_id,c.admission_id,c.object_id,c.status,c.failure_code,c.version,c.superseded_by,c.content,c.model,c.usage,c.preference_pin,c.created_at,c.settled_at,a.object_ids';

export async function insertCourseRequest(
  client: PoolClient,
  row: { id: string; rootId: string; ownerId: string; planRevisionId: string; selectionId: string; admissionId: string; preferencePin: CoursePreferencePin },
) {
  await client.query(
    "INSERT INTO app.generated_course(id,root_id,owner_id,plan_revision_id,selection_id,admission_id,status,preference_pin) VALUES($1,$2,$3,$4,$5,$6,'pending',$7)",
    [row.id, row.rootId, row.ownerId, row.planRevisionId, row.selectionId, row.admissionId, row.preferencePin],
  );
}
export async function courseById(client: PoolClient, ownerId: string, requestId: string): Promise<CourseWithScope | null> {
  const result = await client.query<CourseWithScope>(
    `SELECT ${columns} FROM app.generated_course c JOIN app.dispatch_admission a ON a.id=c.admission_id WHERE c.id=$1 AND c.owner_id=$2`,
    [requestId, ownerId],
  );
  return result.rows[0] ?? null;
}
// Latest generation row for one (root, confirmed plan revision) — any status.
export async function courseForPlan(client: PoolClient, rootId: string, planRevisionId: string): Promise<CourseWithScope | null> {
  const result = await client.query<CourseWithScope>(
    `SELECT ${columns} FROM app.generated_course c JOIN app.dispatch_admission a ON a.id=c.admission_id WHERE c.root_id=$1 AND c.plan_revision_id=$2 ORDER BY c.created_at DESC, c.id DESC LIMIT 1`,
    [rootId, planRevisionId],
  );
  return result.rows[0] ?? null;
}
// Latest settled course for a study root (owner-scoped) — the studyable one.
export async function latestReadyCourse(client: PoolClient, ownerId: string, rootId: string): Promise<CourseWithScope | null> {
  const result = await client.query<CourseWithScope>(
    `SELECT ${columns} FROM app.generated_course c JOIN app.dispatch_admission a ON a.id=c.admission_id WHERE c.root_id=$1 AND c.owner_id=$2 AND c.status='ready' ORDER BY c.created_at DESC, c.id DESC LIMIT 1`,
    [rootId, ownerId],
  );
  return result.rows[0] ?? null;
}
// A specific settled version by course id (owner- and root-scoped): the
// explicit read path that keeps prior versions readable after a regeneration
// supersedes them.
export async function readyCourseById(client: PoolClient, ownerId: string, rootId: string, courseId: string): Promise<CourseWithScope | null> {
  const result = await client.query<CourseWithScope>(
    `SELECT ${columns} FROM app.generated_course c JOIN app.dispatch_admission a ON a.id=c.admission_id WHERE c.id=$1 AND c.owner_id=$2 AND c.root_id=$3 AND c.status='ready'`,
    [courseId, ownerId, rootId],
  );
  return result.rows[0] ?? null;
}
// A specific settled version by per-root version number (owner-scoped).
export async function readyCourseByVersion(client: PoolClient, ownerId: string, rootId: string, version: number): Promise<CourseWithScope | null> {
  const result = await client.query<CourseWithScope>(
    `SELECT ${columns} FROM app.generated_course c JOIN app.dispatch_admission a ON a.id=c.admission_id WHERE c.root_id=$1 AND c.owner_id=$2 AND c.version=$3 AND c.status='ready'`,
    [rootId, ownerId, version],
  );
  return result.rows[0] ?? null;
}
export async function newerReadyExists(client: PoolClient, rootId: string, courseId: string): Promise<boolean> {
  const result = await client.query<{ found: boolean }>(
    "SELECT EXISTS(SELECT 1 FROM app.generated_course WHERE root_id=$1 AND status='ready' AND created_at>(SELECT created_at FROM app.generated_course WHERE id=$2)) AS found",
    [rootId, courseId],
  );
  return result.rows[0].found;
}
// Newest ready per-root version number — what an explicit switch moves to.
export async function latestReadyVersion(client: PoolClient, rootId: string): Promise<number | null> {
  const result = await client.query<{ version: number }>(
    "SELECT version FROM app.generated_course WHERE root_id=$1 AND status='ready' ORDER BY created_at DESC, id DESC LIMIT 1",
    [rootId],
  );
  return result.rows[0]?.version ?? null;
}
// Every ready per-root version number of one owner (ascending) — the
// assessment switch surface's version list (epic-3 story 4). Read-only,
// owner- and root-scoped, content-free.
export async function readyCourseVersions(client: PoolClient, ownerId: string, rootId: string): Promise<number[]> {
  const result = await client.query<{ version: number }>(
    "SELECT version FROM app.generated_course WHERE root_id=$1 AND owner_id=$2 AND status='ready' AND version IS NOT NULL ORDER BY version",
    [rootId, ownerId],
  );
  return result.rows.map(row => row.version);
}
// Content-free generated signal for the library/plan surfaces: does this root
// own any READY course version? Boolean only — no course data crosses.
export async function hasReadyCourse(client: PoolClient, rootId: string): Promise<boolean> {
  const result = await client.query<{ found: boolean }>(
    "SELECT EXISTS(SELECT 1 FROM app.generated_course WHERE root_id=$1 AND status='ready') AS found",
    [rootId],
  );
  return result.rows[0].found;
}
// Batch form of the same content-free signal for list views: the subset of the
// given roots that own at least one READY course version.
export async function hasReadyCourses(client: PoolClient, rootIds: string[]): Promise<Set<string>> {
  if (!rootIds.length) return new Set();
  const result = await client.query<{ root_id: string }>(
    "SELECT DISTINCT root_id FROM app.generated_course WHERE root_id=ANY($1::uuid[]) AND status='ready'",
    [rootIds],
  );
  return new Set(result.rows.map(row => row.root_id));
}
// ---------------------------------------------------------------------------
// Epic-2 S3 tracker rows. One row per (owner, course version, item id); the
// UNIQUE constraint makes a replayed/duplicate delivery a structural no-op.
// ---------------------------------------------------------------------------
export async function insertItemState(
  client: PoolClient,
  row: { ownerId: string; courseId: string; itemId: string },
) {
  await client.query(
    "INSERT INTO app.course_item_state(id,owner_id,course_id,item_id) VALUES($1,$2,$3,$4) ON CONFLICT (owner_id,course_id,item_id) DO NOTHING",
    [crypto.randomUUID(), row.ownerId, row.courseId, row.itemId],
  );
}
export async function itemStates(client: PoolClient, ownerId: string, courseId: string): Promise<Array<{ item_id: string; done_at: Date }>> {
  const result = await client.query<{ item_id: string; done_at: Date }>(
    'SELECT item_id,done_at FROM app.course_item_state WHERE owner_id=$1 AND course_id=$2',
    [ownerId, courseId],
  );
  return result.rows;
}

// ---------------------------------------------------------------------------
// Epic-2 S5 typed practice evidence (migration 019 app.practice_attempt). One
// row per SUBMISSION EVENT — no UNIQUE constraint anywhere: retries are fresh
// rows under fresh commands, never deduplicated and never double-counted as
// anything. Command-envelope replay never reaches this insert (the service
// replays through the command_receipt machinery first). The row deliberately
// carries no score, credit, completion, course-attempt or scheduling fields.
// ---------------------------------------------------------------------------
export async function insertPracticeAttempt(
  client: PoolClient,
  row: { ownerId: string; courseId: string; cardId: string; attempted: string; outcome: "correct" | "incorrect"; evidenceKind: "unaided" | "assisted" },
) {
  await client.query(
    "INSERT INTO app.practice_attempt(id,owner_id,course_id,card_id,attempted,outcome,evidence_kind) VALUES($1,$2,$3,$4,$5,$6,$7)",
    [crypto.randomUUID(), row.ownerId, row.courseId, row.cardId, row.attempted, row.outcome, row.evidenceKind],
  );
}
// Terminal, single-direction transitions from pending; a settled row never
// changes again. claimReady runs FIRST inside the persist transaction and
// returns the claimed id — a delivery whose row already reached a terminal
// state after the worker's phase-1 re-read (e.g. a stranded row marked
// failed 'timeout' by a new command) sees no row and the transaction writes
// nothing. completeReady then fills in the claimed row's settled fields.
export async function claimReady(client: PoolClient, requestId: string): Promise<string | null> {
  const result = await client.query<{ id: string }>(
    "UPDATE app.generated_course SET status='ready',settled_at=clock_timestamp() WHERE id=$1 AND status='pending' RETURNING id",
    [requestId],
  );
  return result.rows[0]?.id ?? null;
}
export async function completeReady(
  client: PoolClient,
  requestId: string,
  settled: { content: CourseContent; model: string; usage: CourseUsage; version: number; objectId: string },
) {
  await client.query(
    "UPDATE app.generated_course SET content=$2,model=$3,usage=$4,version=$5,object_id=$6 WHERE id=$1",
    [requestId, settled.content, settled.model, settled.usage, settled.version, settled.objectId],
  );
}
export async function markFailed(client: PoolClient, requestId: string, failureCode: string) {
  await client.query(
    "UPDATE app.generated_course SET status='failed',failure_code=$2,content=NULL,settled_at=clock_timestamp() WHERE id=$1 AND status='pending'",
    [requestId, failureCode],
  );
}
// Re-confirmation supersedes: the prior ready course stays readable with a
// pointer to its successor. Serialized by the root lock the settle
// transaction already holds via registerObject.
export async function supersedePrior(client: PoolClient, rootId: string, successorId: string) {
  await client.query(
    "UPDATE app.generated_course SET superseded_by=$2 WHERE root_id=$1 AND status='ready' AND id<>$2 AND superseded_by IS NULL",
    [rootId, successorId],
  );
}
// Ready-version count for version assignment. The claiming row may already
// carry status='ready' (claim-first persist order), so the caller excludes it.
export async function readyCount(client: PoolClient, rootId: string, exceptId?: string) {
  const result = await client.query<{ count: number }>(
    exceptId === undefined
      ? "SELECT count(*)::int AS count FROM app.generated_course WHERE root_id=$1 AND status='ready'"
      : "SELECT count(*)::int AS count FROM app.generated_course WHERE root_id=$1 AND status='ready' AND id<>$2",
    exceptId === undefined ? [rootId] : [rootId, exceptId],
  );
  return result.rows[0].count;
}
export async function insertObjectives(client: PoolClient, courseId: string, objectives: CourseContent["objectives"]) {
  for (const objective of objectives) {
    await client.query("INSERT INTO app.course_objective(id,course_id,position,objective) VALUES($1,$2,$3,$4)", [crypto.randomUUID(), courseId, objective.index, objective.text]);
  }
}
export async function insertSources(client: PoolClient, courseId: string, sources: Array<{ position: number; extractionId: string; filename: string }>) {
  for (const source of sources) {
    await client.query("INSERT INTO app.course_source(id,course_id,position,extraction_id,filename) VALUES($1,$2,$3,$4,$5)", [crypto.randomUUID(), courseId, source.position, source.extractionId, source.filename]);
  }
}
// ---------------------------------------------------------------------------
// Epic-2 S7 provenance reads over the versioned lineage tables (015 created
// them for exactly this surface). Read-only, course-version-scoped: the rows
// are immutable once written, which is what keeps pinned documents stable.
// ---------------------------------------------------------------------------
export async function courseObjectiveRows(client: PoolClient, courseId: string): Promise<Array<{ position: number; objective: string }>> {
  const result = await client.query<{ position: number; objective: string }>(
    "SELECT position,objective FROM app.course_objective WHERE course_id=$1 ORDER BY position",
    [courseId],
  );
  return result.rows;
}
export async function courseSourceRows(client: PoolClient, courseId: string): Promise<Array<{ extraction_id: string; filename: string }>> {
  const result = await client.query<{ extraction_id: string; filename: string }>(
    "SELECT extraction_id,filename FROM app.course_source WHERE course_id=$1 ORDER BY position",
    [courseId],
  );
  return result.rows;
}
// One content-free accounting row per generation with the processor-claimed
// usage (the synthetic fixture honestly claims 0/0 — the accounting path stays
// live, the counts are never fabricated). request_id stays NULL: this row
// belongs to a course generation, not an ai_draft_request.
export async function insertLedgerRow(client: PoolClient, ownerId: string, usage: CourseUsage) {
  await client.query(
    "INSERT INTO app.ai_dispatch_ledger(id,owner_id,request_id,input_tokens,output_tokens,total_tokens) VALUES($1,$2,NULL,$3,$4,$5)",
    [crypto.randomUUID(), ownerId, usage.inputTokens, usage.outputTokens, usage.totalTokens],
  );
}

// ---------------------------------------------------------------------------
// Epic-2 S2 supplement rows. Status transitions are terminal-monotonic from
// 'pending' and status-guarded, so duplicate deliveries no-op exactly like
// the course rows.
// ---------------------------------------------------------------------------

export type SupplementRequestRow = {
  id: string;
  root_id: string;
  owner_id: string;
  course_id: string;
  admission_id: string;
  object_id: string | null;
  status: "pending" | "ready" | "failed";
  failure_code: string | null;
  created_at: Date;
  settled_at: Date | null;
};
export type SupplementRequestWithScope = SupplementRequestRow & { object_ids: string[] };

export type SupplementRow = {
  id: string;
  request_id: string;
  course_id: string;
  position: number;
  outcome: SupplementOutcome;
  url: string;
  origin: string;
  locator: string | null;
  passage: string | null;
  content_hash: string | null;
  retrieved_at: Date | null;
  claim: string;
  upload_excerpt: string | null;
  upload_source: string | null;
};

export async function insertSupplementRequest(
  client: PoolClient,
  row: { id: string; rootId: string; ownerId: string; courseId: string; admissionId: string },
) {
  await client.query(
    "INSERT INTO app.supplement_request(id,root_id,owner_id,course_id,admission_id,status) VALUES($1,$2,$3,$4,$5,'pending')",
    [row.id, row.rootId, row.ownerId, row.courseId, row.admissionId],
  );
}
const supplementColumns = 's.id,s.root_id,s.owner_id,s.course_id,s.admission_id,s.object_id,s.status,s.failure_code,s.created_at,s.settled_at,a.object_ids';
export async function supplementRequestById(client: PoolClient, ownerId: string, requestId: string): Promise<SupplementRequestWithScope | null> {
  const result = await client.query<SupplementRequestWithScope>(
    `SELECT ${supplementColumns} FROM app.supplement_request s JOIN app.dispatch_admission a ON a.id=s.admission_id WHERE s.id=$1 AND s.owner_id=$2`,
    [requestId, ownerId],
  );
  return result.rows[0] ?? null;
}
// Latest supplement pass for one course version (owner-scoped) — any status.
export async function latestSupplementRequest(client: PoolClient, ownerId: string, courseId: string): Promise<SupplementRequestWithScope | null> {
  const result = await client.query<SupplementRequestWithScope>(
    `SELECT ${supplementColumns} FROM app.supplement_request s JOIN app.dispatch_admission a ON a.id=s.admission_id WHERE s.course_id=$1 AND s.owner_id=$2 ORDER BY s.created_at DESC, s.id DESC LIMIT 1`,
    [courseId, ownerId],
  );
  return result.rows[0] ?? null;
}
// Claim-first terminal transition for the supplement pass (the claimReady
// contract above): returns the claimed id or null when the row is already
// terminal, so a raced delivery persists nothing.
export async function claimSupplementReady(client: PoolClient, requestId: string): Promise<string | null> {
  const result = await client.query<{ id: string }>(
    "UPDATE app.supplement_request SET status='ready',settled_at=clock_timestamp() WHERE id=$1 AND status='pending' RETURNING id",
    [requestId],
  );
  return result.rows[0]?.id ?? null;
}
export async function completeSupplementReady(client: PoolClient, requestId: string, objectId: string) {
  await client.query(
    "UPDATE app.supplement_request SET object_id=$2 WHERE id=$1",
    [requestId, objectId],
  );
}
export async function markSupplementFailed(client: PoolClient, requestId: string, failureCode: string) {
  await client.query(
    "UPDATE app.supplement_request SET status='failed',failure_code=$2,settled_at=clock_timestamp() WHERE id=$1 AND status='pending'",
    [requestId, failureCode],
  );
}
// Persisted supplement rows of one request, gap order.
export async function supplementsForRequest(client: PoolClient, requestId: string): Promise<SupplementRow[]> {
  const result = await client.query<SupplementRow>(
    "SELECT * FROM app.course_supplement WHERE request_id=$1 ORDER BY position",
    [requestId],
  );
  return result.rows;
}
export async function insertSupplementRow(
  client: PoolClient,
  row: {
    requestId: string;
    courseId: string;
    position: number;
    outcome: SupplementOutcome;
    url: string;
    origin: string;
    locator: string | null;
    passage: string | null;
    contentHash: string | null;
    retrievedAt: Date | null;
    claim: string;
    uploadExcerpt: string | null;
    uploadSource: string | null;
  },
) {
  await client.query(
    "INSERT INTO app.course_supplement(id,request_id,course_id,position,outcome,url,origin,locator,passage,content_hash,retrieved_at,claim,upload_excerpt,upload_source) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)",
    [crypto.randomUUID(), row.requestId, row.courseId, row.position, row.outcome, row.url, row.origin, row.locator, row.passage, row.contentHash, row.retrievedAt, row.claim, row.uploadExcerpt, row.uploadSource],
  );
}

// ---------------------------------------------------------------------------
// Epic-2 S6 why rows (migration 020 app.why_explanation). One row per
// (owner, course version, lesson index, depth): the UNIQUE constraint makes
// one explanation per level structural. Statuses are terminal-monotonic from
// 'pending'; an honest retry after failure (or a stranded pending row past the
// 120-second cap, first marked failed 'timeout' by the service) RE-PENDS the
// same row under a fresh admission — the guarded upsert below is the only
// pending-entry point, and a row that raced to pending/ready concurrently
// makes the update a no-op so the newer delivery owns the level.
// ---------------------------------------------------------------------------

export type WhyExplanationRow = {
  id: string;
  root_id: string;
  owner_id: string;
  course_id: string;
  lesson_index: number;
  depth: number;
  admission_id: string;
  status: "pending" | "ready" | "failed";
  failure_code: string | null;
  dimension: WhyDimension | null;
  explanation: string | null;
  sources: WhySource[] | null;
  model: string | null;
  created_at: Date;
  settled_at: Date | null;
};
export type WhyRowWithScope = WhyExplanationRow & { object_ids: string[] };

// (Re-)pend one level under a fresh admission. The guard keeps a concurrently
// pended/settled row untouched; the service has already verified the row is
// absent or terminal before calling.
export async function upsertWhyRequest(
  client: PoolClient,
  row: { id: string; rootId: string; ownerId: string; courseId: string; lessonIndex: number; depth: number; admissionId: string },
) {
  await client.query(
    `INSERT INTO app.why_explanation(id,root_id,owner_id,course_id,lesson_index,depth,admission_id,status)
     VALUES($1,$2,$3,$4,$5,$6,$7,'pending')
     ON CONFLICT (owner_id,course_id,lesson_index,depth) DO UPDATE SET
       status='pending', admission_id=EXCLUDED.admission_id, failure_code=NULL,
       dimension=NULL, explanation=NULL, sources=NULL, model=NULL,
       created_at=clock_timestamp(), settled_at=NULL
     WHERE app.why_explanation.status='failed'`,
    [row.id, row.rootId, row.ownerId, row.courseId, row.lessonIndex, row.depth, row.admissionId],
  );
}
const whyColumns = 'w.id,w.root_id,w.owner_id,w.course_id,w.lesson_index,w.depth,w.admission_id,w.status,w.failure_code,w.dimension,w.explanation,w.sources,w.model,w.created_at,w.settled_at,a.object_ids';
export async function whyRowById(client: PoolClient, ownerId: string, requestId: string): Promise<WhyRowWithScope | null> {
  const result = await client.query<WhyRowWithScope>(
    `SELECT ${whyColumns} FROM app.why_explanation w JOIN app.dispatch_admission a ON a.id=w.admission_id WHERE w.id=$1 AND w.owner_id=$2`,
    [requestId, ownerId],
  );
  return result.rows[0] ?? null;
}
export async function whyRowFor(client: PoolClient, ownerId: string, courseId: string, lessonIndex: number, depth: number): Promise<WhyRowWithScope | null> {
  const result = await client.query<WhyRowWithScope>(
    `SELECT ${whyColumns} FROM app.why_explanation w JOIN app.dispatch_admission a ON a.id=w.admission_id WHERE w.course_id=$1 AND w.owner_id=$2 AND w.lesson_index=$3 AND w.depth=$4`,
    [courseId, ownerId, lessonIndex, depth],
  );
  return result.rows[0] ?? null;
}
export async function whyRowsForLesson(client: PoolClient, ownerId: string, courseId: string, lessonIndex: number): Promise<WhyExplanationRow[]> {
  const result = await client.query<WhyExplanationRow>(
    "SELECT id,root_id,owner_id,course_id,lesson_index,depth,admission_id,status,failure_code,dimension,explanation,sources,model,created_at,settled_at FROM app.why_explanation WHERE course_id=$1 AND owner_id=$2 AND lesson_index=$3 ORDER BY depth",
    [courseId, ownerId, lessonIndex],
  );
  return result.rows;
}
// Every why row of one course version across all lessons (owner-scoped) — the
// epic-2 S7 provenance inventory; non-ready rows are filtered by the caller.
export async function whyRowsForCourse(client: PoolClient, ownerId: string, courseId: string): Promise<WhyExplanationRow[]> {
  const result = await client.query<WhyExplanationRow>(
    "SELECT id,root_id,owner_id,course_id,lesson_index,depth,admission_id,status,failure_code,dimension,explanation,sources,model,created_at,settled_at FROM app.why_explanation WHERE course_id=$1 AND owner_id=$2 ORDER BY lesson_index,depth",
    [courseId, ownerId],
  );
  return result.rows;
}
// Claim-first terminal transition (the claimReady/claimSupplementReady
// contract), ATOMIC with the settled fields because the table's cross-column
// CHECK only admits a ready row that already carries its explanation: the
// single status-guarded UPDATE either lands the whole terminal state or
// nothing (a raced terminal row matches zero rows), so a raced delivery
// persists nothing.
export async function claimWhyReady(
  client: PoolClient,
  requestId: string,
  settled: { dimension: WhyDimension; explanation: string; sources: WhySource[]; model: string },
): Promise<string | null> {
  const result = await client.query<{ id: string }>(
    "UPDATE app.why_explanation SET status='ready',settled_at=clock_timestamp(),dimension=$2,explanation=$3,sources=$4,model=$5 WHERE id=$1 AND status='pending' RETURNING id",
    // The jsonb citations column takes the JSON text form explicitly — node-pg
    // would otherwise serialize a JS array as a Postgres array literal.
    [requestId, settled.dimension, settled.explanation, JSON.stringify(settled.sources), settled.model],
  );
  return result.rows[0]?.id ?? null;
}
export async function markWhyFailed(client: PoolClient, requestId: string, failureCode: string) {
  await client.query(
    "UPDATE app.why_explanation SET status='failed',failure_code=$2,settled_at=clock_timestamp() WHERE id=$1 AND status='pending'",
    [requestId, failureCode],
  );
}

// The VERIFIED supplement pool of one course version's latest SETTLED pass —
// the same records the course view shows (supported/conflict carry a checked
// passage; unsupported rows never ground why depth). Feeds both the service's
// availability pre-check and the worker's re-fenced recomputation.
export async function verifiedSupplementPool(
  client: PoolClient,
  ownerId: string,
  courseId: string,
): Promise<Array<{ outcome: string; url: string; origin: string; locator: string | null; passage: string | null }>> {
  const request = await latestSupplementRequest(client, ownerId, courseId);
  if (!request || request.status !== "ready") return [];
  const rows = await supplementsForRequest(client, request.id);
  return rows
    .filter(row => row.outcome === "supported" || row.outcome === "conflict")
    .map(row => ({ outcome: row.outcome, url: row.url, origin: row.origin, locator: row.locator, passage: row.passage }));
}
