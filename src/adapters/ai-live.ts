import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import { createOpenAICompatibleAdapter, type OpenAICompatibleTransport } from "./openai-compatible";
import type { TextCompletionPort } from "../contracts/ai-provider";

// Server-only production wiring for the S6 owner-admitted live endpoint
// (docs/ai-provider-adapter.md "Activation 2026-10-24"). The provider key is
// read here and ONLY here, from git-ignored .local/ai-provider.json, and is
// handed to the adapter in memory: it is never logged, echoed, serialized,
// persisted or returned. An absent or invalid file means NO provider — callers
// fail honestly with provider-unavailable rather than guessing a credential.

// Minimal re-declaration of the adapter's configuration rules
// (docs/ai-provider-adapter.md § "Explicit configuration and transport") so a
// bad local file is rejected before any SDK construction, exactly like the
// adapter's own configSchema would. Unknown keys (operator annotations such as
// the recorded eligibility verdict) are ignored: the file is operator-owned
// local state, and only baseUrl/model/apiKey reach the adapter.
const providerConfigSchema = z.object({
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
  model: z.string().min(1).max(160).regex(/^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/u),
  apiKey: z.string().min(1).max(4096).regex(/^[\x21-\x7e]+$/u),
});

export type AiProviderConfig = { baseUrl: string; model: string; apiKey: string };

export async function loadAiProviderConfig(path = resolve(".local/ai-provider.json")): Promise<AiProviderConfig | null> {
  let raw: string;
  try { raw = await readFile(path, "utf8"); } catch { return null; }
  try {
    const parsed = providerConfigSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch { return null; }
}

// Destination allowlist: the transport only ever delegates the adapter's exact
// chat-completions endpoint for the admitted base URL. Any other URL — a
// redirected target, a rewritten host, anything — throws before any network
// I/O, so the adapter reports a transport failure instead of egress.
export function createDestinationTransport(baseUrl: string): OpenAICompatibleTransport {
  // Mirror the adapter's endpoint derivation: strip ONE trailing slash, append
  // /chat/completions, never add /v1.
  const endpoint = `${baseUrl.replace(/\/$/u, "")}/chat/completions`;
  return async (input, init) => {
    if (String(input) !== endpoint) throw new Error("Destination not allowed");
    return fetch(input, init);
  };
}

// S6 budget cap (USD 15 ≈ 2,000,000 ledger tokens). Ledger totals are untrusted
// provider claims, labeled as such; the pre-dispatch check only ever
// over-reserves maxOutputTokens, so a lying provider cannot widen the cap.
export const AI_BUDGET = Object.freeze({ totalTokenCap: 2_000_000, maxOutputTokens: 1200 });

export async function createLiveCompletion(): Promise<TextCompletionPort | null> {
  const config = await loadAiProviderConfig();
  if (!config) return null;
  // k3 is a reasoning model: real draft calls routinely exceed the 10s SDK
  // default, so production uses the contract's documented 30s ceiling; the
  // UI's honest 120-second pending cap still governs the learner-visible wait.
  return createOpenAICompatibleAdapter({ ...config, timeoutMs: 30_000 }, createDestinationTransport(config.baseUrl));
}
