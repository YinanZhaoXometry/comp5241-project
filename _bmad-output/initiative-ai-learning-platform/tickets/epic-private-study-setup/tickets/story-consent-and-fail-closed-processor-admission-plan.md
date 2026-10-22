---
title: 'Consent, policy admission and durable processing controls'
type: 'feature'
ticket: S3
created: '2026-10-22'
status: 'planned'
baseline_revision: 'd851f8f77314ab8f7d8f38e84cac266f7f31916e'
route: 'full'
route_source: 'auto'
risk: 'high'
review: 'quick'
review_source: 'pinned'
lenses_ran: []
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/initiative-ai-learning-platform/tickets/epic-private-study-setup/delivery-checks.md'
  - '{project-root}/_bmad-output/initiative-ai-learning-platform/tickets/epic-private-study-setup/setup-experience.md'
  - '{project-root}/_bmad-output/initiative-ai-learning-platform/tickets/epic-private-study-setup/execution-plan-remaining-stories.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** No durable consent/policy boundary exists between saved manual work and any future external AI dispatch; without one, a later story could egress data without a current, eligible, consented disclosure.

**Approach:** Deliver S3 and U3: versioned processor disclosure storage separate from owner consent, fail-closed admission for every dispatch, content-free dispatch receipts, serialized withdrawal with late-result rejection, and a privacy panel exposing the U3 states.

## Boundaries & Constraints

**Always:** Local synthetic data; content-free receipts (scoped IDs, purpose, outcome only); ineligible configuration stays blocked regardless of any submitted `allow=true`; withdrawal serializes against dispatch via the authorize() principal row lock; settle re-checks fences/consent and is idempotent; manual work, exports and deletion remain available after decline/withdrawal.

**Never:** Live AI calls, external accounts/costs, deployment, real data, new npm dependencies, ticket advancement past 'planned', any claim of provider eligibility (F3), working AI (S6), or epic/release readiness. Synthetic test configurations are prominently labeled and are never presented as compliant live AI.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Ineligible configuration | `POST /processing/decision` grant `allow=true` | Rejected; no consent row; disclosure stays "unavailable"; manual paths intact | `FORBIDDEN_OR_NOT_FOUND` |
| Consent to current disclosure | Explicit Allow on current eligible version, terms acknowledged | One `granted` row; replayed command returns the same receipt | Stale version → `CONFLICT`; reused key with changed request → `CONFLICT` |
| Disclosure changed | New configuration version row | Old grant admits nothing; re-consent required; saved work intact | Admission records `blocked-consent` |
| Withdrawal races dispatch | Separate database clients | One serialized order (authorize() principal lock): either admitted-then-tracked-then-late-rejected, or `blocked-withdrawn`; zero untracked late results | Post-withdrawal grants rejected `CONFLICT` |
| Ancestor fence broken / foreign IDs | Deleted/invalidated/foreign lineage object IDs | Admission records `blocked-fence`; no dispatch | Late result settle → `rejected-late`, idempotent |
| Quota exceeded | Admissions today ≥ configured daily limit | `blocked-quota`; denials never consume quota | Honest receipt recorded |
| Protective recording fails | Withdrawal insert fails | Transaction rolls back; no success without durability | Retryable failure surfaced |

</frozen-after-approval>

## Code Map

- [migration](../../../../../migrations/003-consent-admission.sql): `app.processor_configuration` (immutable versions, seeded ineligible v1 + labeled synthetic test v2), `app.processing_decision` (PK owner+command_key, request hash, session), `app.dispatch_admission` (content-free outcome receipts, settled_at, daily quota index).
- [contracts](../../../../../src/contracts/consent.ts): decide/withdraw/dispatch-scope schemas, pinned `Disclosure` shape, pure decision derivation.
- [repository](../../../../../src/modules/processing-consent/repository.ts) + [service](../../../../../src/modules/processing-consent/service.ts): `getDisclosure`, `decide`, `withdraw`, `admitDispatch(client,…)` (in-caller-transaction), `settleDispatch`.
- [component](../../../../../src/app/privacy-panel.tsx): U3 states incl. prominent synthetic-test label; mounted by the integrator.
- [integration tests](../../../../../tests/integration/consent.test.ts) (incl. the beyond-criteria two-client withdrawal/dispatch race, quota/stale-version/fence blocks, synthetic zero-call/one-effect spy) + [browser cases](../../../../../tests/browser/consent.spec.ts) + [unit contracts](../../../../../tests/unit/consent.test.ts).

## Tasks & Acceptance

**Execution:**
- [x] Amend drafted migration: request hash/session columns, quota index, seeded ineligible v1 plus clearly labeled synthetic test configuration v2; immutable disclosure revisions.
- [x] Contracts, module repository/service with fail-closed admission ordering (session/scope → eligibility → consent-to-current-disclosure → fences → quota) and idempotent settle.
- [x] Privacy panel component with the U3 states; route branch and mount snippets delivered to the integrator (route.ts and study-app.tsx are integrator-owned).
- [x] Integration tests including the beyond-criteria race; browser cases; unit contracts tests. Authored and branch-validated (compile/lint/unit); **DB-backed validation happens at integration** — package worktrees cannot run PG suites (execution plan §1.8).
- [ ] Integrator applies snippet wiring, applies migration 003, runs the full gate (`test:integration`, `build`, `test:e2e`, `test:restart`), then flips status to 'built'.

