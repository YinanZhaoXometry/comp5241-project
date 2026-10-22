import { z } from "zod";
import { commandSchema, MAX_BYTES, uuid } from "./setup";

export const inputSchema = z.strictObject({ slotId: uuid, filename: z.string().min(1).max(184), mime: z.string().min(1).max(120), byteLength: z.number().int().min(1).max(MAX_BYTES) });
export const inputsSchema = commandSchema.extend({ inputs: z.array(inputSchema).min(1).max(10) }).refine(value => new Set(value.inputs.map(x => x.slotId)).size === value.inputs.length);
export const selectionSchema = commandSchema.extend({
  selected: z.array(z.strictObject({ slotId: uuid, extractionId: uuid, acknowledged: z.literal(true) })).min(1).max(10),
  excluded: z.array(z.strictObject({ slotId: uuid, state: z.enum(["awaiting-upload", "queued", "extracting", "preview", "retryable-failed", "permanent-failed", "canceled", "removed"]) })).max(10),
}).refine(value => new Set([...value.selected, ...value.excluded].map(x => x.slotId)).size === value.selected.length + value.excluded.length);
export const controlSchema = commandSchema.extend({ action: z.enum(["cancel", "retry", "remove"]) });
export type InputsCommand = z.infer<typeof inputsSchema>;
export type SelectionCommand = z.infer<typeof selectionSchema>;
export type ControlCommand = z.infer<typeof controlSchema>;