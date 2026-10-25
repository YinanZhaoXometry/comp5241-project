import type { PoolClient } from "pg";
import type { Assistance, DiagnosticChoice, DiagnosticSource, ItemOutcome, ItemPath } from "../../contracts/diagnostic";
import type { MaterializedItem } from "./bundle";
import { fail } from "../../platform/errors";

// Module-owned persistence for the setup diagnostic. The lifecycle coordinator
// never writes these tables; it calls purgeDiagnostics by the same
// module-owned-port pattern as purgeMaterial. Rows also cascade from their
// lifecycle objects, so purge stays correct even before that port is wired.

export type BundleRow = { id: string; root_id: string; plan_id: string; source: string; item_count: number };
export async function bundleById(client: PoolClient, rootId: string, id: string) {
  const found = await client.query<BundleRow>("SELECT * FROM app.diagnostic_bundle WHERE id=$1 AND root_id=$2", [id, rootId]);
  return found.rows[0] ?? null;
}
export async function bundleByPlan(client: PoolClient, planId: string) {
  const found = await client.query<BundleRow>("SELECT * FROM app.diagnostic_bundle WHERE plan_id=$1", [planId]);
  return found.rows[0] ?? null;
}
export async function latestBundle(client: PoolClient, rootId: string) {
  const found = await client.query<BundleRow>("SELECT * FROM app.diagnostic_bundle WHERE root_id=$1 ORDER BY created_at DESC LIMIT 1", [rootId]);
  return found.rows[0] ?? null;
}
// The bundle's lifecycle object is registered here (not via the shared
// registerObject helper, whose kind union is owned by lifecycle-platform) with
// the same root lock and ownership checks.
export async function registerDiagnosticObject(client: PoolClient, rootId: string, parents: string[]) {
  const root = await client.query<{ deleted_at: Date | null }>("SELECT deleted_at FROM app.lifecycle_root WHERE id=$1 FOR UPDATE", [rootId]);
  if (!root.rows[0] || root.rows[0].deleted_at) fail("FORBIDDEN_OR_NOT_FOUND");
  const id = crypto.randomUUID();
  await client.query("INSERT INTO app.lifecycle_object(id,root_id,kind,parent_ids) VALUES($1,$2,'diagnostic',$3)", [id, rootId, parents]);
  return id;
}
export async function insertBundle(client: PoolClient, id: string, rootId: string, planId: string, itemCount: number, source: DiagnosticSource = "manual-synthetic") {
  try {
    await client.query("INSERT INTO app.diagnostic_bundle(id,root_id,plan_id,source,item_count) VALUES($1,$2,$3,$4,$5)", [id, rootId, planId, source, itemCount]);
  } catch (error) {
    if ((error as { code?: string }).code === "23505") fail("CONFLICT"); // one bundle per confirmed plan revision
    throw error;
  }
}

export type ItemRow = {
  id: string;
  bundle_id: string;
  position: number;
  objective: string;
  source_ref: string;
  prompt: string;
  choices: DiagnosticChoice[];
  answer_id: string;
  rationale: string;
};
export async function insertItem(client: PoolClient, id: string, bundleId: string, position: number, item: MaterializedItem) {
  await client.query("INSERT INTO app.diagnostic_item(id,bundle_id,position,objective,source_ref,prompt,choices,answer_id,rationale) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)", [id, bundleId, position, item.objective, item.sourceRef, item.prompt, JSON.stringify(item.choices), item.answerId, item.rationale]);
}
export async function itemsForBundle(client: PoolClient, bundleId: string) {
  const found = await client.query<Omit<ItemRow, "choices"> & { choices: DiagnosticChoice[] }>("SELECT * FROM app.diagnostic_item WHERE bundle_id=$1 ORDER BY position", [bundleId]);
  return found.rows as ItemRow[];
}
export async function itemByPosition(client: PoolClient, bundleId: string, position: number) {
  const found = await client.query<Omit<ItemRow, "choices"> & { choices: DiagnosticChoice[] }>("SELECT * FROM app.diagnostic_item WHERE bundle_id=$1 AND position=$2", [bundleId, position]);
  return (found.rows[0] as ItemRow | undefined) ?? null;
}

