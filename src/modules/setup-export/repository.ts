import type { PoolClient } from 'pg';
import { database } from '../../adapters/postgres/database';
import { uuid } from '../../contracts/setup';
import { EXPORT_TTL_HOURS, type ExportReason, type ExportState, type Manifest } from '../../contracts/export';

// Every read/write of app.export_request for this module lives here. P6's
// lifecycle coordinator consumes only the two exported ports at the bottom and
// never writes this table directly.

export type RequestRow = {
  id: string;
  ownerId: string;
  sessionId: string;
  epoch: number;
  state: ExportState;
  reason: ExportReason | null;
  manifest: Manifest | null;
  manifestHash: string | null;
  artifactObjectId: string | null;
  artifactKey: string | null;
  artifactBytes: number | null;
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date | null;
};

type RequestRecord = {
  id: string;
  owner_id: string;
  session_id: string;
  epoch: number;
  state: ExportState;
  failure_reason: ExportReason | null;
  manifest: Manifest | null;
  manifest_hash: string | null;
  artifact_object_id: string | null;
  artifact_key: string | null;
  artifact_bytes: number | null;
  created_at: Date;
  updated_at: Date;
  expires_at: Date | null;
};

function materialize(record: RequestRecord): RequestRow {
  return {
    id: record.id,
    ownerId: record.owner_id,
    sessionId: record.session_id,
    epoch: record.epoch,
    state: record.state,
    reason: record.failure_reason,
    manifest: record.manifest,
    manifestHash: record.manifest_hash,
    artifactObjectId: record.artifact_object_id,
    artifactKey: record.artifact_key,
    artifactBytes: record.artifact_bytes,
    createdAt: record.created_at,
    updatedAt: record.updated_at,
    expiresAt: record.expires_at,
  };
}

export function parseRequestId(raw: string): string {
  return uuid.parse(raw);
}

// Worker-side identity lookup before any transaction is opened.
export async function requestOwner(requestId: string) {
  const found = await database().query<Pick<RequestRecord, 'owner_id' | 'session_id' | 'epoch'>>(
    'SELECT owner_id,session_id,epoch FROM app.export_request WHERE id=$1',
    [requestId],
  );
  const record = found.rows[0];
  return record ? { ownerId: record.owner_id, sessionId: record.session_id, epoch: record.epoch } : undefined;
}

export async function createRequest(
  client: PoolClient,
  value: { id: string; ownerId: string; commandKey: string; sessionId: string; epoch: number },
) {
  await client.query(
    "INSERT INTO app.export_request(id,owner_id,command_key,session_id,epoch,state) VALUES($1,$2,$3,$4,$5,'queued')",
    [value.id, value.ownerId, value.commandKey, value.sessionId, value.epoch],
  );
}

export async function requestById(client: PoolClient, requestId: string): Promise<RequestRow | undefined> {
  const found = await client.query<RequestRecord>(
    'SELECT * FROM app.export_request WHERE id=$1 FOR UPDATE',
    [requestId],
  );
  return found.rows[0] ? materialize(found.rows[0]) : undefined;
}

export async function setState(client: PoolClient, requestId: string, state: ExportState) {
  await client.query(
    'UPDATE app.export_request SET state=$2,updated_at=clock_timestamp() WHERE id=$1',
    [requestId, state],
  );
}

export async function setReady(
  client: PoolClient,
  requestId: string,
  value: { manifest: Manifest; artifactObjectId: string; artifactKey: string; bytes: number },
) {
  await client.query(
    `UPDATE app.export_request SET state='ready',manifest=$2,manifest_hash=$3,artifact_object_id=$4,artifact_key=$5,
     artifact_bytes=$6,expires_at=clock_timestamp()+($7::int * interval '1 hour'),updated_at=clock_timestamp()
     WHERE id=$1 AND state='running'`,
    [
      requestId,
      JSON.stringify(value.manifest),
      value.manifest.manifestHash,
      value.artifactObjectId,
      value.artifactKey,
      value.bytes,
      EXPORT_TTL_HOURS,
    ],
  );
}

// Terminal transition; guarded so it can never overwrite an unexpired ready
// artifact and is idempotent for repeated sweeps or retries.
export async function setTerminal(
  client: PoolClient,
  requestId: string,
  state: Extract<ExportState, 'failed' | 'expired' | 'canceled'>,
  reason: ExportReason | null,
) {
  await client.query(
    "UPDATE app.export_request SET state=$2,failure_reason=$3,updated_at=clock_timestamp() WHERE id=$1 AND state IN ('queued','running')",
    [requestId, state, reason],
  );
}

// Expiry housekeeping shared by the download path and the sweep. Marks the
// request expired and invalidates the artifact object so every recursive fence
// denies it even before the active copy is erased.
export async function expireReady(client: PoolClient, requestId: string) {
  const updated = await client.query<{ artifact_object_id: string | null }>(
    "UPDATE app.export_request SET state='expired',updated_at=clock_timestamp() WHERE id=$1 AND state='ready' AND expires_at<=clock_timestamp() RETURNING artifact_object_id",
    [requestId],
  );
  const objectId = updated.rows[0]?.artifact_object_id;
  if (objectId)
    await client.query(
      'UPDATE app.lifecycle_object SET invalidated_at=COALESCE(invalidated_at,clock_timestamp()) WHERE id=$1',
      [objectId],
    );
  return updated.rowCount === 1;
}

export async function listByOwner(client: PoolClient, ownerId: string) {
  const found = await client.query<RequestRecord>(
    'SELECT * FROM app.export_request WHERE owner_id=$1 ORDER BY created_at DESC, id LIMIT 50',
    [ownerId],
  );
  return found.rows.map(materialize);
}

// Module-owned lifecycle port: the lifecycle coordinator (S9/P6) calls this
// inside its own purge transaction; it never writes app.export_request itself.
export async function purgeExportRoots(client: PoolClient, rootIds: string[]) {
  if (!rootIds.length) return;
  await client.query(
    'DELETE FROM app.export_request WHERE id=ANY($1::uuid[]) OR artifact_object_id IN (SELECT id FROM app.lifecycle_object WHERE root_id=ANY($1::uuid[]))',
    [rootIds],
  );
}

// Module-owned lifecycle port: export lifecycle roots owned by one principal,
// used by whole-personal deletion to enumerate this derivative category.
export async function exportRootsForOwner(client: PoolClient, ownerId: string) {
  const found = await client.query<{ id: string }>(
    'SELECT id FROM app.export_request WHERE owner_id=$1',
    [ownerId],
  );
  return found.rows.map((item) => item.id);
}
