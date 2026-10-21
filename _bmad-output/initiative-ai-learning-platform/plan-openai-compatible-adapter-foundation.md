---
title: 'Dormant OpenAI-compatible adapter foundation'
type: 'feature'
ticket: ''
created: '2026-10-21'
status: 'built'
baseline_revision: '25996156a3e1852003151c6ada4e15432b52be18'
route: 'full'
route_source: 'auto'
risk: 'medium'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick']
review_loop_iteration: 0
context: ['{project-root}/AGENTS.md']
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The platform has no AI protocol adapter. The user approved adapter-only work with mocked tests, not live calls or learner-facing generation.

**Approach:** Add a provider-neutral text-completion port and server-side Chat Completions adapter using the official SDK. Exercise configurable endpoint/model/key through injected fake transport. Without transport, fail closed without SDK construction or ambient credential reads. Do not connect it to application startup.

## Boundaries & Constraints

**Always:** Preserve AD-10 and Manual behavior. Keep keys server-side, out of files/logs/errors; never reuse the exposed key. Configuration alone cannot activate dispatch. Validate HTTPS base URLs without credentials/query/fragment; preserve custom paths. Disable retries, redirects and SDK logging. Bound input, output bytes/tokens and total time through body consumption. Validate external JSON; expose only bounded text/provenance/usage and safe errors. Cancellation/timeout after dispatch means unknown outcome. Pin dependencies and retain all checks. Preserve the authorized pre-existing `next-env.d.ts` development imports without committing them.

**Never:** Live calls, private-file reads, costs/accounts, deployment, real data, provider activation, tool impersonation, unverified external model pins, policy changes or ticket advancement. No UI/routes/jobs/database changes, tools, streaming, Responses API, embeddings or plan generation. This is neither S3 admission nor S6 working AI nor product eligibility for the coding subscription.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
| --- | --- | --- | --- |
| Disabled | No transport; ambient keys present | No client or dispatch | Processing blocked |
| Synthetic completion | Bounded messages, fake transport | One POST preserving base path; validated text/usage | No error |
| Invalid input | Unsafe config, unknown/tool fields, excessive input/tokens | No transport call | Safe config/input error |
| Invalid output | Malformed, empty, refused, tool, truncated or oversize response | No successful completion | Safe refusal/output error |
| Provider failure | 401/403, 429, 5xx, redirect, transport exception | One attempt; no body/key leakage | Classified error; conservative outcome |
| Aborted/slow | Pre-abort, mid-request abort, stalled body | Bounded termination and cleanup | Canceled/timeout; unknown after dispatch |

</frozen-after-approval>

## Code Map

- `src/contracts/setup.ts` — strict Zod conventions; existing plan DTOs unchanged.
- `src/adapters/txt-extractor.ts` — server-adapter placement convention.
- `src/platform/config.ts` — private runtime reader unchanged; new config is explicitly supplied.
- `scripts/check-boundaries.mjs`, `tsconfig.worker.json` — retain provider-independent contracts and both compilation gates; narrow client isolation checks if needed.
- `tests/unit/contracts.test.ts`, `vitest.config.ts` — existing Vitest conventions.
- `package.json`, `package-lock.json` — verified SDK candidate `openai`7.39.0 supports Node24.

## Tasks & Acceptance

**Execution:**
- [x] `src/contracts/ai-provider.ts` — bounded request, neutral port/result, safe errors.
- [x] `tests/unit/openai-compatible.test.ts` — matrix RED tests with fake transport/global-network trap.
- [x] `src/adapters/openai-compatible.ts` — disabled default, explicit config/transport, SDK mapping, bounds, cancellation, sanitized failures.
- [x] `package.json`, `package-lock.json` — exact SDK, no install scripts; native audit.
- [x] `README.md`, `docs/ai-provider-adapter.md`, `AGENTS.md` — dormant status, configuration shape, protocol and activation prerequisites; no real credentials/model pins.
- [x] Run RED/GREEN, full synthetic gate and independent inspection; fix findings.

**Acceptance Criteria:**
- Given installed foundation code, when web/worker start, then no AI route/call/UI appears and existing integration/browser/restart journeys pass.
- Given configuration/ambient keys but no transport, when completion runs, then global-network calls remain zero.
- Given adversarial fake responses, when completion runs, then errors expose no key/prompt/provider-error content and attempts remain bounded.
- Given a request for live activation, when reading documentation, then eligibility, consent/lineage, durable accounting and operator authorization remain explicit prerequisites, not mocked claims.

## Implementation Notes

