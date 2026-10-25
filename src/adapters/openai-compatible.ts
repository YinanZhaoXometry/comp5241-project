import { Buffer } from "node:buffer";
import { z } from "zod";
import { AI_LIMITS, textCompletionRequestSchema, type AiErrorCode, type AiFailureOutcome, type TextCompletionPort, type TextCompletionResult } from "../contracts/ai-provider";

export type OpenAICompatibleTransport = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
export type OpenAICompatibleConfig = { baseUrl: string; model: string; apiKey: string; timeoutMs?: number };

const model = z.string().min(1).max(160).regex(/^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/u);
const configSchema = z.strictObject({
  baseUrl: z.string().min(1).max(2048).refine(raw => {
    try {
      const url = new URL(raw);
      const authority = raw.split("/")[2];
      for (const character of raw) {
        const code = character.charCodeAt(0);
        if (code < 32 || (code >= 127 && code <= 159)) return false;
      }
      return raw.startsWith("https://") && !/[\s\\?#]/u.test(raw) && !!authority && !authority.includes("@") && url.protocol === "https:" && !!url.hostname && !url.username && !url.password;
    } catch { return false; }
  }),
  model,
  apiKey: z.string().min(1).max(4096).regex(/^[\x21-\x7e]+$/u),
  timeoutMs: z.number().int().min(1).max(AI_LIMITS.timeoutMs).default(10_000),
});
const count = z.number().int().min(0).max(1_000_000);
const responseSchema = z.object({
  object: z.literal("chat.completion"), model,
  choices: z.array(z.object({
    index: z.literal(0), finish_reason: z.string().max(64),
    // reasoning_content is the separate thinking channel several
    // OpenAI-compatible providers (Kimi k3, DeepSeek-R…) emit beside content;
    // it is tolerated, bounded and NEVER projected — only content completes.
    message: z.strictObject({ role: z.literal("assistant"), content: z.string().max(AI_LIMITS.outputBytes).nullable(), refusal: z.string().max(AI_LIMITS.responseBytes).nullable().optional(), reasoning_content: z.string().max(AI_LIMITS.responseBytes).nullable().optional() }),
  })).length(1),
  usage: z.object({ prompt_tokens: count, completion_tokens: count, total_tokens: count }),
});

const messages: Record<AiErrorCode, string> = {
  "processing-blocked": "AI processing is blocked.",
  "invalid-config": "Invalid AI adapter configuration.",
  "invalid-input": "Invalid text completion request.",
  authentication: "Provider authentication was rejected.",
  "rate-limit": "Provider rate limit reached.",
  "provider-unavailable": "Provider unavailable.",
  "provider-rejected": "Provider rejected the request.",
  redirect: "Provider redirect blocked.",
  transport: "Provider transport failed.",
  "invalid-output": "Invalid provider output.",
  refused: "Provider refused the completion.",
  canceled: "Text completion canceled.",
  timeout: "Text completion timed out.",
};
function failure(code: AiErrorCode, outcome: AiFailureOutcome): TextCompletionResult {
  return { ok: false, error: { code, message: messages[code], outcome } };
}
function cancelBody(response: Response) {
  if (response.body && !response.body.locked) void response.body.cancel().catch(() => { /* Cleanup never discloses transport errors. */ });
}
/** Also bounds transports that ignore abort; their eventual response is disposed separately. */
async function abortable<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
  let abort = () => {};
  try {
    return await new Promise<T>((resolve, reject) => {
      abort = () => reject(new Error("Adapter operation stopped"));
      if (signal.aborted) abort(); else signal.addEventListener("abort", abort, { once: true });
      pending.then(resolve, () => reject(new Error("Adapter operation failed")));
    });
  } finally { signal.removeEventListener("abort", abort); }
}

