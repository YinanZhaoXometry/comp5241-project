import { z } from "zod";

export const MAX_BYTES = 20 * 1024 * 1024;
export const uuid = z.uuid();
export const commandSchema = z.strictObject({ schemaVersion: z.literal(1), commandKey: uuid, expectedRevision: z.number().int().nonnegative() });
export const goals = ["Exam preparation", "Understand a topic", "Apply a skill", "Other"] as const;
export const planSchema = z.strictObject({
  topic: z.string().trim().min(1).max(160), goal: z.enum(goals),
  clarification: z.string().trim().max(240),
  outcomes: z.array(z.string().trim().min(1).max(300)).min(1).max(8),
  miniCourse: z.strictObject({ title: z.string().trim().min(1).max(160), lessons: z.array(z.string().trim().min(1).max(200)).min(1).max(8), practice: z.string().trim().min(1).max(1000), estimatedMinutes: z.number().int().min(1).max(600) }),
  missingExplanations: z.string().trim().min(1).max(1000),
}).refine(plan => plan.goal !== "Other" || plan.clarification.length > 0, { path: ["clarification"], message: "Add a short clarification for Other." });
export const savePlanSchema = commandSchema.extend({ plan: planSchema, extractionId: uuid });
export const confirmSchema = commandSchema.extend({ planRevisionId: uuid });
export const extractionJobSchema = z.strictObject({ schemaVersion: z.literal(1), operationId: uuid, rootId: uuid, ownerId: uuid, sessionId: uuid, generation: z.number().int().nonnegative(), epoch: z.number().int().nonnegative() });
export type Command = z.infer<typeof commandSchema>;
export type Plan = z.infer<typeof planSchema>;
export type SavePlan = z.infer<typeof savePlanSchema>;
export type Confirm = z.infer<typeof confirmSchema>;
export type ExtractionJob = z.infer<typeof extractionJobSchema>;
export type Identity = { userId: string; sessionId: string };
export type Receipt = { rootId: string; operationId?: string; planRevisionId?: string; revision: number; state?: string };

export function hasControl(text: string) {
  for (const char of text) {
    const code = char.charCodeAt(0);
    if ((code < 32 && ![9, 10, 13].includes(code)) || (code >= 127 && code <= 159)) return true;
  }
  return false;
}
export function disguisedBinary(text: string) { return text.startsWith("%PDF-") || text.startsWith(`PK${String.fromCharCode(3, 4)}`); }
export function validateText(bytes: Uint8Array): string {
  if (!bytes.length || bytes.length > MAX_BYTES) throw new Error("INVALID_INPUT");
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  if (!text.trim() || hasControl(text) || disguisedBinary(text)) throw new Error("INVALID_INPUT");
  return text;
}