**Acceptance Criteria:**
- Given any submitted `allow=true`, when the current configuration is ineligible/unknown, then no consent is recorded and no dispatch can be admitted.
- Given a grant on disclosure version N, when a version N+1 exists, then admission records `blocked-consent` and re-consent to the current version is required.
- Given withdrawal racing dispatch on separate clients, then exactly one serialized outcome exists and every late result replays the one recorded outcome.
- Given every denied path, then the synthetic processor spy observes zero calls; given the allowed synthetic path, then exactly one tracked accepted effect.

## Implementation Notes

- 2026-10-22 (package branch, status 'planned' — not built): branch checks passed under Node v24.22.0: `typecheck` ✓, `typecheck:worker` ✓, `lint` ✓ (ESLint 0 warnings/errors; Oxlint 73 files/151 rules; coverage 113 rules + 8 negative probes + JSX positive probe), `boundaries` ✓, `npm test` ✓ 115/115 (110 baseline + 5 new consent contracts tests). **Not run on this branch (blocked per execution plan §1.8, no `.local/` in worktrees):** audit, `db:start`, `migrate`, `test:integration`, `extractor:build`, `build`, `test:e2e`, `test:restart`. This branch passes are implementation evidence only; no S3 completion, F3 eligibility, S6, S7-closure, S12, F1 or release-readiness claim is made or implied.
- Interface pin published exactly as planned: `GET /processing` → `{ configuration: {version, provider, purpose, categories, retentionNotice, eligibility, syntheticTest}, decision: 'none'|'granted'|'declined'|'withdrawn' }`. P6 (export) and P8 (delete preview) read `app.processing_decision` + `app.dispatch_admission` read-only by these names.

## Plan Change Log

- 2026-10-22 — Decision (user-delegated): the drafted migration was amended to seed a SECOND configuration (v2, `eligibility='eligible'`, `synthetic_test=true`, daily limit 3, provider text "Synthetic test spy (local only — not compliant live AI)"). Rationale: U3's synthetic-test row and S3's synthetic-spy acceptance require a dispatchable labeled test configuration for the consent/admission/withdrawal states to exist at all; v1 stays seeded ineligible as the fail-closed default. It enables no external call — no transport exists — and the UI/API must keep the prominent synthetic label.
- 2026-10-22 — Decision: module-owned idempotency (PK(owner,command_key) + `request_hash` + replay) instead of `lifecycle.replay`/`app.command_receipt`, because decisions are owner-scoped, not root-scoped, and the shared receipt shape requires a `rootId`.
- 2026-10-22 — Decision: withdrawal is a terminal protective state for the owner — `decide()` rejects any later grant/decline with `CONFLICT`; the way back is deletion/re-provisioning, not a silent re-grant. (Stronger than the minimum text; recorded here for review.)
- 2026-10-22 — Decision: `settleDispatch` rejects the late result on ANY consent/disclosure change since dispatch (latest decision must be a grant matching the still-current admitted version), in addition to the plan's fences/withdrawal re-check — fail-closed for the high-egress-risk story. `settled_at` replays the recorded outcome idempotently; blocked admissions settle as `rejected-late` without overwriting their recorded blocked outcome.
- 2026-10-22 — Decision: denied admission attempts are also recorded as content-free receipts (outcome `blocked-*`), giving the audit trail S9/S13 consume; denials never consume quota.
- 2026-10-22 — Columns added to the drafted tables: `app.processing_decision.request_hash/session_id`, `app.dispatch_admission.session_id`, partial index `dispatch_admission_daily` for quota counting.
- 2026-10-22 — Deviation (environmental): `docs/project-structure.md` was NOT updated for `src/modules/processing-consent/` — execution plan §1.2 reserves that file for the integrator; the integrator should add the module and `tests/unit/consent.test.ts`, `tests/integration/consent.test.ts`, `tests/browser/consent.spec.ts` entries in the integration change.
- 2026-10-22 — Deviation (environmental): to run `typecheck` in this worktree (no `.next/dev` cache), the gitignored baseline dev type declarations were copied from the main workspace `.next/dev/types/`; `next-env.d.ts` remains byte-identical to HEAD and uncommitted state is preserved.

## Review Triage Log

- Independent review not yet run. Quick review is expected at/after integration per the epic protocol; nothing has been deferred.

## Design Notes

Admission ordering is strictly: parse content-free scope → `authorize()` (session/scope + principal row lock, the serialization point against withdrawal) → configuration eligibility → consent-to-current-disclosure → ancestor fences (`lifecycle.objectsActive`) → configured daily quota → record receipt → return outcome. The caller dispatches only on `admitted`, inside the same transaction, so enqueue/dispatch, receipt and any quota consumption commit atomically. Receipts carry scoped IDs, purpose and outcome only — no document text, prompts, excerpts, rosters or queue payloads; `objectIds` is bounded (1–16 UUIDs) to reject unnecessary identifiers.

Disclosure revisions are immutable (trigger); current = highest version. Decision derivation: latest row by decided time wins; grants/declines answered by a newer version derive to `none` (re-consent); withdrawal derives to `withdrawn` regardless of version.

## Verification

- Branch (this ticket, 2026-10-22): `npm run typecheck`, `npm run typecheck:worker`, `npm run lint`, `npm run boundaries`, `npm test` — all passed, counts above. Manual steps: none; all evidence is command output or synthetic automated tests.
- At integration (integrator): `db:start` + `migrate` (first wave-1 merge applies 003), `test:integration` (new consent.test.ts: 7 cases incl. beyond-criteria race), `build` + `test:e2e` (new consent.spec.ts: 3 cases) + `test:restart` via the documented typegen dance, then the epic's full `npm run checks`.
