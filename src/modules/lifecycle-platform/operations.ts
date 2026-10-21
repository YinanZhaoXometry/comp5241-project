import type { PoolClient } from "pg";
import { database, transaction } from "../../adapters/postgres/database";
import { transactionQueue, EXTRACTION_QUEUE, transactionDb } from "../../adapters/queue";
import type { ExtractionJob } from "../../contracts/setup";

export type Operation = ExtractionJob & { state: string; attemptId: string | null; leaseUntil: Date | null; createdAt: Date };
export async function createOperation(client: PoolClient, job: ExtractionJob) {
  await client.query("INSERT INTO app.operation(id,root_id,owner_id,session_id,generation,epoch,state) VALUES($1,$2,$3,$4,$5,$6,'queued')", [job.operationId, job.rootId, job.ownerId, job.sessionId, job.generation, job.epoch]);
}
export async function operation(client: PoolClient, id: string): Promise<Operation | undefined> {
  const result = await client.query<{ id: string; root_id: string; owner_id: string; session_id: string; generation: number; epoch: number; state: string; attempt_id: string | null; lease_until: Date | null; created_at: Date }>("SELECT * FROM app.operation WHERE id=$1 FOR UPDATE", [id]);
  const row = result.rows[0];
  return row ? { schemaVersion: 1, operationId: row.id, rootId: row.root_id, ownerId: row.owner_id, sessionId: row.session_id, generation: row.generation, epoch: row.epoch, state: row.state, attemptId: row.attempt_id, leaseUntil: row.lease_until, createdAt: row.created_at } : undefined;
}
export async function operationIdentity(id: string) {
  const result = await database().query<{ owner_id: string; session_id: string }>("SELECT owner_id,session_id FROM app.operation WHERE id=$1", [id]);
  return result.rows[0];
}
export async function setOperation(client: PoolClient, id: string, state: string, attemptId?: string) {
  await client.query("UPDATE app.operation SET state=$2,attempt_id=$3,lease_until=CASE WHEN $2='extracting' THEN clock_timestamp()+interval '30 seconds' ELSE NULL END,updated_at=clock_timestamp() WHERE id=$1", [id, state, attemptId ?? null]);
}
export async function failedOperation(id: string, attemptId: string | undefined, canceled: boolean) {
  await transaction(async client => {
    const job = await transactionQueue(client).getJobById(EXTRACTION_QUEUE, id, { db: transactionDb(client) });
    const exhausted = !job || job.state === "failed" || job.retryCount >= job.retryLimit;
    await client.query("UPDATE app.operation SET state=$3,lease_until=NULL,updated_at=clock_timestamp() WHERE id=$1 AND attempt_id IS NOT DISTINCT FROM $2::uuid AND state NOT IN ('preview','canceled')", [id, attemptId ?? null, canceled ? "canceled" : exhausted ? "permanent-failed" : "retryable-failed"]);
  });
}