---
title: 'Generation honesty, consent denial and descendant lifecycle'
type: 'feature'
ticket: '2.8'
created: '2026-10-27'
status: 'built'
baseline_revision: '11dc15e'
route: 'full'
route_source: 'auto'
risk: 'high'
review: ''
review_source: ''
lenses_ran: []
review_loop_iteration: 0
context:
  - '{project-root}/AGENTS.md'
  - '{project-root}/_bmad-output/initiative-ai-learning-platform/tickets/epic-grounded-mini-courses/delivery-checks.md'
  - '{project-root}/_bmad-output/initiative-ai-learning-platform/ux-ai-learning-platform/EXPERIENCE.md'
  - '{project-root}/docs/project-structure.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The generation surface's failure, consent and lifecycle behaviors exist per-entry but were never integrated: exports deliberately deferred every derivative class, retention/expiry coverage and the deletion-race guarantees are unproven as a set, and declined-consent degradation is unverified end-to-end.

**Approach:** Close the epic's lifecycle surface as an integration entry: (1) decide and implement export include-vs-exclude per snapshot scope — generated-course content, practice evidence and why explanations are OWNER derivative content and join the export artifact honestly (recall answers included: the owner can already reveal them by submitting; the diagnostic answer-key exclusion never applied to owner-specific courses), while fetched supplement passages stay deliberately excluded with an honest reason (external-source content, not owner material; their identity/location metadata rides along inside the course provenance context where applicable); (2) verify retention/expiry coverage — course derivative purge rides the deletion deadlines through the existing ports and the retention inventory records the classes; (3) prove the race set — generation, supplement and why jobs raced against root and whole-personal deletion commit nothing late (claim-first + fences) and purge completely inside deadlines; duplicate/retry commands yield one tracked effect; (4) declined consent and processor ineligibility degrade to honest AI-unavailable states with zero external calls and zero supplement fetch while every manual path stands; (5) post-deletion provenance reads are scope-denied. No new product surface.

**Gate decisions (2026-10-27):** covered by the owner's "continue to implement all the rest tickets of epic 2" direction; checkpoints proceed under the standing decision delegation (surfaced, logged, renegotiable). The export-scope decision above is recorded as this entry's call (the S8 contract assigns it here); no schema change expected — if the retention inventory needs a registered class member, an additive `021` migration is permitted; no new processor configuration, no dispatch-path changes.

## Boundaries & Constraints

