import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import {
  MAX_EXPORT_BYTES,
  exportCategoryLabels,
  exportCategories,
  exportRequestSchema,
  type ExportCategory,
  type ExportCategoryInfo,
  type ExportCommand,
  type ExportPreview,
  type ExportSummary,
} from '../../contracts/export';
import { transaction } from '../../adapters/postgres/database';
import * as files from '../../adapters/private-files';
import { transactionQueue, transactionDb } from '../../adapters/queue';
import { privateHeaders } from '../../platform/http';
import { fail } from '../../platform/errors';
import { authorize } from '../identity-access/access';
import * as lifecycle from '../lifecycle-platform/repository';
import { parse, requestHash } from '../../platform/commands';
import { EXPORT_QUEUE, exportJob } from './worker';
import * as repository from './repository';
import { activeCounts, tablePresent } from './manifest';

const MAX_ACTIVE_REQUESTS = 3;

// U7: scope and included derivative categories are shown before any request.
export async function listExports(identity: { userId: string; sessionId: string }): Promise<ExportPreview> {
  return transaction(async (client) => {
    await authorize(client, identity);
    const counts = await activeCounts(client, identity.userId);
    const objectCounts: Partial<Record<ExportCategory, number>> = {
      originals: counts.originals,
      extractions: counts.extractions,
      selections: counts.selections,
      plans: counts.plans,
      confirmations: counts.confirmations,
    };
    const categories: ExportCategoryInfo[] = [];
    for (const category of exportCategories) {
      const label = exportCategoryLabels[category];
      const direct = objectCounts[category];
      if (direct !== undefined) {
        categories.push({ category, label, count: direct, available: true });
        continue;
      }
      const table =
        category === 'processing-decisions'
          ? 'processing_decision'
          : category === 'dispatch-admissions'
            ? 'dispatch_admission'
            : category === 'diagnostic-evidence'
              ? 'diagnostic_evidence'
              : category === 'ai-drafts'
                ? 'ai_draft_request'
                : category === 'generated-courses'
                  ? 'generated_course'
                  : category === 'supplements'
                    ? 'course_supplement'
                    : null;
      const present = table ? await tablePresent(client, table) : false;
      if (category === 'ai-drafts' || category === 'generated-courses' || category === 'supplements') {
        categories.push(
          present
            ? { category, label, count: null, available: true, note: 'Present; deliberately excluded from the artifact — see the manifest skip note' }
            : { category, label, count: null, available: false, note: 'Not present in this deployment' },
        );
        continue;
      }
      categories.push(
        present
          ? { category, label, count: null, available: true, note: 'Present; exact counts appear in the export manifest' }
          : { category, label, count: null, available: false, note: 'Not present in this deployment' },
      );
    }
    const requests: ExportSummary[] = (await repository.listByOwner(client, identity.userId)).map((item) => ({
      id: item.id,
      state: item.state,
      createdAt: item.createdAt.toISOString(),
      expiresAt: item.expiresAt ? item.expiresAt.toISOString() : null,
      bytes: item.artifactBytes,
      manifestHash: item.manifestHash,
      reason: item.reason,
    }));
    return { categories, requests };
  });
}

export async function requestExport(identity: { userId: string; sessionId: string }, raw: unknown) {
  const command = parse<ExportCommand>(exportRequestSchema, raw);
  if (command.expectedRevision !== 0) fail('CONFLICT');
  return transaction(async (client) => {
    const principal = await authorize(client, identity);
    const hash = requestHash(command);
    // Duplicate command (same commandKey) replays one receipt: one artifact.
    const repeated = await lifecycle.replay(client, identity.userId, command, 'request-export', hash);
    if (repeated) return repeated;
    const active = await client.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM app.export_request WHERE owner_id=$1 AND state IN ('queued','running')",
      [identity.userId],
    );
    if (active.rows[0].count >= MAX_ACTIVE_REQUESTS) fail('RATE_LIMITED');
    const requestId = crypto.randomUUID();
    await lifecycle.createRoot(client, identity.userId, requestId);
    await repository.createRequest(client, {
      id: requestId,
      ownerId: identity.userId,
      commandKey: command.commandKey,
      sessionId: identity.sessionId,
      epoch: principal.epoch,
    });
    await transactionQueue(client).send(EXPORT_QUEUE, exportJob(requestId), {
      db: transactionDb(client),
      id: requestId,
      retryLimit: 0,
      expireInSeconds: 600,
      retentionSeconds: 86400,
    });
    return lifecycle.receipt(client, identity, command, 'request-export', hash, {
      rootId: requestId,
      operationId: requestId,
      revision: 0,
      state: 'queued',
    });
  });
}