export type EvidenceRow = {
  id: string;
  bundle_id: string;
  item_id: string;
  position: number;
  choice_id: string | null;
  outcome: ItemOutcome;
  assistance: Assistance;
  unclear: boolean;
  path: ItemPath;
};
export async function evidenceForBundle(client: PoolClient, bundleId: string) {
  const found = await client.query<EvidenceRow>("SELECT id,bundle_id,item_id,position,choice_id,outcome,assistance,unclear,path FROM app.diagnostic_evidence WHERE bundle_id=$1 ORDER BY position", [bundleId]);
  return found.rows;
}
export async function evidenceForItem(client: PoolClient, bundleId: string, itemId: string) {
  const found = await client.query<EvidenceRow>("SELECT id,bundle_id,item_id,position,choice_id,outcome,assistance,unclear,path FROM app.diagnostic_evidence WHERE bundle_id=$1 AND item_id=$2", [bundleId, itemId]);
  return found.rows[0] ?? null;
}
// Idempotent single-row insert; a false return means a concurrent submission
// for the same item already committed and the caller must reconcile with it.
export async function insertEvidence(client: PoolClient, id: string, record: { bundleId: string; itemId: string; ownerId: string; rootId: string; planId: string; position: number; choiceId: string | null; outcome: ItemOutcome; assistance: Assistance; path: ItemPath }) {
  const inserted = await client.query("INSERT INTO app.diagnostic_evidence(id,bundle_id,item_id,owner_id,root_id,plan_id,position,choice_id,outcome,assistance,unclear,path) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,false,$11) ON CONFLICT (bundle_id,item_id) DO NOTHING", [id, record.bundleId, record.itemId, record.ownerId, record.rootId, record.planId, record.position, record.choiceId, record.outcome, record.assistance, record.path]);
  return inserted.rowCount === 1;
}
// The only permitted evidence mutation: a one-way, never-unset unclear flag on
// an already submitted item; it is its own recorded path, not a revision.
export async function markUnclear(client: PoolClient, ownerId: string, bundleId: string, itemId: string) {
  const updated = await client.query("UPDATE app.diagnostic_evidence SET unclear=true WHERE bundle_id=$1 AND item_id=$2 AND owner_id=$3 AND unclear=false", [bundleId, itemId, ownerId]);
  return updated.rowCount === 1;
}

// Skip/finish/flag paths are content-free command receipts; existence lookups
// keep repeat clicks from piling up duplicate receipts.
export async function receiptExists(client: PoolClient, ownerId: string, rootId: string, action: string, scope: { bundleId?: string; position?: number } = {}) {
  const conditions = ["owner_id=$1", "root_id=$2", "action=$3"];
  const params: (string | number)[] = [ownerId, rootId, action];
  if (scope.bundleId) {
    params.push(scope.bundleId);
    conditions.push(`result->>'bundleId'=$${params.length}`);
  }
  if (scope.position !== undefined) {
    params.push(scope.position);
    conditions.push(`(result->>'position')::int=$${params.length}`);
  }
  const found = await client.query(`SELECT 1 FROM app.command_receipt WHERE ${conditions.join(" AND ")} LIMIT 1`, params);
  return found.rowCount === 1;
}

// Module-owned lifecycle port: purge every diagnostic derivative of a root.
export async function purgeDiagnostics(client: PoolClient, rootId: string) {
  await client.query("DELETE FROM app.diagnostic_evidence USING app.diagnostic_bundle WHERE app.diagnostic_evidence.bundle_id=app.diagnostic_bundle.id AND app.diagnostic_bundle.root_id=$1", [rootId]);
  await client.query("DELETE FROM app.diagnostic_item USING app.diagnostic_bundle WHERE app.diagnostic_item.bundle_id=app.diagnostic_bundle.id AND app.diagnostic_bundle.root_id=$1", [rootId]);
  await client.query("DELETE FROM app.diagnostic_bundle WHERE root_id=$1", [rootId]);
}
