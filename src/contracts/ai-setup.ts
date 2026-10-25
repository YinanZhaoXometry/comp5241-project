import { z } from "zod";
import { commandSchema, planSchema, uuid, type Command, type Plan } from "./setup";
import type { AiErrorCode } from "./ai-provider";

// S6 owner-admitted AI assist contracts. The AI draft pipeline is ADVISORY
// ONLY: topics and the planSchema-shaped draft are UI suggestions the learner
// edits and confirms through the unchanged savePlan/confirmPlan path — the AI
// never auto-confirms and a draft is never a plan revision.
export const AI_DRAFT_QUEUE = "ai-draft";
export const aiDraftTopicsSchema = z.array(z.string().trim().min(1).max(160)).min(3).max(6);
export const aiDraftResultSchema = z.strictObject({
  topics: aiDraftTopicsSchema,
  plan: planSchema,
});
// The dispatch command is the plain command envelope: idempotency rides the
// existing command_receipt machinery, and the admission scope (lineage object
// ids) is derived server-side from the acknowledged selection, never submitted.
export const aiDraftRequestSchema = commandSchema;
export const aiDraftJobSchema = z.strictObject({
  schemaVersion: z.literal(1),
  requestId: uuid,
  admissionId: uuid,
  rootId: uuid,
  ownerId: uuid,
  sessionId: uuid,
});
export type AiDraftTopics = z.infer<typeof aiDraftTopicsSchema>;
export type AiDraftResult = z.infer<typeof aiDraftResultSchema>;
export type AiDraftCommand = z.infer<typeof aiDraftRequestSchema>;
export type AiDraftJob = z.infer<typeof aiDraftJobSchema>;
export type { Command, Plan };
// Terminal failure reasons recorded on ai_draft_request. Adapter error codes
// plus the settlement fence outcome; all content-free.
export type AiDraftFailureCode = AiErrorCode | "rejected-late";
export type AiDraftUsage = { inputTokens: number; outputTokens: number; totalTokens: number };
export type AiDraftStatus = "pending" | "ready" | "failed";
// Owner-scoped view of the latest draft request for a study root.
export type AiDraftView = {
  requestId: string;
  rootId: string;
  status: AiDraftStatus;
  failureCode: string | null;
  result: AiDraftResult | null;
  model: string | null;
  usage: AiDraftUsage | null;
  objectIds: string[];
  createdAt: string;
  settledAt: string | null;
};
