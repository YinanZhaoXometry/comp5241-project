# Dormant text-completion adapter foundation

## Status and scope

This is a **protocol component, not permission to use a provider**. The
[approved plan](../_bmad-output/initiative-ai-learning-platform/plan-openai-compatible-adapter-foundation.md)
authorizes local implementation and synthetic transports only. Nothing imports
the adapter from application startup, routes, UI, services or jobs. Manual setup
behavior is unchanged. This is neither S3 provider admission nor S6 working AI,
and does not advance tickets, approve a model or establish product eligibility.

The [neutral contract](../src/contracts/ai-provider.ts) defines
`TextCompletionPort.complete(request, { signal? })`. The
[server adapter](../src/adapters/openai-compatible.ts) exports
`createOpenAICompatibleAdapter(configuration?, transport?)`. With no transport it
returns `processing-blocked` **before inspecting configuration, importing or
constructing the SDK**. There is no default global fetch, file reader,
environment configuration loader or enable flag. Installing the SDK or supplying
configuration/ambient keys cannot activate dispatch.

## Explicit configuration and transport

Configuration is a strict object; unknown fields are rejected. There is no
checked-in credential or selected external model. Test fixtures use reserved
synthetic `.invalid` destinations, non-credential keys and synthetic model names.

| Field | Contract |
| --- | --- |
| `baseUrl` | Explicit HTTPS URL, at most 2048 characters. No credentials (including empty user-info), whitespace, backslashes, query or fragment, including empty `?`/`#`. Custom path is retained; the adapter appends `/chat/completions`, without adding `/v1`. |
| `model` | Explicit 1–160 character identifier, beginning with a letter/digit; remaining characters letters/digits or `._:/-`. This syntax check is **not** model/feature eligibility verification or a model pin. |
| `apiKey` | Explicit nonempty printable ASCII, no whitespace/control characters, at most 4096 characters. Memory only; never log or serialize configuration. No ambient credential fallback. |
| `timeoutMs` | Positive integer, default 10000, maximum 30000. Total SDK preparation, request, body consumption and validation deadline, not just time to headers. |

Transport has the fetch-shaped signature
`(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>`.
**Only synthetic implementations are authorized now.** Do not inject global
fetch or wire this into application startup. A future policy-owned transport must
enforce AD-10, provider admission, approved connected destinations and all relevant
network controls (including DNS/IP/proxy/redirect behavior); HTTPS validation is
not SSRF protection, destination authorization or consent.

The official `openai` SDK is pinned to **7.39.0** (Node22+; tested here on the
verified Node24 runtime). It is constructed lazily per valid dispatched attempt,
with `maxRetries: 0`, explicit timeout and `logLevel: 'off'`. Ambient admin,
organization, project and webhook credentials are explicitly disabled. The
outbound wrapper replaces SDK headers with an allowlist: explicit bearer key,
JSON Content-Type/Accept and the honest application User-Agent
`private-study-tracer/0.1 openai-compatible-foundation`. SDK ambient custom headers
cannot inject credentials, tenant context or impersonated tool identity.

## Narrow protocol and resource bounds

- **Input:** strict `{ messages, maxOutputTokens }`; 1–32 messages with only
  `system`, `user`, `assistant` roles and nonblank string content. Unknown fields,
  tool/developer/function messages, tool calls and multimodal content are rejected.
  Content is capped at **32KiB aggregate UTF-8**, and the complete serialized
  request at **64KiB**, including JSON escaping. Output token request is 1–4096.
- **Wire:** one nonstreaming Chat Completions POST, `n: 1`, `stream: false`,
  `max_tokens: maxOutputTokens`. No Responses API, streaming, tools, embeddings,
  audio, plan generation or automatic fallback. Models requiring a different
  parameter or response shape are not supported by this narrow adapter.
- **Output:** JSON Content-Type, fatal UTF-8 decoding and at most **128KiB** raw
  response bytes, even without a Content-Length header. Exactly one index-zero
  assistant message, normal `stop`, nonblank text at most **32KiB UTF-8**, bounded
  model provenance and valid integral usage are required. The separate
  `reasoning_content` channel some OpenAI-compatible providers (Kimi k3,
  DeepSeek-R) emit beside `content` is tolerated and bounded but never
  projected — only `content` completes. Tool/function fields, unknown message
  fields, truncation, malformed/empty/multimodal output and
  inconsistent/excessive usage do not produce a completion.
  Refusal/content-filter signals produce safe refusal errors. Outer provider
  metadata is discarded.
- **Projection:** only `ok`, `text`, `{ requestedModel, returnedModel }` provenance
  and `{ inputTokens, outputTokens, totalTokens }` usage on success. Provider token
  counts must be nonnegative, each at most 1000000, output no greater than the
  requested ceiling, and total equal input plus output. These are **untrusted
  provider claims, not durable cost accounting**. Input bytes are not a tokenizer;
  future admission must verify the selected model's context and token budget.
- **Deadline/cancellation:** pre-abort means no SDK construction or dispatch.
  A total timer plus monotonic checks bound stalled and immediately-ready body
  chunks; no waiting for uncooperative cancel hooks. Reader locks, timers and
  caller abort listeners are released. An abort-ignoring transport's late body is
  canceled. A transport that never settles is not forcibly terminated; only its
  caller's wait is bounded. This is not a sandbox for malicious in-process code.
- **Redirects/failures:** `redirect: 'error'`; reported redirects, changed response
  destinations and 3xx statuses fail. Non-success response bodies are canceled,
  not read, and never given to the SDK error parser. There is at most one attempt,
  even with Retry-After or retry-suggesting headers.

## Safe errors and outcomes

