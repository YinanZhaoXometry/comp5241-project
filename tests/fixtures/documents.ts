import { crc32, deflateRawSync, deflateSync } from "node:zlib";
import { MAX_BYTES } from "../../src/contracts/setup";

// Original, generated synthetic fixtures. No application or third-party content.
export function zip(entries: { name: string; content: string | Buffer; compressed?: boolean; flags?: number; mode?: number }[]) {
  const local: Buffer[] = []; const central: Buffer[] = []; let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name); const raw = Buffer.from(entry.content);
    const data = entry.compressed ? deflateRawSync(raw) : raw;
    const header = Buffer.alloc(30); header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4);
    header.writeUInt16LE(entry.flags ?? 0, 6); header.writeUInt16LE(entry.compressed ? 8 : 0, 8);
    header.writeUInt32LE(crc32(raw), 14); header.writeUInt32LE(data.length, 18); header.writeUInt32LE(raw.length, 22); header.writeUInt16LE(name.length, 26);
    const directory = Buffer.alloc(46); directory.writeUInt32LE(0x02014b50); directory.writeUInt16LE(0x0314, 4); header.copy(directory, 6, 4, 30);
    directory.writeUInt32LE(((entry.mode ?? 0o100644) * 65536) >>> 0, 38); directory.writeUInt32LE(offset, 42);
    local.push(header, name, data); central.push(directory, name); offset += header.length + name.length + data.length;
  }
  const records = Buffer.concat(central); const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(records.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, records, end]);
}
export const wordXml = '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Synthetic document testing</w:t></w:r></w:p></w:body></w:document>';
export function docx(extra: Parameters<typeof zip>[0] = [], xml = wordXml) {
  return zip([{ name: "[Content_Types].xml", content: '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>' }, { name: "word/document.xml", content: xml }, ...extra]);
}
export function pdf(atLimit = false, content = "BT /F1 12 Tf 40 100 Td (Synthetic PDF testing) Tj ET", metadata?: { bytes: Buffer; compressed?: boolean }) {
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>", "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>", "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>", `<< /Length ${content.length} >>\nstream\n${content}\nendstream`];
  if (metadata) {
    objects[0] = "<< /Type /Catalog /Pages 2 0 R /Metadata 6 0 R >>";
    const encoded = (metadata.compressed ? deflateSync(metadata.bytes) : metadata.bytes).toString("hex") + ">";
    objects.push(`<< /Type /Metadata /Subtype /XML /Length ${encoded.length} /Filter ${metadata.compressed ? "[/ASCIIHexDecode /FlateDecode]" : "/ASCIIHexDecode"} >>\nstream\n${encoded}\nendstream`);
  }
  let value = "%PDF-1.4\n"; const offsets = [0];
  for (const [i, object] of objects.entries()) { offsets.push(Buffer.byteLength(value)); value += `${i + 1} 0 obj\n${object}\nendobj\n`; }
  if (atLimit) value += `%${" ".repeat(MAX_BYTES - Buffer.byteLength(value) - 1024)}\n`;
  const start = Buffer.byteLength(value);
  value += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`;
  if (atLimit) value += " ".repeat(MAX_BYTES - Buffer.byteLength(value));
  return Buffer.from(value);
}
export function atLimitDocx() {
  const base = docx();
  return docx([{ name: "word/padding.dat", content: Buffer.alloc(MAX_BYTES - base.length - 46 - 30 - 2 * Buffer.byteLength("word/padding.dat"), 32) }]);
}