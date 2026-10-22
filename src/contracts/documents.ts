import { z } from "zod";
import { hasControl, MAX_BYTES } from "./setup";

export const formats = ["txt", "md", "pdf", "docx"] as const;
export type Format = typeof formats[number];
export const MAX_METADATA = 256 * 1024;
export const reasons = ["unsupported", "protected", "corrupt", "unsafe", "no-text", "resource", "service"] as const;
export type ExtractionReason = typeof reasons[number];
export const metadataSchema = z.strictObject({
  format: z.enum(formats), parser: z.literal("bounded-documents-v2"),
  warnings: z.array(z.enum(["literal-markdown", "layout-omitted", "nontext-omitted", "other-parts-omitted"])).max(4),
  locations: z.array(z.strictObject({
    unit: z.enum(["lines", "page", "paragraph"]), source: z.string().max(200),
    first: z.number().int().positive(), last: z.number().int().positive(),
    start: z.number().int().nonnegative().max(MAX_BYTES), end: z.number().int().nonnegative().max(MAX_BYTES),
  }).refine(x => x.first <= x.last && x.start <= x.end)).min(1).max(2048),
});
export type ExtractionMetadata = z.infer<typeof metadataSchema>;
export function documentFormat(filename: string, mime: string): Format {
  if (!filename || filename.length > 184 || hasControl(filename) || /[/\\\t\r\n]/u.test(filename)) throw new Error("INVALID_INPUT");
  const extension = filename.slice(filename.lastIndexOf(".") + 1).toLowerCase();
  const allowed: Record<Format, string[]> = { txt: ["text/plain"], md: ["text/plain", "text/markdown"], pdf: ["application/pdf"], docx: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"] };
  if (!formats.includes(extension as Format) || !allowed[extension as Format].includes(mime.toLowerCase().split(";")[0].trim())) throw new Error("INVALID_INPUT");
  return extension as Format;
}