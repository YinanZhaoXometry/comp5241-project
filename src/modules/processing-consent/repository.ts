import type { PoolClient } from "pg";
import type { AdmissionOutcome } from "../../contracts/consent";

// Module-owned rows for S3. Write ownership: only this module writes
// app.processor_configuration (seeded rows), app.processing_decision and
// app.dispatch_admission; later stories read them by these names.
export type ConfigurationRow = {
  id: string;
  version: number;
  provider: string;
  purpose: string;
  categories: unknown;
  retention_notice: string;
  eligibility: "eligible" | "ineligible";
  synthetic_test: boolean;
  daily_admission_limit: number;
};
export type DecisionRecord = {
  decision: "granted" | "declined" | "withdrawn";
  disclosure_version: number;
  decided_at: Date;
  request_hash: string;
};
export type AdmissionRow = {
  id: string;
  owner_id: string;
  command_key: string;
  configuration_id: string;
  purpose: string;
  outcome: AdmissionOutcome;
  object_ids: string[];
  session_id: string;
  settled_at: Date | null;
  created_at: Date;
};

export async function currentConfiguration(client: PoolClient) {
  const result = await client.query<ConfigurationRow>(
    "SELECT * FROM app.processor_configuration ORDER BY version DESC LIMIT 1",
  );
  return result.rows[0] ?? null;
}
export async function configurationById(client: PoolClient, id: string) {
  const result = await client.query<ConfigurationRow>(
    "SELECT * FROM app.processor_configuration WHERE id=$1",
    [id],
  );
  return result.rows[0] ?? null;
}
export async function decisionRows(client: PoolClient, ownerId: string) {
  const result = await client.query<Pick<DecisionRecord, "decision" | "disclosure_version" | "decided_at">>(
    "SELECT decision,disclosure_version,decided_at FROM app.processing_decision WHERE owner_id=$1 ORDER BY decided_at DESC LIMIT 50",
    [ownerId],
  );
  return result.rows;
}
export async function decisionByKey(client: PoolClient, ownerId: string, commandKey: string) {
  const result = await client.query<DecisionRecord>(
    "SELECT decision,disclosure_version,decided_at,request_hash FROM app.processing_decision WHERE owner_id=$1 AND command_key=$2",
    [ownerId, commandKey],
  );
  return result.rows[0] ?? null;
}
export async function insertDecision(
  client: PoolClient,
  ownerId: string,
  commandKey: string,
  configurationId: string,
  disclosureVersion: number,
  decision: "granted" | "declined" | "withdrawn",
  requestHash: string,
  sessionId: string,
) {
  await client.query(
    "INSERT INTO app.processing_decision(owner_id,command_key,configuration_id,disclosure_version,decision,request_hash,session_id) VALUES($1,$2,$3,$4,$5,$6,$7)",
    [ownerId, commandKey, configurationId, disclosureVersion, decision, requestHash, sessionId],
  );
}
export async function admissionsToday(client: PoolClient, ownerId: string) {
  const result = await client.query<{ count: number }>(
    "SELECT count(*)::int AS count FROM app.dispatch_admission WHERE owner_id=$1 AND outcome='admitted' AND created_at>=date_trunc('day',clock_timestamp())",
    [ownerId],
  );
  return result.rows[0].count;
}
export async function insertAdmission(
  client: PoolClient,
  admission: {
    id: string;
    ownerId: string;
    commandKey: string;
    configurationId: string;
    purpose: string;
    outcome: AdmissionOutcome;
    objectIds: string[];
    sessionId: string;
  },
) {
  await client.query(
    "INSERT INTO app.dispatch_admission(id,owner_id,command_key,configuration_id,purpose,outcome,object_ids,session_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
    [admission.id, admission.ownerId, admission.commandKey, admission.configurationId, admission.purpose, admission.outcome, admission.objectIds, admission.sessionId],
  );
}
export async function scopedAdmission(client: PoolClient, ownerId: string, admissionId: string) {
  const result = await client.query<AdmissionRow>(
    "SELECT * FROM app.dispatch_admission WHERE id=$1 AND owner_id=$2 FOR UPDATE",
    [admissionId, ownerId],
  );
  return result.rows[0] ?? null;
}
export async function settleAdmission(client: PoolClient, admissionId: string, outcome: AdmissionOutcome) {
  await client.query(
    "UPDATE app.dispatch_admission SET outcome=$2,settled_at=clock_timestamp() WHERE id=$1",
    [admissionId, outcome],
  );
}
