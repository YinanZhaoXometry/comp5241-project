// Minimal deterministic ustar writer for the export artifact. No new npm
// dependency: entries are streamed as 512-byte-framed sections and gzipped by
// the caller. Entry names are server-generated identities (object UUIDs), so
// document filenames never become archive paths.
const encoder = new TextEncoder();

function octal(value: number, width: number): string {
  const text = value.toString(8);
  if (text.length > width - 1) throw new Error('Tar field out of range');
  return `${text.padStart(width - 1, '0')}\0`;
}

export function ustarHeader(name: string, size: number): Uint8Array {
  if (!name.length || name.length > 100 || name.includes('\0'))
    throw new Error('Tar entry name invalid');
  const header = new Uint8Array(512);
  const write = (text: string, offset: number) =>
    header.set(encoder.encode(text), offset);
  write(name, 0);
  write(octal(0o644, 8), 100); // mode
  write(octal(0, 8), 108); // uid
  write(octal(0, 8), 116); // gid
  write(octal(size, 12), 124); // size
  write(octal(0, 12), 136); // mtime pinned to 0 for deterministic bytes
  write('        ', 148); // checksum placeholder (eight spaces)
  write('0', 156); // typeflag: regular file
  write('ustar\0', 257); // magic
  write('00', 263); // version
  let sum = 0;
  for (const byte of header) sum += byte;
  write(`${sum.toString(8).padStart(6, '0')}\0 `, 148);
  return header;
}

export type TarEntry = {
  name: string;
  size: number;
  chunks: AsyncIterable<Uint8Array>;
};

export async function* tarStream(
  entries: readonly TarEntry[],
): AsyncGenerator<Uint8Array> {
  for (const entry of entries) {
    yield ustarHeader(entry.name, entry.size);
    let written = 0;
    for await (const chunk of entry.chunks) {
      written += chunk.length;
      if (written > entry.size) throw new Error('Tar entry exceeded declared size');
      yield chunk;
    }
    if (written !== entry.size) throw new Error('Tar entry size mismatch');
    const padding = (512 - (entry.size % 512)) % 512;
    if (padding) yield new Uint8Array(padding);
  }
  yield new Uint8Array(1024); // two zero blocks terminate the archive
}

export function jsonEntry(name: string, value: unknown): TarEntry {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  return {
    name,
    size: bytes.length,
    chunks: (async function* () {
      yield bytes;
    })(),
  };
}
