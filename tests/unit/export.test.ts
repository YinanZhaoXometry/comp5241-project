import { createGzip, gunzipSync } from 'node:zlib';
import { Readable } from 'node:stream';
import { arrayBuffer } from 'node:stream/consumers';
import { describe, expect, it } from 'vitest';
import { ustarHeader, tarStream, jsonEntry, type TarEntry } from '../../src/modules/setup-export/tar';
import { canonical, exportRequestSchema, exportJobSchema, exportCategories, MAX_EXPORT_BYTES } from '../../src/contracts/export';
import { requestHash } from '../../src/platform/commands';

// Synthetic decoder: verifies the exact ustar framing this module writes.
function decodeTar(input: Uint8Array) {
  const bytes = new Uint8Array(input); // copy so Buffer vs Uint8Array asserts agree
  const entries: { name: string; size: number; content: Uint8Array; checksum: string }[] = [];
  let offset = 0;
  while (offset < bytes.length) {
    const block = bytes.subarray(offset, offset + 512);
    offset += 512;
    if (block.every(byte => byte === 0)) break;
    expect(block.subarray(257, 263)).toEqual(new TextEncoder().encode('ustar\0'));
    const name = new TextDecoder().decode(block.subarray(0, 100)).replace(/\0.*$/u, '');
    const sizeField = new TextDecoder().decode(block.subarray(124, 136)).replace(/\0.*/u, '').trim();
    const size = parseInt(sizeField, 8);
    const stored = new TextDecoder().decode(block.subarray(148, 156));
    let sum = 0;
    for (let index = 0; index < 512; index += 1)
      sum += index >= 148 && index < 156 ? 32 : block[index];
    expect(`${sum.toString(8).padStart(6, '0')}\0 `).toBe(stored);
    const padding = (512 - (size % 512)) % 512;
    const content = bytes.subarray(offset, offset + size);
    offset += size + padding;
    entries.push({ name, size, content, checksum: stored });
  }
  expect(bytes.length - offset).toBe(512); // one zero block remains after the first
  expect(bytes.subarray(offset).every(byte => byte === 0)).toBe(true);
  return entries;
}

const text = new TextEncoder();

describe('ustar writer', () => {
  it('frames entries exactly and terminates with two zero blocks', async () => {
    const entries: TarEntry[] = [
      jsonEntry('manifest.json', { schemaVersion: 1, requestId: 'synthetic' }),
      { name: 'originals/11111111-1111-4111-8111-111111111111.bin', size: 5, chunks: (async function* () { yield text.encode('hello'); })() },
      { name: 'extractions/22222222-2222-4222-8222-222222222222.txt', size: 600, chunks: (async function* () { yield text.encode('a'.repeat(600)); })() },
    ];
    const bytes = new Uint8Array(await arrayBuffer(Readable.from(tarStream(entries))));
    const decoded = decodeTar(bytes);
    expect(decoded.map(item => item.name)).toEqual([
      'manifest.json',
      'originals/11111111-1111-4111-8111-111111111111.bin',
      'extractions/22222222-2222-4222-8222-222222222222.txt',
    ]);
    expect(new TextDecoder().decode(decoded[0].content)).toBe('{"schemaVersion":1,"requestId":"synthetic"}');
    expect(new TextDecoder().decode(decoded[1].content)).toBe('hello');
    expect(decoded[2].size).toBe(600);
  });

  it('gzips and restores the exact archive bytes', async () => {
    // Entries are single-use iterables, so each stream gets a fresh archive.
    const makeEntries = (): TarEntry[] => [jsonEntry('plans/a.json', { plan: 'synthetic' })];
    const compressed = new Uint8Array(await arrayBuffer(Readable.from(Readable.from(tarStream(makeEntries())).pipe(createGzip()))));
    expect(compressed[0]).toBe(0x1f);
    expect(compressed[1]).toBe(0x8b);
    const restored = gunzipSync(compressed);
    const direct = new Uint8Array(await arrayBuffer(Readable.from(tarStream(makeEntries()))));
    expect([...restored]).toEqual([...direct]);
    decodeTar(restored);
  });

  it('rejects size drift and hostile names instead of writing a lying archive', async () => {
    const drifted: TarEntry = { name: 'x.json', size: 10, chunks: (async function* () { yield text.encode('short'); })() };
    await expect(async () => { for await (const chunk of tarStream([drifted])) expect(chunk.length).toBeGreaterThan(0); }).rejects.toThrow('size mismatch');
    const overflow: TarEntry = { name: 'x.json', size: 1, chunks: (async function* () { yield text.encode('toolarge'); })() };
    await expect(async () => { for await (const chunk of tarStream([overflow])) expect(chunk.length).toBeGreaterThan(0); }).rejects.toThrow('exceeded declared size');
    expect(() => ustarHeader(`${'n'.repeat(101)}`, 0)).toThrow('name invalid');
    expect(() => ustarHeader('ok.json', Number.MAX_SAFE_INTEGER)).toThrow('out of range');
  });
});

