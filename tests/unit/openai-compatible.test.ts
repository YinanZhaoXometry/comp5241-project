import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AI_LIMITS, type AiErrorCode, type AiFailureOutcome, type TextCompletionResult } from "../../src/contracts/ai-provider";
import { createOpenAICompatibleAdapter, type OpenAICompatibleConfig } from "../../src/adapters/openai-compatible";
import { assertProviderIsolation } from "../../scripts/check-boundaries.mjs";

const { constructed } = vi.hoisted(() => ({ constructed: vi.fn() }));
vi.mock("openai", async importOriginal => {
  const actual = await importOriginal<typeof import("openai")>();
  return { ...actual, default: function observedClient(options: ConstructorParameters<typeof actual.default>[0]) {
    constructed(options); return new actual.default(options);
  } };
});

const config: OpenAICompatibleConfig = { baseUrl: "https://synthetic.invalid/custom/coding/v1", model: "synthetic-model", apiKey: "synthetic-key-not-a-credential", timeoutMs: 1000 };
const request = { messages: [{ role: "system", content: "Synthetic instruction" }, { role: "user", content: "Synthetic prompt" }], maxOutputTokens: 64 };
const payload = () => ({
  id: "synthetic-completion", object: "chat.completion", created: 1, model: "synthetic-model-resolved",
  choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: "Synthetic answer", refusal: null } }],
  usage: { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 },
});
const json = (value: unknown = payload()) => new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });
const failure = (result: TextCompletionResult, code: AiErrorCode, outcome: AiFailureOutcome) => {
  expect(result).toEqual({ ok: false, error: { code, message: expect.any(String), outcome } });
  expect(JSON.stringify(result)).not.toMatch(/synthetic-key|Synthetic prompt|provider-secret|raw-reason/u);
};
let network: ReturnType<typeof vi.fn>;
beforeEach(() => {
  constructed.mockClear();
  network = vi.fn(() => { throw new Error("Global network is forbidden"); });
  vi.stubGlobal("fetch", network);
  vi.stubEnv("OPENAI_LOG", "debug");
});
afterEach(() => {
  expect(network).not.toHaveBeenCalled();
  vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs();
});