/** Server-side, dormant by default. No environment/file reader and no startup wiring. */
export function createOpenAICompatibleAdapter(configuration?: unknown, transport?: OpenAICompatibleTransport): TextCompletionPort {
  return {
    async complete(input, options) {
      // Deliberately precedes validation/import: configuration alone cannot construct a client.
      if (typeof transport !== "function") return failure("processing-blocked", "not-dispatched");
      let parsedConfig: ReturnType<typeof configSchema.safeParse>;
      try { parsedConfig = configSchema.safeParse(configuration); } catch { return failure("invalid-config", "not-dispatched"); }
      if (!parsedConfig.success) return failure("invalid-config", "not-dispatched");
      let parsedInput: ReturnType<typeof textCompletionRequestSchema.safeParse>;
      try { parsedInput = textCompletionRequestSchema.safeParse(input); } catch { return failure("invalid-input", "not-dispatched"); }
      if (!parsedInput.success) return failure("invalid-input", "not-dispatched");
      const config = parsedConfig.data;
      const request = parsedInput.data;
      const body = { model: config.model, messages: request.messages, max_tokens: request.maxOutputTokens, n: 1, stream: false as const };
      if (Buffer.byteLength(JSON.stringify(body), "utf8") > AI_LIMITS.requestBytes) return failure("invalid-input", "not-dispatched");
      const caller = options?.signal;
      if (caller?.aborted) return failure("canceled", "not-dispatched");
      const controller = new AbortController();
      let timedOut = false;
      let dispatched = false;
      let fault: AiErrorCode = "transport";
      let outcome: AiFailureOutcome = "unknown";
      let response: Response | undefined;
      let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
      const cancel = () => controller.abort();
      caller?.addEventListener("abort", cancel, { once: true });
      const timer = setTimeout(() => { timedOut = true; controller.abort(); }, config.timeoutMs);
      const deadline = performance.now() + config.timeoutMs;
      const checkDeadline = () => {
        if (!controller.signal.aborted && performance.now() >= deadline) { timedOut = true; controller.abort(); }
        controller.signal.throwIfAborted();
      };
      const baseUrl = new URL(config.baseUrl).href;
      const endpoint = `${baseUrl.replace(/\/$/u, "")}/chat/completions`;
      const operation = async (): Promise<TextCompletionResult> => {
        const { default: OpenAI } = await import("openai");
        checkDeadline();
        const client = new OpenAI({
          baseURL: baseUrl, apiKey: config.apiKey, adminAPIKey: null,
          organization: null, project: null, webhookSecret: null,
          maxRetries: 0, timeout: config.timeoutMs, logLevel: "off",
          fetch: async (url, init) => {
            checkDeadline();
            // Fixed protocol and header allowlist prevent ambient SDK custom-header injection.
            if (dispatched || String(url) !== endpoint || init?.method !== "POST") throw new Error("Adapter dispatch blocked");
            dispatched = true;
            const pending = transport(url, {
              method: "POST", body: init.body, redirect: "error", signal: controller.signal,
              headers: { authorization: `Bearer ${config.apiKey}`, "content-type": "application/json", accept: "application/json", "user-agent": "private-study-tracer/0.1 openai-compatible-foundation" },
            }).then(received => {
              if (controller.signal.aborted) cancelBody(received);
              return received;
            });
            response = await abortable(pending, controller.signal);
            if (response.redirected || (response.url && response.url !== endpoint) || (response.status >= 300 && response.status < 400)) {
              fault = "redirect"; cancelBody(response); throw new Error("Adapter redirect blocked");
            }
            if (!response.ok) {
              const status = response.status;
              fault = status === 401 || status === 403 ? "authentication" : status === 429 ? "rate-limit" : status >= 500 ? "provider-unavailable" : "provider-rejected";
              outcome = status >= 400 && status < 500 && status !== 408 && status !== 409 ? "rejected" : "unknown";
              cancelBody(response); throw new Error("Adapter provider failure");
            }
            return response;
          },
        });
        response = await client.chat.completions.create(body, { signal: controller.signal }).asResponse();
        checkDeadline();
        fault = "invalid-output";
        const contentType = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
        const length = response.headers.get("content-length");
        if (contentType !== "application/json" || (length !== null && (!/^\d+$/u.test(length) || Number(length) > AI_LIMITS.responseBytes)) || !response.body) throw new Error("Adapter output rejected");
        reader = response.body.getReader();
        const chunks: Buffer[] = [];
        let bytes = 0;
        while (true) {
          checkDeadline();
          const chunk = await abortable(reader.read(), controller.signal);
          checkDeadline();
          if (chunk.done) break;
          bytes += chunk.value.byteLength;
          if (bytes > AI_LIMITS.responseBytes) throw new Error("Adapter output limit");
          if (chunk.value.byteLength) chunks.push(Buffer.from(chunk.value));
        }
        checkDeadline();
        const decoded = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, bytes));
        const parsed = responseSchema.safeParse(JSON.parse(decoded));
        if (!parsed.success) throw new Error("Adapter output shape");
        const { choices, usage, model: returnedModel } = parsed.data;
        const choice = choices[0];
        checkDeadline();
        if (choice.finish_reason === "content_filter" || choice.message.refusal) return failure("refused", "unknown");
        const text = choice.message.content;
        if (choice.finish_reason !== "stop" || !text?.trim() || Buffer.byteLength(text, "utf8") > AI_LIMITS.outputBytes || usage.completion_tokens > request.maxOutputTokens || usage.total_tokens !== usage.prompt_tokens + usage.completion_tokens) throw new Error("Adapter output bounds");
        checkDeadline();
        return { ok: true, text, provenance: { requestedModel: config.model, returnedModel }, usage: { inputTokens: usage.prompt_tokens, outputTokens: usage.completion_tokens, totalTokens: usage.total_tokens } };
      };
      try {
        return await abortable(operation(), controller.signal);
      } catch {
        if (controller.signal.aborted) return failure(timedOut ? "timeout" : "canceled", dispatched ? "unknown" : "not-dispatched");
        return failure(fault, dispatched ? outcome : "not-dispatched");
      } finally {
        clearTimeout(timer); caller?.removeEventListener("abort", cancel);
        if (reader) {
          void reader.cancel().catch(() => { /* Never wait for an uncooperative source's cancel hook. */ });
          reader.releaseLock();
        } else if (response) cancelBody(response);
        controller.abort();
      }
    },
  };
}