describe('export contracts', () => {
  it('accepts exactly the zero-revision command shape and rejects the rest', () => {
    const valid = { schemaVersion: 1, commandKey: crypto.randomUUID(), expectedRevision: 0 };
    expect(exportRequestSchema.safeParse(valid).success).toBe(true);
    for (const value of [
      { ...valid, schemaVersion: 2 },
      { ...valid, expectedRevision: 1 },
      { ...valid, commandKey: 'not-a-uuid' },
      { ...valid, extra: true },
      { schemaVersion: 1, commandKey: crypto.randomUUID() },
    ])
      expect(exportRequestSchema.safeParse(value).success).toBe(false);
    expect(exportJobSchema.safeParse({ schemaVersion: 1, requestId: crypto.randomUUID() }).success).toBe(true);
    expect(exportJobSchema.safeParse({ schemaVersion: 1, requestId: crypto.randomUUID(), extra: 1 }).success).toBe(false);
    // S6 added the advisory 'ai-drafts' category, epic-2 S1 added
    // 'generated-courses', epic-2 S2 added 'supplements', epic-2 S5 added
    // 'practice-evidence' and epic-2 S6 added 'why-explanations' (all five
    // deliberately excluded from the artifact; listed so owners see the
    // exclusion).
    expect(exportCategories).toHaveLength(13);
    expect(MAX_EXPORT_BYTES).toBe(512 * 1024 * 1024);
  });

  it('hashes the manifest deterministically regardless of key order', () => {
    const entries = [
      { category: 'originals', objectId: 'b', rootId: 'r', storageKey: null, parents: [], createdAt: '2026-10-22T00:00:00.000Z' },
      { category: 'originals', objectId: 'a', rootId: 'r', storageKey: null, parents: [], createdAt: '2026-10-22T00:00:00.000Z' },
    ];
    const skipped = [{ category: 'processing-decisions', reason: 'not present' }];
    const snapshot = { requestId: 'x', capturedAt: 't', entries, skipped };
    expect(requestHash(canonical(snapshot))).toBe(requestHash(canonical(snapshot)));
    // jsonb round-trips reorder keys; the canonical form must not care.
    const reordered = JSON.parse(JSON.stringify({ entries: [{ objectId: 'b', category: 'originals', rootId: 'r', parents: [], storageKey: null, createdAt: '2026-10-22T00:00:00.000Z' }, entries[1]], requestId: 'x', capturedAt: 't', skipped: [{ reason: 'not present', category: 'processing-decisions' }] }));
    expect(requestHash(canonical(reordered))).toBe(requestHash(canonical(snapshot)));
    expect(requestHash(canonical(snapshot))).not.toBe(requestHash(canonical({ ...snapshot, requestId: 'y' })));
  });
});