export type DownloadInfo = { requestId: string; key: string; objectId: string; bytes: number };

// Resolves the artifact only after fresh authorization, then hands a
// streaming Response whose every chunk re-runs session/owner/fence checks.
export async function downloadExport(identity: { userId: string; sessionId: string }, rawId: string, signal: AbortSignal): Promise<Response> {
  const requestId = repository.parseRequestId(rawId);
  // The expiry write must COMMIT before the denial fails: a fail() thrown in
  // this transaction would roll the expireReady update back.
  const outcome = await transaction(async (client) => {
    await authorize(client, identity);
    const item = await repository.requestById(client, requestId);
    if (!item || item.ownerId !== identity.userId) fail('FORBIDDEN_OR_NOT_FOUND');
    if (item.state === 'ready' && item.expiresAt && item.expiresAt.getTime() <= Date.now()) {
      await repository.expireReady(client, requestId);
      return { expired: true as const, key: item.artifactKey };
    }
    return {
      expired: false as const,
      key: item.artifactKey,
      objectId: item.artifactObjectId,
      bytes: item.artifactBytes,
      state: item.state,
    };
  });
  if (outcome.expired) {
    // An expired copy is erased immediately at the denial; if this erase fails
    // the sweep's leftover pass retries (the row keeps its artifact_key until then).
    if (outcome.key) await files.erase(outcome.key).catch(() => console.error(JSON.stringify({ event: 'export-expiry-purge-pending' })));
    fail('FORBIDDEN_OR_NOT_FOUND');
  }
  if (outcome.state !== 'ready' || !outcome.key || !outcome.objectId || !outcome.bytes)
    fail('FORBIDDEN_OR_NOT_FOUND');
  const info = { key: outcome.key, objectId: outcome.objectId, bytes: outcome.bytes };
  const handle = await open(await files.objectPath(info.key), constants.O_RDONLY | constants.O_NOFOLLOW);
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    await handle.close();
  };
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || !stat.size || stat.size > MAX_EXPORT_BYTES) fail('INVALID_INPUT');
    const CHUNK = 65536;
    let offset = 0;
    return new Response(
      new ReadableStream<Uint8Array>({
        async pull(controller) {
          try {
            if (signal.aborted) {
              await close();
              controller.close();
              return;
            }
            // Fresh reauthorization per chunk: session, ownership and lineage fences.
            await transaction(async (client) => {
              await authorize(client, identity);
              await lifecycle.scopedRoot(client, identity.userId, requestId);
              await lifecycle.assertObjects(client, identity.userId, [info.objectId]);
            });
            if (offset >= stat.size) {
              await close();
              controller.close();
              return;
            }
            const length = Math.min(CHUNK, stat.size - offset);
            const buffer = new Uint8Array(length);
            const read = await handle.read(buffer, 0, length, offset);
            offset += read.bytesRead;
            controller.enqueue(buffer.subarray(0, read.bytesRead));
          } catch {
            await close().catch(() => undefined);
            controller.error(new Error('This item is unavailable'));
          }
        },
        cancel() {
          void close().catch(() => undefined);
        },
      }, { highWaterMark: 0 }),
      {
        headers: {
          ...privateHeaders,
          'Content-Type': 'application/gzip',
          'Content-Disposition': 'attachment; filename="personal-setup-export.tar.gz"',
          'Content-Security-Policy': "sandbox; default-src 'none'",
        },
      },
    );
  } catch (error) {
    await close();
    throw error;
  }
}