**Always:**
- Honesty rules: by 120 seconds every generation-class job is complete, honest-pending or retryable with saved input — never success-by-timeout (existing codes; assert the SET across course/supplement/why/practice); declined consent or ineligible processor → honest AI-unavailable states (copy per the spine) with zero dispatch, zero fetch, zero request rows, while upload/plan/confirm/manual study stand unchanged.
- Export scope decision implemented exactly: `generated-courses` (full stored content incl. recall answers — owner derivative content), `practice-evidence` (typed rows incl. attempted text), `why-explanations` join the artifact; `supplements` stays a deliberate, honestly-reasoned skip (external-source passages are not owner content). Deleted roots are excluded by snapshot scope exactly like every other class; the manifest counts and labels stay honest; the S8-class tests assert inclusion content and the skip reason.
- Lifecycle: root and whole-personal deletion purge course/request/supplement/practice/why/tracker rows through the ports/cascades and complete inside the 7-day deadlines (assert purge completeness after the reconciler under normal operation); the retention inventory records the derivative classes; late deliveries of expired jobs commit NOTHING (claim-first) — race tests cover course generation, supplements and why against root deletion AND personal removal, including a job already past phase 1 when deletion lands.
- Idempotency set: replay/duplicate/retry across all four command families yield exactly one tracked effect (asserted as a set; most exist — add what's missing).
- Post-deletion: provenance and course reads are scope-denied (no-leak); pinned ids of purged versions deny identically.
- Tests unit+integration (+browser only if a copy change needs it), zero skips; `docs/project-structure.md` same change; Node v24.22.0, loopback-only, no new dependencies, no egress.

**Never:**
- No new product surface or route beyond what integration requires; no scored/credit semantics; no live dispatch; no weakening of any existing fence, skip honesty or lint/test gate.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Export scope | owner with course+practice+why+supplements | artifact includes the three owner classes with content; manifest records the supplements skip with its reason; counts honest | — |
| Declined consent | decision declined/none | all four verbs blocked honestly; zero dispatch/fetch/rows; manual study intact | — |
| Ineligible processor | current config ineligible | honest AI-unavailable; nothing dispatched | — |
| Race: root deletion | course/supplement/why job mid-flight; root deleted | nothing commits late; purge completes inside deadline; late delivery no-ops | — |
| Race: personal removal | same vs all-personal deletion | same, owner-wide | — |
| Duplicate/retry | all four command families | one tracked effect each | — |
| 120-second honesty | each job class past cap | honest pending/timeout states; never success-by-timeout | — |
| Post-deletion reads | provenance/course on deleted root | no-leak denial (pinned ids too) | — |
| Retention inventory | derivative classes exist | inventory records them; deletion deadlines cover the purge | — |

</frozen-after-approval>

## Code Map

- `src/modules/setup-export/{manifest,service}.ts` + `src/contracts/export.ts` — flip three categories from skip to capture (owner content: generated_course content rows, practice_attempt, why_explanation), keep `supplements` skip with the recorded reason; honest counts/labels; update export tests.
- `src/modules/lifecycle-platform/{derivatives,retention}.ts` — confirm port coverage (courses/supplements/practice/why/tracker) and register the derivative classes in the retention inventory if missing (additive `021` only if a class member must be persisted).
- `src/modules/course-generation/*` — no functional changes expected; race/idempotency/consent tests live beside the existing suites; UI copy for AI-unavailable already exists (verify against spine copy, adjust only if dishonest).
- `tests/integration/{course-generation,export,lifecycle,retention}.test.ts` — the S8 set; `tests/unit/export.test.ts` category expectations.

## Tasks & Acceptance

**Execution:**
- [x] Export scope flip + honest labels/counts + tests (three inclusions, one skip, snapshot scope on deleted roots).
- [x] Retention/deadline coverage: inventory registration if needed (+ `021` additive only if required); deletion-deadline tests over course derivatives.
- [x] Race set tests: course/supplement/why vs root deletion and personal removal, including mid-flight deletions; late-delivery no-op assertions.
- [x] Consent-denial/ineligibility end-to-end assertions (zero dispatch/fetch/rows; manual paths intact; honest copy).
- [x] Idempotency set assertions across the four families; 120-second honesty set; post-deletion read denials (incl. pinned).
- [x] `docs/project-structure.md` update; full `npm run checks` at this wave boundary (per plan Verification).

**Acceptance Criteria:**
- Given an owner with the full derivative set, when exporting, then the artifact includes course content, practice evidence and why explanations honestly and records the supplements skip with its reason; deleted roots are excluded by snapshot scope.
- Given a generation-class job in flight, when root or whole-personal deletion lands, then nothing commits late, the purge completes inside the deadline, and late deliveries no-op.
- Given declined consent or an ineligible processor, when any AI verb runs, then an honest unavailable state with zero external effect, while manual study stands.
- Given duplicate or replayed commands in any family, then exactly one tracked effect.
- Given post-deletion reads (default or pinned), then no-leak denial.

## Implementation Notes

## Plan Change Log

## Review Triage Log

### Quick lens pass (2026-10-27, 3 findings, verified by the orchestrator)

- **medium** — the whole-personal-removal race held only the course family mid-flight; the plan requires supplements and why too. → patched by the orchestrator (root-3 supplement job and a root-4 why job held past phase 1 through the removal; late deliveries of all three families no-op; the purge-loop asserts every class empty).
- **medium** — manifest snapshot-scope comments claimed an invalidation guard the practice/why queries did not implement (only the course query did). → patched (the same LEFT JOIN + invalidated_at guard added to both queries, making the comments true; no observable behavior change since invalidation co-occurs with root tombstoning).
- **medium** — plan bookkeeping absent (the implementation agent went inactive mid-verification before ticking tasks or recording runs). → closed by the orchestrator with this log.

Verdict counts: medium 3, false 0, maybe-false 0. All patched.

### Orchestrator completion notes (2026-10-27)

The implementation agent went inactive after writing the code (export flip + S8 suites) but before verification/bookkeeping; the orchestrator restored the dev typegen state, verified the tree (unit 232/232, integration green), applied the two code patches above, and diagnosed two of its own test-run artifacts along the way: the late-delivery job re-derivation must capture jobs BEFORE the purge (fixed), and direct multi-file vitest invocations without --no-file-parallelism race the shared processor_configuration fixtures (the npm script's flag is load-bearing — re-verified 70/70 serial and 181/181 full).

## Design Notes

- The export flip is the entry's one product-visible decision; everything else is integration proof. The reasoning for each class is recorded in the manifest reasons and the plan so entry 10's integrated suite inherits the rationale.
- Prefer strengthening existing tests over new files; the S8 set may extend the existing describes rather than forking a parallel suite.

## Verification

**Commands:**
- `nvm use && NPM_CONFIG_USERCONFIG=/dev/null NEXT_TELEMETRY_DISABLED=1 npm run boundaries && npm run typecheck && npm run typecheck:worker && npm run lint` — green.
- `npm run test && npm run test:integration` — green, zero skips.
- Wave boundary: full `npm run checks` (typegen dance; dev state restored after).

**Manual checks (if no CLI):**
- Decline consent on a fresh account; confirm every AI action is honestly unavailable and manual study works; export and inspect the artifact contents.


### Wave-boundary verification (2026-10-27)

Orchestrated `npm run checks` green through the production build (audit 0, lint 113+probes, boundaries, both typechecks, unit 232/232, extractor:build, db, migrate, integration 181/181). The e2e leg of that run failed en masse from an ENVIRONMENTAL wedge: the Colima docker daemon hung mid-gate (trivy scan deadline-exceeded on the socket) and the compiled TXT helper vanished from `.local/bin` during the integration leg (timestamp 22:21 — the restore suite's scratch-restore is the prime suspect; recorded for the 2.9 sweep). Recovery per repo precedent: colima stop --force/start, extractor rebuilt and fully re-admitted. After recovery: full standalone e2e 57/58 (the single failure a load-sensitive why-settle focus race, hardened with a multi-frame focus retry and green standalone), restart smoke green with the course + supplement beats. Dev typecheck state restored green.

### Patch round (2026-10-27)

Quick-lens findings patched by the orchestrator (the personal-removal race now holds supplement and why jobs past phase 1 alongside generation with all three late deliveries no-oping; the practice/why export queries carry the same invalidation guard the comments claimed; bookkeeping closed). One orchestrator hardening: the why-settle focus effect retries across frames so a concurrent re-render cannot strand keyboard focus. Post-patch: unit 232/232, integration 181/181, e2e 57/58→flake hardened+green, restart green.
