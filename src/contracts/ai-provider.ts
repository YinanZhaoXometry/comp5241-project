import { z } from "zod";

export const AI_LIMITS = Object.freeze({
  messages: 32,
  inputBytes: 32 * 1024,
  requestBytes: 64 * 1024,
  outputBytes: 32 * 1024,
  responseBytes: 128 * 1024,
  outputTokens: 4096,
  timeoutMs: 30_000,
});

const encoder = new TextEncoder();
export const textCompletionRequestSchema = z.strictObject({
  messages: z.array(z.strictObject({
    role: z.enum(["system", "user", "assistant"]),
    content: z.string().min(1).max(AI_LIMITS.inputBytes).refine(text => text.trim().length > 0),
  })).min(1).max(AI_LIMITS.messages),
  maxOutputTokens: z.number().int().min(1).max(AI_LIMITS.outputTokens),
}).refine(request => request.messages.reduce((bytes, message) => bytes + encoder.encode(message.content).byteLength, 0) <= AI_LIMITS.inputBytes);

export type TextCompletionRequest = z.infer<typeof textCompletionRequestSchema>;
export type AiErrorCode = "processing-blocked" | "invalid-config" | "invalid-input" | "authentication" | "rate-limit" | "provider-unavailable" | "provider-rejected" | "redirect" | "transport" | "invalid-output" | "refused" | "canceled" | "timeout";
export type AiFailureOutcome = "not-dispatched" | "rejected" | "unknown";
export type TextCompletionResult =
  | { ok: true; text: string; provenance: { requestedModel: string; returnedModel: string }; usage: { inputTokens: number; outputTokens: number; totalTokens: number } }
  | { ok: false; error: { code: AiErrorCode; message: string; outcome: AiFailureOutcome } };

/** Protocol only: not product authorization, generation, approval or durable accounting. */
export interface TextCompletionPort {
  complete(request: unknown, options?: { signal?: AbortSignal }): Promise<TextCompletionResult>;
}