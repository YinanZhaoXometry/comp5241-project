---
title: 'Owner-admitted AI topic inference and plan drafting'
type: 'feature'
ticket: 6
created: '2026-10-24'
status: done
baseline_revision: 'd152ae7'
route: 'full'
route_source: 'auto'
risk: 'high'
review: 'quick'
review_source: 'pinned'
lenses_ran: []
review_loop_iteration: 0
context: 'Built under the owner decision recorded in epic memlog entries 25-26 (terms verification WAIVED by owner direction — "the endpoint is working that says everything"); F3 is satisfied by owner admission, not by verified provider terms. No D5-compliance claim is made anywhere; the learner-facing disclosure states owner-admitted/terms-unverified.'
---

# S6 — owner-admitted AI topic inference and plan drafting

## What was built (2026-10-24)

- `migrations/012-ai-processing.sql`: processor_configuration v3 (owner-admitted Kimi coding endpoint, eligible, synthetic_test, daily limit 20, truthful retention notice), `app.ai_draft_request` (one per admission, terminal pending→ready|failed), `app.ai_dispatch_ledger` (content-free owner token accounting; survives root purge by design, purged on personal removal).
- `src/adapters/ai-live.ts`: git-ignored `.local/ai-provider.json` loader (key never logged/serialized), destination-enforcing transport (exact chat-completions URL only), `AI_BUDGET` (2,000,000 ledger tokens ≈ USD 15, 1,200 output tokens/request).
- `src/modules/ai-setup/`: `generation.ts` (bounded fair-truncation prompt builder, strict JSON draft validation — invalid replies are rejected, never guessed), `service.ts` (request through `admitDispatch` + budget pre-check + idempotent command replay; owner-scoped read), `worker.ts` (one attempt, re-reads pinned sources under fences, settles BEFORE persisting — rejected-late results are discarded), `repository.ts`.
- Queue `ai-draft` (retryLimit 0, 120s expiry), worker registration, API routes `POST/GET /v1/studies/:root/ai-draft`.
- UI `src/app/ai-assist.tsx`: consent-gated advisory panel — topic chips pre-fill the Manual topic field; the draft loads into the plan editor as editable unsaved fields; save/confirm stay Manual; honest pending (120s cap), failure and retry states.
- Lifecycle: `ai_draft_request` registered as a root-scoped derivative (purge via derivatives port); exports deliberately exclude advisory drafts with a manifest skip note.

## Verification

- Unit `tests/unit/ai-setup-generation.test.ts` (prompt bounds, truncation fairness, strict validation, destination allowlist) and integration `tests/integration/ai-draft.test.ts` (advisory happy path with Manual confirm unchanged, replay idempotency, consent-declined, withdrawal/deletion races discard results, invalid output, no-provider, budget cap, daily quota, cross-owner denial) — all with injected fake ports, zero network.
- Full local gate at HEAD (see README Verification) — recorded after this build.
- Live evidence: `npm run ai:smoke` single real call, recorded at `.local/ai-smoke-latest.json` (never the key).

## Honest scope

Owner-admitted, terms unverified; synthetic non-personal fixtures only; no D5/F3-passed claim; S7 take-path and 1.12 re-slice follow separately.
