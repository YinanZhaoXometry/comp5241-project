import type { PoolClient } from "pg";
import type { Plan } from "../../contracts/setup";
import { fail } from "../../platform/errors";

export type Material = { id: string; filename: string; original_id: string; revision: number; extraction_id: string | null; draft_id: string | null; confirmed_id: string | null };
export async function material(client: PoolClient, rootId: string) {
  const result = await client.query<Material>("SELECT * FROM app.material WHERE id=$1", [rootId]);
  if (!result.rows[0]) fail("FORBIDDEN_OR_NOT_FOUND");
  return result.rows[0];
}
export async function createMaterial(client: PoolClient, rootId: string, filename: string, originalId: string, bytes: number) {
  await client.query("INSERT INTO app.material(id,filename,original_id,byte_length) VALUES($1,$2,$3,$4)", [rootId, filename, originalId, bytes]);
}
export async function copyKey(client: PoolClient, id: string) {
  const result = await client.query<{ storage_key: string }>("SELECT storage_key FROM app.lifecycle_object WHERE id=$1", [id]);
  if (!result.rows[0]?.storage_key) fail("FORBIDDEN_OR_NOT_FOUND");
  return result.rows[0].storage_key;
}
export async function insertExtraction(client: PoolClient, id: string, rootId: string, hash: string) {
  await client.query("INSERT INTO app.extraction_revision(id,root_id,text_hash) VALUES($1,$2,$3)", [id, rootId, hash]);
  await client.query("UPDATE app.material SET extraction_id=$2,revision=revision+1 WHERE id=$1", [rootId, id]);
}
export async function insertPlan(client: PoolClient, id: string, rootId: string, extractionId: string, plan: Plan) {
  await client.query("INSERT INTO app.plan_revision(id,root_id,extraction_id,plan) VALUES($1,$2,$3,$4)", [id, rootId, extractionId, plan]);
  await client.query("UPDATE app.material SET draft_id=$2,revision=revision+1 WHERE id=$1", [rootId, id]);
}
export async function planRevision(client: PoolClient, id: string | null) {
  if (!id) return null;
  const result = await client.query<{ id: string; plan: Plan; extraction_id: string }>("SELECT id,plan,extraction_id FROM app.plan_revision WHERE id=$1", [id]);
  return result.rows[0] ? { id, plan: result.rows[0].plan, extractionId: result.rows[0].extraction_id, provenance: "Manual" as const } : null;
}
export async function confirmRevision(client: PoolClient, rootId: string, id: string) {
  await client.query("INSERT INTO app.plan_confirmation(plan_id,root_id) VALUES($1,$2) ON CONFLICT DO NOTHING", [id, rootId]);
  await client.query("UPDATE app.material SET confirmed_id=$2,revision=revision+1 WHERE id=$1", [rootId, id]);
}
// Module-owned lifecycle port: the lifecycle coordinator never writes these tables.
export async function purgeMaterial(client: PoolClient, rootId: string) {
  await client.query("DELETE FROM app.plan_confirmation WHERE root_id=$1", [rootId]);
  await client.query("UPDATE app.material SET draft_id=NULL,confirmed_id=NULL,extraction_id=NULL WHERE id=$1", [rootId]);
  await client.query("DELETE FROM app.plan_revision WHERE root_id=$1", [rootId]);
  await client.query("DELETE FROM app.extraction_revision WHERE root_id=$1", [rootId]);
  await client.query("DELETE FROM app.material WHERE id=$1", [rootId]);
}