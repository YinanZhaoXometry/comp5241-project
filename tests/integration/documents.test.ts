import { describe, expect, it } from "vitest";
import { extractDocument, parserReady, decodeExtraction } from "../../src/adapters/document-extractor";
import { MAX_BYTES } from "../../src/contracts/setup";
import { docx, pdf, atLimitDocx, zip } from "../fixtures/documents";
import { admittedParser, sandbox } from "../../src/adapters/document-sandbox";

describe("real isolated four-format parser", () => {
  it("requires a verified fixed sandbox, not a native fallback", async () => { await expect(parserReady()).resolves.toBeUndefined(); });
  it("provides outside-process container observations for hostile documents before proving cleanup", async () => {
    const pin = await admittedParser(); const observations: unknown[] = [];
    const bytes = await sandbox(pin.image, ["docx"], docx([{ name: "../../escape", content: "synthetic" }]), 30000, async value => { observations.push(value); });
    expect(() => decodeExtraction(bytes)).toThrow();
    expect(observations).toEqual([expect.objectContaining({ networkMode: "none", mountCount: 0, readonly: true, memoryLimit: 536870912, memorySwap: 536870912, changedPaths: [], removed: true })]);
  });
  for (const [format, bytes] of [["txt", Buffer.alloc(MAX_BYTES, 65)], ["md", Buffer.concat([Buffer.from("# Sample\n"), Buffer.alloc(MAX_BYTES - 9, 10)])], ["pdf", pdf(true)], ["docx", atLimitDocx()]] as const) {
    it(`extracts an exact-20MiB readable ${format} without truncation and with bounded locations`, async () => {
      expect(bytes.length).toBe(MAX_BYTES);
      const result = await extractDocument(bytes, format);
      expect(result.text.trim().length).toBeGreaterThan(0);
      expect(Buffer.byteLength(JSON.stringify(result.metadata))).toBeLessThanOrEqual(256 * 1024);
      expect(result.metadata.locations.length).toBeGreaterThan(0);
      if (format === "txt" || format === "md") expect(Buffer.from(result.text).equals(bytes)).toBe(true);
    }, 60000);
  }
  for (const [label, bytes, reason] of [
    ["traversal", docx([{ name: "../../escaped", content: "forbidden" }]), "unsafe"],
    ["symlink", docx([{ name: "word/link", content: "/etc/passwd", mode: 0o120777 }]), "unsafe"],
    ["duplicate", docx([{ name: "word/document.xml", content: "duplicate" }]), "unsafe"],
    ["external link", docx([{ name: "word/_rels/document.xml.rels", content: '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r1" TargetMode="External" Target="http://127.0.0.1:9/private" Type="hyperlink"/></Relationships>' }]), "unsafe"],
    ["XXE", docx([], '<!DOCTYPE w [<!ENTITY x SYSTEM "file:///etc/passwd">]><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">&x;</w:document>'), "unsafe"],
    ["macro", docx([{ name: "word/vbaProject.bin", content: "macro" }]), "unsafe"],
    ["bomb", docx([{ name: "word/bomb", content: Buffer.alloc(33 * 1024 * 1024, 65), compressed: true }]), "resource"],
    ["archive", zip([{ name: "readme.txt", content: "not a document" }]), "unsupported"],
    ["encrypted ZIP", docx([{ name: "word/secret", content: "synthetic", flags: 1 }]), "protected"],
    ["entry count", docx(Array.from({ length: 2047 }, (_, i) => ({ name: `word/${i}`, content: "" }))), "resource"],
    ["aggregate expansion", docx([0, 1, 2].map(i => ({ name: `word/large-${i}`, content: Buffer.alloc(24 * 1024 * 1024, 65), compressed: true }))), "resource"],
    ["malformed XML", docx([], "<broken>"), "corrupt"],
  ] as const) it(`rejects DOCX ${label} with no usable output`, async () => { await expect(extractDocument(bytes, "docx")).rejects.toMatchObject({ reason }); });
  it("rejects no-text/corrupt PDF and preserves literal Markdown without fetching", async () => {
    await expect(extractDocument(pdf(false, ""), "pdf")).rejects.toMatchObject({ reason: "no-text" });
    await expect(extractDocument(Buffer.from("%PDF-1.4\nbroken"), "pdf")).rejects.toMatchObject({ reason: "corrupt" });
    const literal = "# Sample\n![not fetched](http://127.0.0.1:9/image)\n<script>not executed</script>";
    expect((await extractDocument(Buffer.from(literal), "md")).text).toBe(literal);
  });
  it("rejects empty-password encrypted PDF without decrypting", async () => {
    const pin = await admittedParser(); const encrypted = await sandbox(pin.image, ["--probe", "encrypted-pdf"]);
    await expect(extractDocument(encrypted, "pdf")).rejects.toMatchObject({ reason: "protected" });
  });
  it("rejects disguised bytes, invalid UTF-8, no-text and oversize input with safe reasons", async () => {
    await expect(extractDocument(pdf(), "txt")).rejects.toMatchObject({ reason: "unsupported" });
    await expect(extractDocument(Buffer.from([255]), "txt")).rejects.toMatchObject({ reason: "corrupt" });
    await expect(extractDocument(Buffer.from(" \n"), "txt")).rejects.toMatchObject({ reason: "no-text" });
    await expect(extractDocument(Buffer.alloc(MAX_BYTES + 1), "pdf")).rejects.toMatchObject({ reason: "resource" });
  });
});