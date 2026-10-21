import { mkdir, open, readFile, unlink, realpath, lstat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { constants } from "node:fs";
import { createHash } from "node:crypto";
import { MAX_BYTES, uuid, validateText, hasControl, disguisedBinary } from "../contracts/setup";
import { config } from "../platform/config";
import { fail } from "../platform/errors";

export async function objectPath(key: string) {
  uuid.parse(key);
  const root = config().storagePath;
  await mkdir(root, { recursive: true, mode: 0o700 });
  const info = await lstat(root);
  if (info.isSymbolicLink() || (info.mode & 0o077) || (await realpath(root)) !== resolve(root)) throw new Error("Private storage permissions invalid");
  return join(root, key);
}
export async function store(key: string, input: ReadableStream<Uint8Array>) {
  const file = await open(await objectPath(key), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  const reader = input.getReader();
  let timedOut = false;
  const timeout = setTimeout(() => { timedOut = true; void reader.cancel(); }, 30000);
  timeout.unref();
  const hash = createHash("sha256");
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let length = 0;
  let nonWhitespace = false;
  let prefix = "";
  try {
    while (true) {
      const item = await reader.read();
      if (item.done) break;
      length += item.value.length;
      if (length > MAX_BYTES) fail("INVALID_INPUT");
      const text = decoder.decode(item.value, { stream: true });
      nonWhitespace ||= !!text.trim();
      prefix = (prefix + text).slice(0, 5);
      if (hasControl(text)) fail("INVALID_INPUT");
      hash.update(item.value);
      await file.writeFile(item.value);
    }
    const tail = decoder.decode();
    nonWhitespace ||= !!tail.trim();
    if (timedOut || !nonWhitespace || !length || disguisedBinary(prefix)) fail("INVALID_INPUT");
    await file.sync();
    return { length, hash: hash.digest("hex") };
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    if (error instanceof TypeError) fail("INVALID_INPUT");
    throw error;
  } finally { clearTimeout(timeout); reader.releaseLock(); await file.close(); }
}
export async function read(key: string) {
  const file = await open(await objectPath(key), constants.O_RDONLY | constants.O_NOFOLLOW);
  try { const size = (await file.stat()).size; if (size > MAX_BYTES) fail("INVALID_INPUT"); return validateText(await file.readFile()); }
  finally { await file.close(); }
}
export async function erase(key: string) {
  try { await unlink(await objectPath(key)); } catch (error) { if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw error; }
}
export async function extractorExists() { await readFile(config().extractorPath); }