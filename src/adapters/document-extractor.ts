import { z } from "zod";
import { MAX_BYTES } from "../contracts/setup";
import { metadataSchema, MAX_METADATA, reasons, type Format, type ExtractionReason } from "../contracts/documents";
import { admittedParser, sandbox } from "./document-sandbox";

export function extractionFailure(reason: ExtractionReason) { return Object.assign(new Error(`Document extraction rejected: ${reason}`), { reason }); }
export function decodeExtraction(bytes: Buffer) {
  if (bytes.length < 4) throw extractionFailure("service");
  const length = bytes.readUInt32BE();
  if (length > MAX_METADATA || bytes.length < 4 + length || bytes.length > 4 + length + MAX_BYTES) throw extractionFailure("resource");
  const header: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(4, 4 + length)));
  const rejected = z.strictObject({ status: z.literal("rejected"), reason: z.enum(reasons) }).safeParse(header);
  if (rejected.success) throw extractionFailure(rejected.data.reason);
  const value = z.strictObject({ status: z.literal("ok"), metadata: metadataSchema }).parse(header);
  const textBytes = bytes.subarray(4 + length);
  const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(textBytes);
  if (!text.trim() || value.metadata.locations.some(location => location.end > textBytes.length)) throw extractionFailure("service");
  return { text, metadata: value.metadata };
}
export async function parserReady() { await admittedParser(); }
let tail: Promise<void> = Promise.resolve();
export async function extractDocument(input: Buffer, format: Format) {
  if (!input.length || input.length > MAX_BYTES) throw extractionFailure("resource");
  // One active parser per worker, including direct/test invocations.
  const previous = tail; let release!: () => void;
  tail = new Promise<void>(resolve => { release = resolve; });
  await previous;
  try {
    const pin = await admittedParser();
    const result = decodeExtraction(await sandbox(pin.image, [format], input));
    if (result.metadata.format !== format) throw extractionFailure("service");
    if ((format === "txt" || format === "md") && !Buffer.from(result.text).equals(input)) throw extractionFailure("service");
    return result;
  } finally { release(); }
}