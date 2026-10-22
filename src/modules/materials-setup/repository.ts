import type { PoolClient } from "pg";
import type { Plan } from "../../contracts/setup";
import type { ExtractionMetadata, Format } from "../../contracts/documents";
import { fail } from "../../platform/errors";

export type Material = { id: string; filename: string; format: Format; original_id: string; revision: number; extraction_id: string | null; draft_id: string | null; confirmed_id: string | null };
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
export async function insertExtraction(client: PoolClient, id: string, rootId: string, hash: string, metadata: ExtractionMetadata) {
  await client.query("INSERT INTO app.extraction_revision(id,root_id,text_hash,metadata) VALUES($1,$2,$3,$4)", [id, rootId, hash, metadata]);
  await client.query("UPDATE app.material SET extraction_id=$2,revision=revision+1 WHERE id=$1", [rootId, id]);
}
export async function insertPlan(client: PoolClient, id: string, rootId: string, extractionId: string, plan: Plan, selectionId: string) {
  await client.query("INSERT INTO app.plan_revision(id,root_id,extraction_id,plan,selection_id) VALUES($1,$2,$3,$4,$5)", [id, rootId, extractionId, plan, selectionId]);
  await client.query("UPDATE app.material SET draft_id=$2,revision=revision+1 WHERE id=$1", [rootId, id]);
  await client.query("UPDATE app.study_batch SET draft_id=$2,revision=revision+1 WHERE id=$1", [rootId, id]);
}
export async function planRevision(client: PoolClient, id: string | null) {
  if (!id) return null;
  const result = await client.query<{ id: string; plan: Plan; extraction_id: string; selection_id: string }>("SELECT id,plan,extraction_id,selection_id FROM app.plan_revision WHERE id=$1", [id]);
  const sources = result.rows[0] ? (await client.query<{ extractionId: string; rootId: string; filename: string }>('SELECT s.extraction_id AS "extractionId",s.root_id AS "rootId",b.filename FROM app.selection_source s JOIN app.batch_slot b ON b.id=s.slot_id WHERE s.selection_id=$1 ORDER BY b.position', [result.rows[0].selection_id])).rows : [];
  return result.rows[0] ? { id, plan: result.rows[0].plan, extractionId: result.rows[0].extraction_id, selectionId: result.rows[0].selection_id, sources, provenance: "Manual" as const } : null;
}
export async function confirmRevision(client: PoolClient, rootId: string, id: string) {
  await client.query("INSERT INTO app.plan_confirmation(plan_id,root_id) VALUES($1,$2) ON CONFLICT DO NOTHING", [id, rootId]);
  await client.query("UPDATE app.material SET confirmed_id=$2,revision=revision+1 WHERE id=$1", [rootId, id]);
  await client.query("UPDATE app.study_batch SET confirmed_id=$2,revision=revision+1 WHERE id=$1", [rootId, id]);
}
export async function purgeObjects(client: PoolClient, ids: string[]) {
  if (!ids.length) return;
  await client.query("DELETE FROM app.plan_confirmation WHERE plan_id=ANY($1::uuid[])", [ids]);
  for (const table of ["app.material", "app.study_batch"]) {
    await client.query(`UPDATE ${table} SET draft_id=NULL WHERE draft_id=ANY($1::uuid[])`, [ids]);
    await client.query(`UPDATE ${table} SET confirmed_id=NULL WHERE confirmed_id=ANY($1::uuid[])`, [ids]);
  }
  await client.query("UPDATE app.study_batch SET selection_id=NULL WHERE selection_id=ANY($1::uuid[])", [ids]);
  await client.query("DELETE FROM app.plan_revision WHERE id=ANY($1::uuid[])", [ids]);
  await client.query("DELETE FROM app.selection_source WHERE selection_id=ANY($1::uuid[])", [ids]);
  await client.query("DELETE FROM app.selection_revision WHERE id=ANY($1::uuid[])", [ids]);
}
// Module-owned lifecycle port: the lifecycle coordinator never writes these tables.
export async function purgeMaterial(client: PoolClient, rootId: string) {
  await client.query("DELETE FROM app.plan_confirmation WHERE root_id=$1", [rootId]);
  await client.query("UPDATE app.material SET draft_id=NULL,confirmed_id=NULL,extraction_id=NULL WHERE id=$1", [rootId]);
  await client.query("DELETE FROM app.plan_revision WHERE root_id=$1", [rootId]);
  await client.query("DELETE FROM app.extraction_revision WHERE root_id=$1", [rootId]);
  await client.query("DELETE FROM app.material WHERE id=$1", [rootId]);
}