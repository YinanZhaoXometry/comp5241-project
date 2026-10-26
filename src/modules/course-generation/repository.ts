import type { PoolClient } from "pg";
import type { AdmissionOutcome } from "../../contracts/consent";
import type { CourseContent, CourseUsage } from "../../contracts/courses";

// Module-owned rows for the epic-2 S1 course tracer. Write ownership: only
// this module writes app.generated_course, app.course_objective and
// app.course_source. The content-free accounting ledger app.ai_dispatch_ledger
// is deliberately SHARED budget infrastructure (012 created it for all AI
// dispatch accounting): this module appends one zero-token row per generation
// exactly as the entry's plan directs — tokens are the processor's own claim,
// never fabricated.

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
  created_at: Date;
  settled_at: Date | null;
};
export type CourseWithScope = GeneratedCourseRow & { object_ids: string[]; admission_outcome: AdmissionOutcome };

const columns = 'c.id,c.root_id,c.owner_id,c.plan_revision_id,c.selection_id,c.admission_id,c.object_id,c.status,c.failure_code,c.version,c.superseded_by,c.content,c.model,c.usage,c.created_at,c.settled_at,a.object_ids';

export async function insertCourseRequest(
  client: PoolClient,
  row: { id: string; rootId: string; ownerId: string; planRevisionId: string; selectionId: string; admissionId: string },
) {
  await client.query(
    "INSERT INTO app.generated_course(id,root_id,owner_id,plan_revision_id,selection_id,admission_id,status) VALUES($1,$2,$3,$4,$5,$6,'pending')",
    [row.id, row.rootId, row.ownerId, row.planRevisionId, row.selectionId, row.admissionId],
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
// Terminal, single-direction transitions from pending; a settled row never
// changes again (idempotent duplicate deliveries are no-ops).
export async function markReady(
  client: PoolClient,
  requestId: string,
  settled: { content: CourseContent; model: string; usage: CourseUsage; version: number; objectId: string },
) {
  await client.query(
    "UPDATE app.generated_course SET status='ready',content=$2,model=$3,usage=$4,version=$5,object_id=$6,settled_at=clock_timestamp() WHERE id=$1 AND status='pending'",
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
export async function readyCount(client: PoolClient, rootId: string): Promise<number> {
  const result = await client.query<{ count: number }>("SELECT count(*)::int AS count FROM app.generated_course WHERE root_id=$1 AND status='ready'", [rootId]);
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