Failures are plain `{ ok: false, error: { code, message, outcome } }` values with
fixed messages. No SDK exception, cause, stack, headers, abort reason, prompt,
credential or provider error text escapes. No adapter/SDK logging is enabled.

| Condition | Code | Outcome |
| --- | --- | --- |
| No transport | `processing-blocked` | `not-dispatched` |
| Invalid config/request; pre-abort | `invalid-config` / `invalid-input` / `canceled` | `not-dispatched` |
| 401/403 | `authentication` | `rejected` |
| 429 | `rate-limit` | `rejected` |
| Other 4xx | `provider-rejected` | `rejected`, except 408/409 are `unknown` |
| 5xx | `provider-unavailable` | `unknown` |
| Redirect, transport exception, invalid/refused output | `redirect` / `transport` / `invalid-output` / `refused` | `unknown` after dispatch |
| Timeout/cancel after dispatch | `timeout` / `canceled` | `unknown` |

**Unknown does not mean failed or unbilled.** Never automatically retry or infer
that provider execution/cost was rolled back. Even rejection classifications are
not billing evidence. Durable attempt accounting and reconciliation belong to a
future authorized layer, not this foundation.

## Activation — 2026-10-24, owner-admitted (S6)

The dormant foundation is now wired to a live endpoint under the owner's
explicit decision recorded in the epic memlog (entries 25–26): the user
supplied a key for the OpenAI-compatible endpoint `https://api.kimi.com/coding/v1`
(model `k3`) and directed that terms verification is waived — "the endpoint is
working that says everything… not blockers at all." What this activation is,
honestly:

- **Owner-admitted, terms unverified.** Provider eligibility rests on the
  owner's decision, not on verified no-training/retention/deletion/location
  terms. No D5-compliance or F3-passed claim is made anywhere; the seeded
  processor configuration (migration 012, version 3) states this in the
  disclosure learners see before consenting.
- **Scope:** synthetic non-personal fixtures only (S6 draft pipeline + S7
  take-path), local machines, honest product User-Agent retained — no coding-
  tool impersonation. Real personal data and hosted use remain out of scope.
- **Wiring:** `src/adapters/ai-live.ts` reads the git-ignored
  `.local/ai-provider.json` (never logged/serialized), wraps this adapter with
  a destination-enforcing transport (exact chat-completions URL only), and the
  S6 pipeline (`src/modules/ai-setup/`) dispatches exclusively through the S3
  admission/settlement machinery with a content-free token ledger
  (`app.ai_dispatch_ledger`, untrusted provider claims) bounded by
  `AI_BUDGET` (2,000,000 ledger tokens ≈ the USD 15 owner cap, 1,200 output
  tokens per request, 20 admissions/day).
- **Evidence:** `npm run ai:smoke` (manual, one real call) records
  `.local/ai-smoke-latest.json`; automated gates stay fully offline — every
  test uses injected fake ports.

## Activation prerequisites — deliberately not implemented

Before any live call, separately obtain operator authorization and satisfy the
architecture's admission gates, including:

1. **Eligibility:** an eligible product processor/account/endpoint and verified
   model revision/features, terms, no-training evidence, retention/deletion and
   regional/institutional requirements. Standard no-training terms do not prove
   seven-day deletion compliance. No external account, cost or contract is
   authorized here.
2. **Consent and lineage:** versioned consent for purpose/provider/categories,
   scoped authorization, source/derivative lineage, deletion/revocation/restore
   fencing, including already-dispatched unknown attempts and late output discard.
3. **Durable accounting:** pre-dispatch intent/attempt records, bounded budgets,
   concurrency/rate controls, unknown-outcome reconciliation and cost evidence.
4. **Product controls:** exact-version instructor approval for student-visible AI
   output, publication/quality evidence and unchanged Manual alternatives.
5. **Operational safety:** approved destination-enforcing transport, private secret
   delivery/rotation, runtime security recheck, retention/restore evidence and
   explicit broader-use approval. The existing local-only Node security exception
   is not closed by adapter tests.

Kimi's [platform comparison](https://www.kimi.com/code/docs/en/#platform-comparison)
distinguishes coding membership benefits from product integration. Protocol
compatibility or possession of a coding key does not establish product permission.
Never impersonate an approved coding tool. The previously exposed key must be
revoked/rotated by its owner; it was not reused or stored by this implementation.

## Verification and sources

The [synthetic unit matrix](../tests/unit/openai-compatible.test.ts) runs the real
SDK against fake transports with a global-network trap and a construction observer.
It covers every plan matrix row, UTF-8/escaping ceilings, header isolation,
sanitized HTTP/transport failures, redirects, body cancellation, stalled/late
transport and monotonic deadline starvation. The
[boundary gate](../scripts/check-boundaries.mjs) retains existing rules and rejects
direct/transitive client SDK or keyed-adapter imports, including re-exports,
aliases, dynamic literal imports and literal require calls. Contracts cannot
depend on the SDK. Both TypeScript checks include the new adapter.

Use the repository's `npm run test -- tests/unit/openai-compatible.test.ts` and
`npm run checks` under its explicitly selected verified runtime. The former
also runs existing unit tests because of the current script's directory filter.
Generated development and production Next route types cannot coexist in the
compiler input: move aside the stale ignored type cache for the inactive mode;
before production checks, run `npm exec next typegen` to regenerate matching
production declarations and imports. Afterward restore the user's development
imports and preserved development type cache, keeping production types aside.
Do not suppress TypeScript errors or leave authorized development imports changed.

SDK controls were checked against the installed exact-version source and official
[advanced usage](https://github.com/openai/openai-node#advanced-usage) and
[error handling](https://github.com/openai/openai-node#handling-errors).
Mock success proves protocol behavior only; it proves no live compatibility,
processor eligibility, compliance, generation quality or production readiness.