import { describe, expect, it } from "vitest";
import { docker, sandbox } from "../../src/adapters/document-sandbox";
import { decodeExtraction } from "../../src/adapters/document-extractor";
import { docx, pdf, wordXml, zip } from "../fixtures/documents";

async function candidate() {
  return (await docker(["image", "inspect", "comp5241-bounded-parser:local", "--format", "{{.Id}}"])).toString().trim();
}
const types = '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>';
function encoded(xml: string) {
  return zip([{ name: "[Content_Types].xml", content: types }, { name: "word/document.xml", content: Buffer.concat([Buffer.from([255, 254]), Buffer.from(xml.replace('<?xml version="1.0"?>', '<?xml version="1.0" encoding="UTF-16"?>'), "utf16le")]) }]);
}

describe("non-Expat parser candidate", () => {
  it("disables XMP before decoding or parsing and still imports the PDF reader/writer", async () => {
    const result = JSON.parse((await sandbox(await candidate(), ["--probe", "xmp-policy"])).toString());
    expect(result).toEqual({ constructorBlocked: true, createBlocked: true, readerBlocked: true, writerBlocked: true, dictionaryBlocked: true, dataRead: false, expatImportable: false, expatLoaded: false });
    expect(decodeExtraction(await sandbox(await candidate(), ["pdf"], pdf())).text).toBe("Synthetic PDF testing\n");
  });
  it("loads the assessed native stack with no Expat import or loaded library", async () => {
    const versions = JSON.parse((await sandbox(await candidate(), ["--probe", "versions"])).toString());
    expect(versions).toMatchObject({ python: "3.14.8", pypdf: "6.21.1", lxml: "6.1.3", libxml: "2.15.4", libxmlCompiled: "2.15.4", libxslt: "1.1.45", libxsltCompiled: "1.1.45", expatImportable: false, expatLoaded: false });
    expect(versions.features).not.toEqual(expect.arrayContaining(["catalog"]));
    expect(versions.features).not.toEqual(expect.arrayContaining(["http"]));
    expect(versions.features).not.toEqual(expect.arrayContaining(["ftp"]));
  });
  it("extracts only page text, never valid, malformed, entity-bearing or highly compressed XMP", async () => {
    for (const bytes of [Buffer.from('<x:xmpmeta xmlns:x="adobe:ns:meta/"/>'), Buffer.from("<broken>"), Buffer.from('<!DOCTYPE x [<!ENTITY secret SYSTEM "file:///host/.local/runtime-config.json">]><x>&secret;</x>'), Buffer.alloc(33 * 1024 * 1024, 65)]) {
      const metadata = { bytes, compressed: true };
      expect(decodeExtraction(await sandbox(await candidate(), ["pdf"], pdf(false, undefined, metadata))).text).toBe("Synthetic PDF testing\n");
      const empty = await sandbox(await candidate(), ["pdf"], pdf(false, "", metadata));
      expect(JSON.parse(empty.subarray(4, 4 + empty.readUInt32BE(0)).toString())).toEqual({ status: "rejected", reason: "no-text" });
    }
  });
  it("preserves UTF-16, strict Word namespaces, escaped characters, CDATA and paragraph locations", async () => {
    const xml = wordXml.replaceAll("http://schemas.openxmlformats.org/wordprocessingml/2006/main", "http://purl.oclc.org/ooxml/wordprocessingml/main").replace("Synthetic document testing", "A &amp; B <![CDATA[<literal>]]> 学習");
    const result = decodeExtraction(await sandbox(await candidate(), ["docx"], encoded(xml)));
    expect(result.text).toBe("A & B <literal> 学習\n");
    expect(result.metadata.locations).toEqual([{ unit: "paragraph", source: "word/document.xml", first: 1, last: 1, start: 0, end: Buffer.byteLength(result.text) }]);
  });
  it("rejects UTF-16 DTDs, parameter entities, PIs and XInclude without external resources or filesystem changes", async () => {
    for (const xml of [
      wordXml.replace("<w:document", '<!DOCTYPE w:document SYSTEM "file:///host/.local/runtime-config.json"><w:document'),
      wordXml.replace("<w:document", '<!DOCTYPE w:document [<!ENTITY % remote SYSTEM "http://127.0.0.1:9/private">%remote;]><w:document'),
      wordXml.replace("<w:document", '<?xml-stylesheet href="file:///host/.local/runtime-config.json"?><w:document'),
      wordXml.replace("<w:body>", '<w:body><xi:include xmlns:xi="http://www.w3.org/2001/XInclude" href="file:///host/.local/runtime-config.json"/>'),
    ]) {
      const observations: unknown[] = [];
      const output = await sandbox(await candidate(), ["docx"], encoded(xml), 30000, async value => { observations.push(value); });
      expect(JSON.parse(output.subarray(4, 4 + output.readUInt32BE(0)).toString())).toEqual({ status: "rejected", reason: "unsafe" });
      expect(observations).toEqual([expect.objectContaining({ networkMode: "none", mountCount: 0, readonly: true, changedPaths: [], removed: true })]);
    }
  });
  it("rejects excessive depth and wrong or undeclared Word namespaces", async () => {
    for (const [xml, reason] of [
      [wordXml.replace("<w:body>", `<w:body>${"<w:s>".repeat(128)}`).replace("</w:body>", `${"</w:s>".repeat(128)}</w:body>`), "resource"],
      [wordXml.replace("http://schemas.openxmlformats.org/wordprocessingml/2006/main", "urn:wrong"), "corrupt"],
      [wordXml.replace(' xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"', ""), "corrupt"],
    ]) {
      const output = await sandbox(await candidate(), ["docx"], docx([], xml));
      expect(JSON.parse(output.subarray(4, 4 + output.readUInt32BE(0)).toString())).toEqual({ status: "rejected", reason });
    }
  });
});