import { expect, it } from "vitest";
import { documentFormat, metadataSchema, MAX_METADATA } from "../../src/contracts/documents";
import { inputsSchema, selectionSchema } from "../../src/contracts/batches";
import { decodeExtraction } from "../../src/adapters/document-extractor";
import { MAX_BYTES } from "../../src/contracts/setup";

const command = { schemaVersion: 1, commandKey: crypto.randomUUID(), expectedRevision: 0 };
it("rejects extension/MIME disguises, archives, paths and controls", () => {
  for (const [name, mime] of [["source.pdf", "text/plain"], ["source.docx", "application/zip"], ["source.zip", "application/zip"], ["../source.txt", "text/plain"], ["bad\u0000.txt", "text/plain"]]) expect(() => documentFormat(name, mime)).toThrow();
  expect(documentFormat("source.MD", "text/markdown; charset=utf-8")).toBe("md");
});
it("validates ten-input admission including exact byte limits and duplicate identities", () => {
  const input = { slotId: crypto.randomUUID(), filename: "source.pdf", mime: "application/pdf", byteLength: MAX_BYTES };
  expect(inputsSchema.safeParse({ ...command, inputs: [input] }).success).toBe(true);
  for (const inputs of [[{ ...input, byteLength: MAX_BYTES + 1 }], Array.from({ length: 11 }, () => ({ ...input, slotId: crypto.randomUUID() })), [input, input]]) expect(inputsSchema.safeParse({ ...command, inputs }).success).toBe(false);
});
it("requires explicit acknowledgment and disjoint selected/excluded slots", () => {
  const source = { slotId: crypto.randomUUID(), extractionId: crypto.randomUUID(), acknowledged: true };
  expect(selectionSchema.safeParse({ ...command, selected: [source], excluded: [] }).success).toBe(true);
  for (const value of [{ selected: [{ ...source, acknowledged: false }], excluded: [] }, { selected: [source], excluded: [{ slotId: source.slotId, state: "preview" }] }, { selected: [], excluded: [] }]) expect(selectionSchema.safeParse({ ...command, ...value }).success).toBe(false);
});
it("rejects malformed, oversized and out-of-range parser frames rather than truncated success", () => {
  const huge = Buffer.alloc(4); huge.writeUInt32BE(MAX_METADATA + 1);
  expect(() => decodeExtraction(huge)).toThrow();
  expect(() => decodeExtraction(Buffer.alloc(3))).toThrow();
  const metadata = { format: "txt", parser: "bounded-documents-v2", warnings: [], locations: [{ unit: "lines", source: "source", first: 1, last: 1, start: 0, end: 200 }] };
  const header = Buffer.from(JSON.stringify({ status: "ok", metadata })); const size = Buffer.alloc(4); size.writeUInt32BE(header.length);
  expect(() => decodeExtraction(Buffer.concat([size, header, Buffer.from("short")]))).toThrow();
  expect(metadataSchema.safeParse({ ...metadata, locations: [{ ...metadata.locations[0], first: 2, last: 1 }] }).success).toBe(false);
});