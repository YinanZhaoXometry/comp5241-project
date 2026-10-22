import type { PgBoss } from 'pg-boss';
import { uuid } from '../../contracts/setup';
import { exportJobSchema, type ExportJob, type Manifest } from '../../contracts/export';
import { transaction } from '../../adapters/postgres/database';
import * as files from '../../adapters/private-files';
import { authorize } from '../identity-access/access';
import * as lifecycle from '../lifecycle-platform/repository';
import { errorCode, fail } from '../../platform/errors';
import * as repository from './repository';
import { captureManifest } from './manifest';
import { buildArtifact } from './build';

// Content-free job envelope: no manifest, key or owner data beyond the id.
export const EXPORT_QUEUE = 'export-setup-v1';

export function exportJob(requestId: string): ExportJob {
  return { schemaVersion: 1, requestId };
}

// Single-worker maintenance window: a queued/running request older than this
// is a crashed build and fails honestly; regeneration stays explicit.
const STALE_MINUTES = 30;

export async function runExport(requestId: string, gate?: () => Promise<void>): Promise<void> {
  uuid.parse(requestId);
  const owner = await repository.requestOwner(requestId);
  if (!owner) return;
  const identity = { userId: owner.ownerId, sessionId: owner.sessionId };
  let committed = false;
  let key: string | undefined;
  let snapshotIds: string[] | undefined;
  try {
    key = (await transaction(async (client) => {
      await authorize(client, identity, owner.epoch);
      const item = await repository.requestById(client, requestId);
      if (!item || item.state !== 'queued') return null;
      await repository.setState(client, requestId, 'running');
      return lifecycle.stage(client, identity.userId);
    })) ?? undefined;
    if (!key) return;
    const artifactKey: string = key;
    const snapshot = await transaction(async (client) => {
      const principal = await authorize(client, identity, owner.epoch);
      const item = await repository.requestById(client, requestId);
      if (!item || item.state !== 'running') fail('FORBIDDEN_OR_NOT_FOUND');
      return { capture: await captureManifest(client, identity.userId), epoch: principal.epoch };
    });
    snapshotIds = snapshot.capture.objectIds;
    // Test-only injection point mirroring runExtraction's synthetic extractor:
    // holds the build in the capture-to-commit window so integration tests can
    // race deletion and revocation against the fence that must cancel them.
    // Production callers never pass it.
    if (gate) await gate();
    const built = await buildArtifact(artifactKey, requestId, identity.userId, snapshot.capture);
    const manifest: Manifest = built.manifest;
    await transaction(async (client) => {
      await authorize(client, identity, owner.epoch);
      const item = await repository.requestById(client, requestId);
      if (!item || item.state !== 'running') fail('FORBIDDEN_OR_NOT_FOUND');
      // Authoritative fence before the artifact exists: any invalidated or
      // deleted ancestor among the inventoried objects cancels the build.
      await lifecycle.assertObjects(client, identity.userId, snapshot.capture.objectIds);
      const artifactId = crypto.randomUUID();
      // The artifact is a lifecycle object whose parent_ids are the full
      // inventoried lineage, so recursive invalidation/purge covers exports.
      await client.query(
        "INSERT INTO app.lifecycle_object(id,root_id,kind,parent_ids,storage_key) VALUES($1,$2,'export',$3,$4)",
        [artifactId, requestId, snapshot.capture.objectIds, artifactKey],
      );
      await repository.setReady(client, requestId, {
        manifest,
        artifactObjectId: artifactId,
        artifactKey,
        bytes: built.bytes,
      });
      await lifecycle.unstage(client, artifactKey);
    });
    committed = true;
    key = undefined; // committed; the finally reconciliation must not erase it
  } catch (error) {
    let canceled = ['UNAUTHENTICATED', 'FORBIDDEN_OR_NOT_FOUND'].includes(errorCode(error));
    const ids = snapshotIds;
    if (!canceled && ids) {
      canceled = !(await transaction((client) => lifecycle.objectsActive(client, identity.userId, ids)).catch(() => true));
    }
    // The artifact writer's own bound message is the only resource reason.
    const reason = error instanceof Error && error.message.includes('size bound') ? 'resource' : 'service';
    await transaction((client) => repository.setTerminal(client, requestId, canceled ? 'canceled' : 'failed', canceled ? null : reason)).catch(() => {
      console.error(JSON.stringify({ event: 'export-terminal-pending', requestId }));
    });
  } finally {
    const staged = key;
    if (staged && !committed)
      await transaction(async (client) => {
        if (!(await client.query('SELECT 1 FROM app.lifecycle_object WHERE storage_key=$1', [staged])).rowCount)
          await files.erase(staged);
        await lifecycle.unstage(client, staged);
      }).catch(() => console.error(JSON.stringify({ event: 'export-staging-pending', requestId })));
  }
}

