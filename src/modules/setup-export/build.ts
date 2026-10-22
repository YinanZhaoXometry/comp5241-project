import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { createReadStream } from 'node:fs';
import { open } from 'node:fs/promises';
import { Transform, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGzip } from 'node:zlib';
import { Readable } from 'node:stream';
import * as files from '../../adapters/private-files';
import { requestHash } from '../materials-setup/service';
import {
  MAX_EXPORT_BYTES,
  canonical,
  type Manifest,
  type ManifestEntry,
} from '../../contracts/export';
import { jsonEntry, tarStream, type TarEntry } from './tar';
import type { Capture } from './manifest';

// Builds the deterministic manifest and writes the tar.gz artifact to the
// staged private-storage key. Runs entirely outside any database transaction;
// storage objects are immutable, so file hashes captured here match the keys
// pinned by the manifest snapshot. Deletions that remove a source file mid-
// build surface as ENOENT and are turned into an honest cancel/fail upstream.

async function* fileChunks(path: string): AsyncGenerator<Uint8Array> {
  const stream = createReadStream(path, { highWaterMark: 1024 * 1024 });
  for await (const chunk of stream) {
    if (typeof chunk === 'string') throw new Error('Unexpected decoded chunk');
    yield chunk;
  }
}

async function hashFile(path: string) {
  const hash = createHash('sha256');
  let bytes = 0;
  for await (const chunk of fileChunks(path)) {
    bytes += chunk.length;
    hash.update(chunk);
  }
  return { sha256: hash.digest('hex'), bytes };
}

export async function buildArtifact(
  key: string,
  requestId: string,
  ownerId: string,
  capture: Capture,
): Promise<{ manifest: Manifest; bytes: number; sha256: string }> {
  const hashes = new Map<string, { sha256: string; bytes: number }>();
  for (const file of capture.files)
    hashes.set(file.objectId, await hashFile(await files.objectPath(file.key)));
  const entries: ManifestEntry[] = capture.entries.map((entry) => {
    const hash = hashes.get(entry.objectId);
    return hash ? { ...entry, sha256: hash.sha256, bytes: hash.bytes } : entry;
  });
  const manifestHash = requestHash(canonical({ requestId, capturedAt: capture.capturedAt, entries, skipped: capture.skipped }));
  const manifest: Manifest = {
    schemaVersion: 1,
    requestId,
    ownerId,
    capturedAt: capture.capturedAt,
    manifestHash,
    entries,
    skipped: capture.skipped,
  };
  const tarEntries: TarEntry[] = [
    jsonEntry('manifest.json', manifest),
    ...(await Promise.all(
      capture.files.map(async (file): Promise<TarEntry> => {
        const hash = hashes.get(file.objectId);
        if (!hash) throw new Error('Missing file hash');
        const extension = file.category === 'extractions' ? 'txt' : 'bin';
        return {
          name: `${file.category}/${file.objectId}.${extension}`,
          size: hash.bytes,
          chunks: fileChunks(await files.objectPath(file.key)),
        };
      }),
    )),
    ...capture.payloads.map((payload) => jsonEntry(payload.name, payload.value)),
  ];
  const path = await files.objectPath(key);
  const handle = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try {
    let bytes = 0;
    const sha256 = createHash('sha256');
    const meter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        bytes += chunk.length;
        if (bytes > MAX_EXPORT_BYTES) {
          callback(new Error('Export artifact exceeds the local size bound'));
          return;
        }
        sha256.update(chunk);
        callback(null, chunk);
      },
    });
    // The sink writes through the handle like private-files.store does. The
    // FileHandle stream APIs are unusable here: with autoClose the fd closes
    // out from under sync(), and with autoClose:false close() never settles.
    const sink = new Writable({
      async write(chunk: Buffer, _encoding, callback) {
        try {
          await handle.writeFile(chunk);
          callback();
        } catch (error) { callback(error instanceof Error ? error : new Error(String(error))); }
      },
      final(callback) {
        handle.sync().then(
          () => callback(),
          (error: Error) => callback(error),
        );
      },
    });
    await pipeline(Readable.from(tarStream(tarEntries)), createGzip(), meter, sink);
    return { manifest, bytes, sha256: sha256.digest('hex') };
  } finally {
    await handle.close();
  }
}