describe("dormant OpenAI-compatible foundation", () => {
  it.each([
    ['import OpenAI from "openai";'],
    ['export { default } from "openai";'],
    ['const sdk = import("openai");'],
    ['const sdk = require("openai");'],
    ['export * from "./adapters/openai-compatible";'],
    ['export * from "@/adapters/./openai-compatible";'],
    ['const adapter = import("@/bridge/../adapters/openai-compatible");'],
  ])("rejects direct and transitive client SDK imports (%#)", source => {
    const sources = new Map([
      ["app/client.ts", '"use client"; import "@/bridge";'],
      ["bridge.ts", source], ["adapters/openai-compatible.ts", "export const adapter = {};"],
    ]);
    expect(() => assertProviderIsolation(sources)).toThrow(/Client provider dependency/u);
  });

  it("permits provider-independent contracts in client code and server-side SDK imports", () => {
    expect(() => assertProviderIsolation(new Map([
      ["app/client.ts", '"use client"; import { port } from "../contracts/ai-provider";'],
      ["contracts/ai-provider.ts", "export const port = {};"],
      ["adapters/openai-compatible.ts", 'const sdk = import("openai");'],
    ]))).not.toThrow();
  });

  it("does not construct the SDK, inspect config or read ambient credentials without transport", async () => {
    vi.stubEnv("OPENAI_API_KEY", "synthetic-ambient-key");
    const read = vi.fn(() => { throw new Error("Configuration must not be read"); });
    const hidden = Object.defineProperty({}, "apiKey", { get: read });
    for (const supplied of [undefined, config, hidden]) {
      const adapter = createOpenAICompatibleAdapter(supplied);
      failure(await adapter.complete(request), "processing-blocked", "not-dispatched");
    }
    expect(read).not.toHaveBeenCalled(); expect(constructed).not.toHaveBeenCalled();
  });

  it.each([
    ["https://synthetic.invalid/custom/coding/v1", "https://synthetic.invalid/custom/coding/v1/chat/completions"],
    ["https://synthetic.invalid/custom/coding/v1/", "https://synthetic.invalid/custom/coding/v1/chat/completions"],
    ["https://synthetic.invalid/custom/coding/v1//", "https://synthetic.invalid/custom/coding/v1//chat/completions"],
    ["https://synthetic.invalid/custom/coding/v1///", "https://synthetic.invalid/custom/coding/v1///chat/completions"],
  ])("makes one bounded SDK POST preserving %s", async (baseUrl, endpoint) => {
    vi.stubEnv("OPENAI_BASE_URL", "https://ambient.invalid");
    vi.stubEnv("OPENAI_ORG_ID", "provider-secret"); vi.stubEnv("OPENAI_PROJECT_ID", "provider-secret");
    vi.stubEnv("OPENAI_ADMIN_KEY", "synthetic-ambient-admin");
    vi.stubEnv("OPENAI_CUSTOM_HEADERS", "x-ambient: provider-secret\nUser-Agent: impersonated-tool\nAuthorization: provider-secret");
    const logs = [vi.spyOn(console, "log"), vi.spyOn(console, "info"), vi.spyOn(console, "warn"), vi.spyOn(console, "error"), vi.spyOn(console, "debug")];
    const transport = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      expect(String(url)).toBe(endpoint);
      expect(init?.method).toBe("POST"); expect(init?.redirect).toBe("error");
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      const headers = new Headers(init?.headers);
      expect(headers.get("authorization")).toBe(`Bearer ${config.apiKey}`);
      expect(headers.get("x-ambient")).toBeNull(); expect(headers.get("openai-organization")).toBeNull();
      expect(headers.get("user-agent")).toBe("private-study-tracer/0.1 openai-compatible-foundation");
      expect(JSON.parse(String(init?.body))).toEqual({ model: config.model, messages: request.messages, max_tokens: 64, n: 1, stream: false });
      return json({ ...payload(), extra: "provider-secret" });
    });
    const result = await createOpenAICompatibleAdapter({ ...config, baseUrl }, transport).complete(request);
    expect(result).toEqual({ ok: true, text: "Synthetic answer", provenance: { requestedModel: config.model, returnedModel: "synthetic-model-resolved" }, usage: { inputTokens: 10, outputTokens: 4, totalTokens: 14 } });
    expect(transport).toHaveBeenCalledTimes(1); expect(constructed).toHaveBeenCalledTimes(1);
    expect(constructed).toHaveBeenCalledWith(expect.objectContaining({ maxRetries: 0, timeout: 1000, logLevel: "off", adminAPIKey: null, organization: null, project: null, webhookSecret: null }));
    for (const log of logs) expect(log).not.toHaveBeenCalled();
  });

  it.each([
    undefined, {}, { ...config, baseUrl: "http://synthetic.invalid/v1" },
    ...["https://user:pass@synthetic.invalid/v1", "https://@synthetic.invalid/v1", "https:////@synthetic.invalid/v1", "https://synthetic.invalid/v1\u0000", "https://synthetic.invalid/v1?key=provider-secret", "https://synthetic.invalid/v1?", "https://synthetic.invalid/v1#", " https://synthetic.invalid", "https://synthetic.invalid\\v1"].map(baseUrl => ({ ...config, baseUrl })),
    { ...config, apiKey: "" }, { ...config, apiKey: "bad\nkey" }, { ...config, model: "" }, { ...config, model: "model?key=x" },
    { ...config, timeoutMs: 0 }, { ...config, timeoutMs: AI_LIMITS.timeoutMs + 1 }, { ...config, enabled: true },
  ])("rejects invalid explicit configuration before SDK construction (%#)", async supplied => {
    const transport = vi.fn(async () => json());
    failure(await createOpenAICompatibleAdapter(supplied, transport).complete(request), "invalid-config", "not-dispatched");
    expect(transport).not.toHaveBeenCalled(); expect(constructed).not.toHaveBeenCalled();
  });

  it.each([
    null, {}, { ...request, tools: [] }, { ...request, stream: true }, { ...request, model: "override" },
    { ...request, messages: [] }, { ...request, messages: Array.from({ length: AI_LIMITS.messages + 1 }, () => request.messages[0]) },
    ...["tool", "developer", "function"].map(role => ({ ...request, messages: [{ role, content: "Synthetic" }] })),
    { ...request, messages: [{ role: "user", content: " " }] },
    { ...request, messages: [{ role: "user", content: "Synthetic", tool_calls: [] }] },
    { ...request, messages: [{ role: "user", content: "界".repeat(Math.ceil(AI_LIMITS.inputBytes / 3)) }] },
    { ...request, messages: [{ role: "user", content: "x".repeat(AI_LIMITS.inputBytes) }, { role: "user", content: "x" }] },
    ...[0, -1, 0.5, Infinity, AI_LIMITS.outputTokens + 1].map(maxOutputTokens => ({ ...request, maxOutputTokens })),
  ])("rejects unknown/tool or excessive input before dispatch (%#)", async input => {
    const transport = vi.fn(async () => json());
    failure(await createOpenAICompatibleAdapter(config, transport).complete(input), "invalid-input", "not-dispatched");
    expect(transport).not.toHaveBeenCalled(); expect(constructed).not.toHaveBeenCalled();
  });

  it("accepts the exact input byte ceiling but rejects excessive JSON escaping before dispatch", async () => {
    const transport = vi.fn(async () => json()); const adapter = createOpenAICompatibleAdapter(config, transport);
    expect((await adapter.complete({ ...request, messages: [{ role: "user", content: "x".repeat(AI_LIMITS.inputBytes) }] })).ok).toBe(true);
    failure(await adapter.complete({ ...request, messages: [{ role: "user", content: "\u0001".repeat(AI_LIMITS.inputBytes) }] }), "invalid-input", "not-dispatched");
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it("accepts bounded multichunk UTF-8 and the exact output byte ceiling, returning only the port projection", async () => {
    const text = "界".repeat(Math.floor(AI_LIMITS.outputBytes / 3)) + "xx";
    const choice = payload().choices[0];
    const bytes = new TextEncoder().encode(JSON.stringify({ ...payload(), choices: [{ ...choice, logprobs: "provider-secret", message: { ...choice.message, content: text } }], usage: { ...payload().usage, internal: "provider-secret" } }));
    const transport = vi.fn(async () => new Response(new ReadableStream({ start(stream) {
      for (let index = 0; index < bytes.length; index += 513) stream.enqueue(bytes.slice(index, index + 513));
      stream.close();
    } }), { headers: { "content-type": "application/json; charset=utf-8" } }));
    const result = await createOpenAICompatibleAdapter(config, transport).complete(request);
    expect(result.ok).toBe(true);
    if (result.ok) { expect(result.text).toBe(text); expect(Object.keys(result).sort()).toEqual(["ok", "provenance", "text", "usage"]); }
    expect(JSON.stringify(result)).not.toContain("provider-secret");
  });

  it.each([
    [401, "authentication", "rejected"], [403, "authentication", "rejected"], [429, "rate-limit", "rejected"],
    [400, "provider-rejected", "rejected"], [408, "provider-rejected", "unknown"], [409, "provider-rejected", "unknown"],
    [500, "provider-unavailable", "unknown"], [503, "provider-unavailable", "unknown"],
    [301, "redirect", "unknown"], [302, "redirect", "unknown"], [307, "redirect", "unknown"], [308, "redirect", "unknown"],
  ] as const)("classifies HTTP %i without retries, body consumption or disclosure", async (status, code, outcome) => {
    const canceled = vi.fn(); const pulled = vi.fn();
    const body = new ReadableStream({ pull() { pulled(); }, cancel: canceled }, { highWaterMark: 0 });
    const transport = vi.fn(async () => new Response(body, { status, headers: { location: "https://elsewhere.invalid/provider-secret", "x-should-retry": "true", "retry-after": "1" } }));
    failure(await createOpenAICompatibleAdapter(config, transport).complete(request), code, outcome);
    expect(transport).toHaveBeenCalledTimes(1); expect(canceled).toHaveBeenCalled(); expect(pulled).not.toHaveBeenCalled();
  });

  it("sanitizes thrown transport errors without causes or SDK logs", async () => {
    const log = vi.spyOn(console, "error");
    const transport = vi.fn(async () => { throw new Error(`provider-secret ${config.apiKey} Synthetic prompt`); });
    failure(await createOpenAICompatibleAdapter(config, transport).complete(request), "transport", "unknown");
    expect(transport).toHaveBeenCalledTimes(1); expect(log).not.toHaveBeenCalled();
  });

  it.each([
    null, {}, { ...payload(), object: "response" }, { ...payload(), model: "" },
    { ...payload(), choices: [] }, { ...payload(), choices: [...payload().choices, ...payload().choices] },
    ...["", " ", null, [{ type: "text", text: "Synthetic" }], "界".repeat(Math.ceil(AI_LIMITS.outputBytes / 3))].map(content => ({ ...payload(), choices: [{ ...payload().choices[0], message: { role: "assistant", content } }] })),
    ...["length", "tool_calls", "function_call", null].map(finish_reason => ({ ...payload(), choices: [{ ...payload().choices[0], finish_reason }] })),
    ...[{ tool_calls: [] }, { function_call: { name: "test" } }, { role: "tool" }].map(fields => ({ ...payload(), choices: [{ ...payload().choices[0], message: { ...payload().choices[0].message, ...fields } }] })),
    { ...payload(), usage: undefined }, { ...payload(), usage: { prompt_tokens: -1, completion_tokens: 4, total_tokens: 3 } },
    { ...payload(), usage: { prompt_tokens: 10, completion_tokens: 65, total_tokens: 75 } },
    { ...payload(), usage: { prompt_tokens: 10, completion_tokens: 4, total_tokens: 99 } },
  ])("validates external JSON rather than trusting SDK types (%#)", async response => {
    const transport = vi.fn(async () => json(response));
    failure(await createOpenAICompatibleAdapter(config, transport).complete(request), "invalid-output", "unknown");
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it.each(["message", "filter"])("returns safe refusal for %s", async kind => {
    const choice = payload().choices[0];
    const transport = vi.fn(async () => json({ ...payload(), choices: [{ ...choice, finish_reason: kind === "filter" ? "content_filter" : "stop", message: { ...choice.message, content: null, refusal: kind === "message" ? "provider-secret" : null } }] }));
    failure(await createOpenAICompatibleAdapter(config, transport).complete(request), "refused", "unknown");
  });

  it.each(["malformed", "wrong-type", "declared-oversize", "chunked-oversize", "invalid-utf8", "redirected"])("rejects %s responses and cleans up", async kind => {
    const canceled = vi.fn();
    const response = kind === "malformed" ? new Response("{provider-secret", { headers: { "content-type": "application/json" } })
      : kind === "wrong-type" ? new Response("provider-secret", { headers: { "content-type": "text/html" } })
      : kind === "invalid-utf8" ? new Response(new Uint8Array([0xff]), { headers: { "content-type": "application/json" } })
      : new Response(new ReadableStream({ start(controller) { if (kind === "chunked-oversize") controller.enqueue(new Uint8Array(AI_LIMITS.responseBytes + 1)); }, cancel: canceled }), { headers: { "content-type": "application/json", ...(kind === "declared-oversize" ? { "content-length": String(AI_LIMITS.responseBytes + 1) } : {}) } });
    if (kind === "redirected") Object.defineProperty(response, "redirected", { value: true });
    const transport = vi.fn(async () => response);
    failure(await createOpenAICompatibleAdapter(config, transport).complete(request), kind === "redirected" ? "redirect" : "invalid-output", "unknown");
    if (["declared-oversize", "chunked-oversize", "redirected"].includes(kind)) expect(canceled).toHaveBeenCalled();
    expect(response.body?.locked).toBe(false);
  });

  it("handles pre-abort without SDK construction or dispatch, hiding abort reasons", async () => {
    const controller = new AbortController(); controller.abort("raw-reason");
    const transport = vi.fn(async () => json());
    failure(await createOpenAICompatibleAdapter(config, transport).complete(request, { signal: controller.signal }), "canceled", "not-dispatched");
    expect(transport).not.toHaveBeenCalled(); expect(constructed).not.toHaveBeenCalled();
  });

  it.each(["timeout", "canceled"] as const)("bounds an abort-ignoring transport on %s and cancels its late body", async code => {
    vi.useFakeTimers(); const controller = new AbortController();
    let transportSignal: AbortSignal | null | undefined;
    let resolveFetch!: (response: Response) => void;
    const transport = vi.fn((_url: RequestInfo | URL, init?: RequestInit) => {
      transportSignal = init?.signal;
      return new Promise<Response>(resolve => { resolveFetch = resolve; });
    });
    const result = createOpenAICompatibleAdapter({ ...config, timeoutMs: 40 }, transport).complete(request, { signal: controller.signal });
    await vi.advanceTimersByTimeAsync(1); expect(transport).toHaveBeenCalledTimes(1);
    if (code === "canceled") controller.abort("raw-reason"); else await vi.advanceTimersByTimeAsync(40);
    failure(await result, code, "unknown");
    expect(transportSignal?.aborted).toBe(true);
    const canceled = vi.fn(); resolveFetch(new Response(new ReadableStream({ cancel: canceled })));
    await vi.advanceTimersByTimeAsync(1); expect(canceled).toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["timeout", "canceled"] as const)("bounds stalled body consumption on %s and releases reader", async code => {
    vi.useFakeTimers(); const controller = new AbortController(); const canceled = vi.fn();
    const response = new Response(new ReadableStream({ start(stream) { stream.enqueue(new TextEncoder().encode('{"partial":')); }, cancel: canceled }), { headers: { "content-type": "application/json" } });
    const transport = vi.fn(async () => response);
    const result = createOpenAICompatibleAdapter({ ...config, timeoutMs: 40 }, transport).complete(request, { signal: controller.signal });
    await vi.advanceTimersByTimeAsync(1);
    if (code === "canceled") controller.abort("raw-reason"); else await vi.advanceTimersByTimeAsync(40);
    failure(await result, code, "unknown"); expect(canceled).toHaveBeenCalled();
    expect(response.body?.locked).toBe(false); expect(vi.getTimerCount()).toBe(0);
  });

  it("enforces elapsed total time even when ready/empty body chunks starve timer callbacks", async () => {
    let elapsed = 0;
    vi.spyOn(performance, "now").mockImplementation(() => elapsed);
    const canceled = vi.fn();
    const transport = vi.fn(async () => new Response(new ReadableStream({ pull(stream) {
      elapsed += 10;
      if (elapsed < 60) stream.enqueue(new Uint8Array());
      else { stream.enqueue(new TextEncoder().encode(JSON.stringify(payload()))); stream.close(); }
    }, cancel: canceled }, { highWaterMark: 0 }), { headers: { "content-type": "application/json" } }));
    failure(await createOpenAICompatibleAdapter({ ...config, timeoutMs: 40 }, transport).complete(request), "timeout", "unknown");
    expect(canceled).toHaveBeenCalled(); expect(transport).toHaveBeenCalledTimes(1);
  });
});