// One transaction per batch of rows; file bytes are erased after commit so a
// failed erase is retried by the next sweep (keys are nulled only on success).
export async function sweepExports(): Promise<void> {
  const expiredKeys: string[] = [];
  await transaction(async (client) => {
    const ready = await client.query<{ id: string; artifact_key: string | null }>(
      "SELECT id,artifact_key FROM app.export_request WHERE state='ready' AND expires_at<=clock_timestamp() ORDER BY created_at LIMIT 100 FOR UPDATE SKIP LOCKED",
    );
    for (const item of ready.rows) {
      await repository.expireReady(client, item.id);
      if (item.artifact_key) expiredKeys.push(item.artifact_key);
    }
    const leftovers = await client.query<{ artifact_key: string | null }>(
      "SELECT artifact_key FROM app.export_request WHERE state IN ('expired','failed','canceled') AND artifact_key IS NOT NULL ORDER BY created_at LIMIT 100 FOR UPDATE SKIP LOCKED",
    );
    for (const item of leftovers.rows) if (item.artifact_key) expiredKeys.push(item.artifact_key);
    // A crashed builder never reaches its terminal transition; record it honestly.
    await client.query(
      `UPDATE app.export_request SET state='failed',failure_reason='service',updated_at=clock_timestamp()
       WHERE state='queued' AND created_at<clock_timestamp()-interval '${STALE_MINUTES} minutes'`,
    );
    await client.query(
      `UPDATE app.export_request SET state='failed',failure_reason='service',updated_at=clock_timestamp()
       WHERE state='running' AND updated_at<clock_timestamp()-interval '${STALE_MINUTES} minutes'`,
    );
  });
  for (const key of new Set(expiredKeys)) {
    try {
      await files.erase(key);
      await transaction((client) =>
        client.query('UPDATE app.export_request SET artifact_key=NULL,artifact_bytes=NULL WHERE artifact_key=$1', [key]),
      );
    } catch {
      console.error(JSON.stringify({ event: 'export-expiry-purge-pending' }));
    }
  }
}

// One-line worker registration for src/worker/main.ts (via the integrator):
//   await workExports(boss);
// Ensures the queue registry row exists (idempotent), consumes it, and runs
// the expiry/staleness sweep on an interval that never holds shutdown open.
export async function workExports(boss: PgBoss): Promise<void> {
  await boss.createQueue(EXPORT_QUEUE);
  await boss.work<ExportJob>(EXPORT_QUEUE, { batchSize: 1, pollingIntervalSeconds: 1 }, async (jobs) => {
    for (const job of jobs) {
      const envelope = exportJobSchema.parse(job.data);
      if (envelope.requestId !== job.id) throw new Error('Invalid job identity');
      await runExport(envelope.requestId);
      console.log(JSON.stringify({ event: 'export-processed', requestId: envelope.requestId }));
    }
  });
  const sweep = setInterval(() => {
    void sweepExports().catch(() => console.error(JSON.stringify({ event: 'export-sweep-pending' })));
  }, 30000);
  sweep.unref();
}
