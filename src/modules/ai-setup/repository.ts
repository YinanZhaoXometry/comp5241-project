import type { PoolClient } from "pg";
import type { AdmissionOutcome } from "../../contracts/consent";
import type { AiDraftResult, AiDraftStatus, AiDraftUsage, AiRequestKind } from "../../contracts/ai-setup";

// Module-owned rows for S6. Write ownership: only this module writes
// app.ai_draft_request and app.ai_dispatch_ledger; the lifecycle coordinator
// calls the registered port (lifecycle-platform/derivatives.ts), never these
// tables directly. Rows hold bounded outcomes and token counts only — never
// prompt text, excerpts or credentials.
export type DraftRequestRow = {
  id: string;
  root_id: string;
  owner_id: string;
  admission_id: string;
  kind: AiRequestKind;
  status: AiDraftStatus;
  failure_code: string | null;
  result: AiDraftResult | null;
  model: string | null;
  usage: AiDraftUsage | null;
  created_at: Date;
  settled_at: Date | null;
};
export type DraftWithScope = DraftRequestRow & { object_ids: string[]; admission_outcome: AdmissionOutcome };

const columns = 'd.id,d.root_id,d.owner_id,d.admission_id,d.kind,d.status,d.failure_code,d.result,d.model,d.usage,d.created_at,d.settled_at,a.object_ids,a.outcome AS "admissionOutcome"';

export async function insertDraftRequest(client: PoolClient, row: { id: string; rootId: string; ownerId: string; admissionId: string; kind: AiRequestKind }) {
  await client.query(
    "INSERT INTO app.ai_draft_request(id,root_id,owner_id,admission_id,kind,status) VALUES($1,$2,$3,$4,$5,'pending')",
    [row.id, row.rootId, row.ownerId, row.admissionId, row.kind],
  );
}
export async function draftById(client: PoolClient, ownerId: string, requestId: string): Promise<DraftWithScope | null> {
  const result = await client.query<DraftWithScope>(
    `SELECT ${columns} FROM app.ai_draft_request d JOIN app.dispatch_admission a ON a.id=d.admission_id WHERE d.id=$1 AND d.owner_id=$2`,
    [requestId, ownerId],
  );
  return result.rows[0] ?? null;
}
// Latest request of one kind for a study root (owner-scoped): the advisory UI
// reads one state, not a history — older rows stay for the deletion ledger only.
export async function draftByRoot(client: PoolClient, ownerId: string, rootId: string, kind: AiRequestKind = "plan"): Promise<DraftWithScope | null> {
  const result = await client.query<DraftWithScope>(
    `SELECT ${columns} FROM app.ai_draft_request d JOIN app.dispatch_admission a ON a.id=d.admission_id WHERE d.root_id=$1 AND d.owner_id=$2 AND d.kind=$3 ORDER BY d.created_at DESC, d.id DESC LIMIT 1`,
    [rootId, ownerId, kind],
  );
  return result.rows[0] ?? null;
}
// Terminal, single-direction transitions from pending; a settled row never
// changes again (idempotent duplicate deliveries are no-ops). A check-kind
// row stores no result payload — its effect is the diagnostic bundle itself.
export async function markReady(client: PoolClient, requestId: string, result: AiDraftResult | null, model: string, usage: AiDraftUsage) {
  await client.query(
    "UPDATE app.ai_draft_request SET status='ready',result=$2,model=$3,usage=$4,settled_at=clock_timestamp() WHERE id=$1 AND status='pending'",
    [requestId, result, model, usage],
  );
}
export async function markFailed(client: PoolClient, requestId: string, failureCode: string) {
  await client.query(
    "UPDATE app.ai_draft_request SET status='failed',failure_code=$2,result=NULL,settled_at=clock_timestamp() WHERE id=$1 AND status='pending'",
    [requestId, failureCode],
  );
}
// Untrusted provider-claimed token totals, used only for the budget pre-check.
export async function ledgerTotalTokens(client: PoolClient, ownerId: string) {
  const result = await client.query<{ total: number }>("SELECT COALESCE(sum(total_tokens),0)::int AS total FROM app.ai_dispatch_ledger WHERE owner_id=$1", [ownerId]);
  return result.rows[0].total;
}
export async function insertLedger(client: PoolClient, ownerId: string, requestId: string, usage: AiDraftUsage) {
  await client.query(
    "INSERT INTO app.ai_dispatch_ledger(id,owner_id,request_id,input_tokens,output_tokens,total_tokens) VALUES($1,$2,$3,$4,$5,$6)",
    [crypto.randomUUID(), ownerId, requestId, usage.inputTokens, usage.outputTokens, usage.totalTokens],
  );
}
// Lifecycle port helpers: root-scoped purge of derivative request rows (the
// ledger is content-free accounting and deliberately survives, keyed by owner).
export async function purgeByRoot(client: PoolClient, rootIds: string[]) {
  if (!rootIds.length) return;
  await client.query("DELETE FROM app.ai_draft_request WHERE root_id=ANY($1::uuid[])", [rootIds]);
}
export async function purgeByOwner(client: PoolClient, ownerId: string) {
  await client.query("DELETE FROM app.ai_dispatch_ledger WHERE owner_id=$1", [ownerId]);
  await client.query("DELETE FROM app.ai_draft_request WHERE owner_id=$1", [ownerId]);
}