- 2026-10-21: implemented the neutral port and lazy SDK adapter with explicit transport, no startup imports, strict messages/configuration, UTF-8/wire/body/token bounds, header allowlist, zero retries, redirect denial and fixed safe result errors. Total deadline includes body consumption and monotonic checks against timer starvation. Abort-ignoring late responses are canceled; a never-settling transport is not forcibly terminated.
- Bounds chosen within the approved scope: 32 messages/32KiB input content/64KiB serialized request/32KiB output/128KiB raw response/4096 output tokens; default10s/max30s. Input byte limits are not model-specific tokenization; provider usage is validated claimed usage, not durable accounting.
- Added AST-based transitive client/provider isolation while retaining every existing module-direction/lint/typecheck rule. No UI/routes/jobs/database/config-reader/worker changes. No private configuration was inspected by the agent; existing synthetic test processes used their normal private local fixtures.
- The sole initial tracked modification was the authorized development import pair in the root Next environment declaration. Production build rewrote it temporarily; original development imports and their generated cache were restored. Inactive generated production/development route caches caused duplicate `LayoutProps`; moving only the inactive ignored cache resolved it without suppressions or source gate changes.
- The confirmed project-local development listener was stopped for exclusive browser/restart tests. Test-created web/worker processes stopped normally; no deployment, external processor call, account, real data or ticket advancement occurred. No commit/staging/push was performed.
- Implementation inspection added RED/GREEN regressions for immediate empty-chunk deadline starvation and URL normalization hiding malformed empty authorities/control characters. Existing lint also rejected a class-based observer and control-character regex; equivalent compliant code replaced both, without rule exceptions.
- Independent Quick inspection is **pending**: this session has no subagent/reviewer capability. `lenses_ran` stays empty and the final execution task remains open. Implementation self-inspection and passing gates are not represented as independent review. A self-contained Quick review handoff is prepared beside this plan.
- Parent session resumed verification with reviewer capability: unit102, lint113/probes, boundaries, both typechecks and audit0 independently reran successfully. Independent Quick inspection returned two findings; four new RED cases reproduced them before the minimal corrections. The earlier pending-review note records the implementation handoff state, not the current parent-session capability.
- Parent full verification after patches: unit106, PG15, browser10, restart, sandbox, build, audit0, lint113/probes, boundaries and both typechecks passed. An initial run with development declarations moved aside failed on missing referenced type files; `next typegen` regenerated matching production declarations before rerunning the entire gate successfully. Original development imports/cache were restored afterward; no compiler settings or checks were weakened.
- Independent follow-up inspection confirmed both exact review claims resolved; no further concrete defect in those corrections. Both TypeScript gates passed again after restoring the original development imports/cache. Parent review used the temporary unified diff directly; no standalone handoff artifact is required or relied on.

## Plan Change Log

## Review Triage Log

Independent Quick pass: high0 / medium2 / low0 / false0 / maybe-false0. No findings deferred.

| Finding | Verdict | Route | Evidence and action |
| --- | --- | --- | --- |
| Repeated trailing base-URL separators | medium | patch | SDK separator joining and adapter expected-URL joining disagreed for accepted paths ending `//` or `///`; two RED cases returned not-dispatched transport failure. Keep the configured base path and mirror SDK joining exactly; no new public surface. |
| Dot segments in client alias imports | medium | patch | Alias suffixes were not normalized; two RED cases passed isolation while importing the provider through dot-segment aliases. Normalize alias suffixes before source-map lookup; existing relative handling and rules remain. |

Both rows are resolved: four added cases passed GREEN, the full synthetic gate passed, and an independent follow-up inspection confirmed both exact corrections. Deferred0; frozen intent unchanged; no review loopback.

## Design Notes

SDK controls: https://github.com/openai/openai-node#advanced-usage and https://github.com/openai/openai-node#handling-errors. Use custom `fetch`, `maxRetries: 0`, timeout and `logLevel: 'off'`. Wrap transport for body/redirect limits. This protocol component is not authorization: future policy-owned transport must enforce eligibility, admission and approved connected destinations. Kimi distinguishes coding benefits from product use: https://www.kimi.com/code/docs/en/#platform-comparison.

## Verification

**Measured 2026-10-21:**
- RED: new adapter suite failed because the adapter did not exist; isolation regressions failed before the gate was added; deadline and malformed-URL regressions failed against the prior implementation. GREEN: all98 adapter/isolation cases plus existing4 unit cases passed.
- Clean `npm ci --ignore-scripts --no-fund` passed with exact SDK7.39.0; native audit0; registry audit verified254 signatures/122 attestations. No new runtime dependencies beyond the SDK and no lifecycle scripts run.
- Full `npm run checks` passed: all113 lint mappings/8negative probes/JSXpositive, module and client isolation, both TypeScript gates, unit102, Seatbelt network/read/write probe, isolated PG18 startup/migration, PG15, production build, Chromium10, real web+worker stop/restart/exact plan/session/B-denial/root removal.
- All six I/O matrix rows have executed passing tests: disabled construction/network traps; synthetic POST/path/projection; unsafe config/unknown/tool/size inputs; malformed/refused/tool/truncated/oversize outputs; classified one-attempt HTTP/transport/redirect failures; pre/mid-abort, stalled/late body/transport and timer-starvation deadlines.
- Public browser output inspection:11 JavaScript chunks with no adapter implementation markers. Source diff has no application/worker/platform/migration changes. Original development imports restored; final development-mode typechecks and diff/links inspection are recorded with the review handoff.
- This is synthetic protocol/regression evidence only. Independent review, live compatibility/admission, product eligibility and broader-use/runtime-security approval are not claimed.
- Final parent-session result supersedes the earlier pending-review measurement: Quick inspection ran, two medium findings were reproduced and patched with four new regression cases, and the complete gate passed unit106/PG15/browser10/restart plus all security/static/build/sandbox checks. Live-provider, product-eligibility and release gates remain closed.
- Final hygiene reran registry provenance (254 signatures/122 attestations), checked ten intended files for credential-like material and fourteen local Markdown links, and verified all eight final public JavaScript chunks contain no adapter markers. The initial eleven-chunk measurement above belongs to the implementer's earlier build; the final rebuilt output has eight.

**Commands:**
- `npm run test -- tests/unit/openai-compatible.test.ts` — RED then GREEN, synthetic only.
- `npm run checks` — audit, lint, boundaries, both types, unit, sandbox, PG, build, browser and restart; explicit verified runtime every invocation.
- `git diff --check` plus intended-file inspection — no secrets/unrelated changes; preserve existing development imports.