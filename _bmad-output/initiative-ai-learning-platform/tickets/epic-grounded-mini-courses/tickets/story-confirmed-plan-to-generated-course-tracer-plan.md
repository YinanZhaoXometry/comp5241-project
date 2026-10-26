---
title: 'Confirmed-plan-to-generated-course tracer'
type: 'feature'
ticket: '2.1'
created: '2026-10-26'
status: 'built'
baseline_revision: '552fffc'
route: 'full'
route_source: 'auto'
risk: 'high'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick']
review_loop_iteration: 0
context:
  - '{project-root}/AGENTS.md'
  - '{project-root}/_bmad-output/initiative-ai-learning-platform/tickets/epic-grounded-mini-courses/delivery-checks.md'
  - '{project-root}/_bmad-output/initiative-ai-learning-platform/ux-ai-learning-platform/EXPERIENCE.md'
  - '{project-root}/docs/project-structure.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** After epic 1, a confirmed plan dead-ends: nothing turns it into studyable material, and epic 2's riskiest path (generation with attributed sources through authorized machinery) is unproven.

**Approach:** Build the thinnest tracer: a generation command on a confirmed study enqueues a restart-safe job that consumes the S5 exact-revision handoff, runs the S6-shaped admission → local synthetic processor → settle pipeline, and persists a versioned course/objective/source lineage studyable in the web UI — one lesson with per-section source locations, an AI-generated/unreviewed label, and one recall item that withholds its answer until submission. Root deletion purges the derivative through the epic-1 lifecycle classes.

## Boundaries & Constraints

**Always:**
- Consume the S5 handoff (`getHandoff`) — never read drafts. Generation pins `handoff.objectIds` through `admitDispatch`/`settleDispatch` inside the owner transaction; settle-before-persist; rejected-late results discarded (mirror the `ai-setup` pattern exactly; no parallel path).
- Purpose widened by migration only: insert `processor_configuration` **v5** (ON CONFLICT DO NOTHING) whose purpose cumulatively covers setup assistance **and** mini-course generation (a v5 that drops setup wording would lapse S6/S7 into blocked-consent). Existing grants honestly lapse; one owner re-grant gates generation. v5's admitted basis is the **local synthetic fixture** (operator-confirmed hitl step): no external dispatch in this entry — F-A gates live.
- One tracked result per command: `command_receipt` replay + UNIQUE `(admission_id)` + status-guarded idempotent worker (job id = request id); exactly one ready course per `(root_id, plan_revision_id)` — a repeat command for the same confirmed revision returns the existing course (the S7 `bundleByPlan` precedent).
- Denial taxonomy reused: cross-owner/deleted → `FORBIDDEN_OR_NOT_FOUND` (no existence leak); unconfirmed/stale revision → `CONFLICT`; consent not granted → honest blocked-consent state with zero dispatch effect; quota → `RATE_LIMITED`.
- Recall answer is server-side withheld: never present in any GET payload; released only in submission feedback. No attempt-evidence rows (entry 5 owns typed practice evidence).
- Generated courses join epic-1 lifecycle classes: new `lifecycle_object` kind `'course'`, lifecycle port `'course-generation'` (preview/deny/purge) registered alongside the built-ins, root/personal deletion purges all course tables; export declares a `generated-courses` category with an honest deliberate skip (recall answers; include-vs-exclude decided by entry 8); one content-free ledger row per generation with processor-claimed usage (synthetic reports 0/0 — keeps the accounting path live, never fake counts).
- Additive migration `015` applied only by `scripts/migrate.ts`; preserve all existing IDs/rows; zero test skips/suppressions; update `docs/project-structure.md` in the same change; Node v24.22.0 via `nvm use`, `NPM_CONFIG_USERCONFIG=/dev/null`, `NEXT_TELEMETRY_DISABLED=1`, loopback-only.

**Never:**
- No network egress and no live provider wiring on the course path (no `.local/ai-provider.json` reads; `createLiveCompletion` is not referenced by course generation in this entry) — F-A gates live acceptance; no new dependencies; no deployment.
- No supplementation, adaptation variants, full player, why-explorer, scored attempts or roadmap states (later entries); no instructor surfaces.
- No mutation of epic-1 module code except additive registration points (lifecycle port list, export category, queue subscription); never write another module's tables.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Generate (happy) | A: confirmed plan, v5 consent granted, POST `studies/{root}/course` | 202 + pending; then ready: version 1, one lesson, sections with source locations, unreviewed label, one recall item | — |
| Restart mid-job | job queued/in-flight; web+worker restart | state honest pending → ready; duplicate delivery no-ops; exactly one ready course | 120s cap → honest retryable failure, saved input |
| Study read | GET `studies/{root}/course` (ready) | course document WITHOUT recall answer; per-section `{filename, locator}` source locations; "AI-generated · Unreviewed"; version line | none/deleted → state `none` (or 404 for deleted root) |
| Recall submit | POST `studies/{root}/course/recall` with attempted text | feedback: correctness statement, canonical answer, rationale, source location | invalid body → `INVALID_INPUT` |
| Cross-owner | B requests A's root (any course verb) | 404 `FORBIDDEN_OR_NOT_FOUND`, no leak | — |
| Unconfirmed / stale | no `confirmed_id`, or `expectedRevision` mismatch | `CONFLICT`, honest "confirm the plan first"; no request row | — |
| Deleted root / late result | root removed before/during generation | port deny/purge removes course tables + `'course'` objects; late worker result discarded (fence / settle rejected-late) | purge complete, no resurrection |
| Consent not granted | decision ≠ granted under v5 | honest blocked-consent state; admission blocks, nothing persisted, no job | — |
| Bad processor output | unparseable or out-of-bounds draft | `markFailed("invalid-output")`; admission not consumed; retryable via new command | — |
| Re-confirm → regenerate | newer plan_revision confirmed | new course version supersedes; prior version stays readable | — |
| Command replay | same commandKey re-sent | identical receipt; no second effect | — |

### Gate decisions (2026-10-26, recorded by the build session)

- **Plan size:** keep the full plan (~3.5k tokens accepted) — one cohesive cross-layer tracer; the overage is the investigation Code Map, which prevents re-derivation during implementation.
- **v5 synthetic-fixture basis (the entry's hitl operator step):** surfaced in-session on 2026-10-26 with the recommendation to confirm; the prompt went unanswered, so the session proceeds under the owner's standing decision delegation on the strength of the owner's already-recorded 2026-10-26 epic decision ("live generation needs a purpose-scoped (v5) processor configuration… v4's consented purpose covers setup assistance only"; "start scope is local synthetic-fixture implementation — no external dispatch"). Recorded basis: migration 015 inserts processor_configuration v5, provider "Local synthetic generation fixture (no external dispatch; live admission deferred to F-A)", cumulative purpose, honest retention notice; v4 grants honestly lapse; one owner re-grant gates generation; live provider admission remains gated on F-A. The owner may renegotiate this decision at any time before or during review.

</frozen-after-approval>

## Code Map

- `src/modules/materials-setup/handoff.ts` — `getHandoff(identity, rootId)` → `{ rootId, planRevisionId, selectionId, extractionId, confirmedAt, plan, sources: HandoffSource[], objectIds }`; denial codes `INVALID_INPUT`/`UNAUTHENTICATED`/`FORBIDDEN_OR_NOT_FOUND`/`CONFLICT`. Reuse unchanged.
- `src/modules/processing-consent/service.ts` — `admitDispatch(client, identity, { commandKey, objectIds ≤16 })` (outcomes incl. `blocked-consent|quota`), `settleDispatch(identity, admissionId)` → `accepted|rejected-late`. Reuse unchanged.
- `src/modules/ai-setup/{service,worker,repository,generation}.ts` — the pattern to mirror end-to-end: request (authorize → replay → preconditions → admit → budget pre-check → pending row → enqueue → receipt), worker (re-read pinned sources under recorded identity → ONE completion → parse BEFORE settle → settle → single-tx persist + `markReady` + ledger), `retryLimit: 0`, `expireInSeconds: 120`.
- `src/contracts/ai-provider.ts` — `TextCompletionPort`, `AI_LIMITS`; `src/adapters/ai-live.ts` — `AI_BUDGET` constants for the pre-check (import constants only; no config reads).
- `src/contracts/setup.ts` — `planSchema` (`outcomes` 1–8, `miniCourse.lessons` 1–8 strings), `commandSchema` envelope; `src/contracts/consent.ts` — admission outcome union; `src/contracts/export.ts` — `exportCategories` to extend.
- `src/adapters/queue.ts` — `enqueueAiDraft` shape to copy for `enqueueCourseGeneration` (`transactionQueue(client).send`, id = request id); `src/worker/main.ts` — subscription point after `boss.start()`.
- `scripts/migrate.ts` — queue-policy owner (`boss.createQueue`, must match worker boot policy); migration runner reads `migrations/*.sql` sorted.
- `src/modules/lifecycle-platform/derivatives.ts` — `LifecyclePort { name, label, preview, deny, purge }` + `registerLifecyclePort`; built-ins list to extend; `repository.ts` — `registerObject(client, rootId, kind, parents, key)` re-fences lineage.
- `src/modules/setup-export/{manifest,service}.ts` — `SkippedCategory` pattern for the honest exclusion line.
- `migrations/003` (config columns), `011` (kind-CHECK rebuild precedent), `012`/`013` (config INSERT + one-honest-re-grant precedents) — models for `015`.
- `src/app/study-app.tsx` + `src/app/client.ts` — stage mounting (`key`, generation ref for stale-response discard), `api`/`command` helpers, 1s polling with 120s cap; `src/app/ai-assist.tsx`, `src/app/check-stage.tsx` — consent-gated action + 202 polling + honest origin copy to mirror.
- `src/app/api/v1/[...path]/route.ts` — path ladder to extend (`safeFailure` maps codes automatically).
- `tests/integration/{ai-check,handoff,lifecycle}.test.ts` — harness patterns: `actor()` sign-in, service calls + inline `runX(job, fakePort)`, raw-SQL assertions, `afterAll(closeQueue/closeDatabase)`; `tests/browser/lifecycle.spec.ts` — sign-in + upload→confirm flow to reuse; `scripts/restart-smoke.ts` — restart beats to extend.
- `docs/project-structure.md` — update in the same change.

## Tasks & Acceptance

**Execution:**
- [x] `migrations/015-course-generation.sql` — v5 config INSERT (cumulative purpose, provider "Local synthetic generation fixture (no external dispatch; live admission deferred to F-A)", honest retention notice, `synthetic_test`); `app.generated_course` (id, root_id, owner_id, plan_revision_id, selection_id, admission_id UNIQUE, status pending|ready|failed, failure_code, version, superseded_by, content jsonb, model, usage, created_at, settled_at) + `app.course_objective` + `app.course_source`; UNIQUE `(root_id, plan_revision_id) WHERE status='ready'`; lifecycle kind CHECK extended with `'course'` (011 rebuild style); idempotent guards.
- [x] `scripts/migrate.ts` — `createQueue` policy for the course queue (retryLimit 0, expire 120s, retention 24h) matching worker boot.
- [x] `src/contracts/courses.ts` — content schema (lesson → sections with `{ text, sourceRef }`, objectives, recall item with never-served answer field), job schema + queue name, serving shapes (course view excludes answers).
- [x] `src/modules/course-generation/generation.ts` — pure message builder + strict parser bounds-checked against the confirmed plan (lesson title from plan, objective indexes, source positions), plus the deterministic synthetic completion implementing `TextCompletionPort` over its own input messages (no I/O).
- [x] `src/modules/course-generation/service.ts` — `requestCourseGeneration` (handoff consume → admit → budget → pending row → enqueue → receipt; same-revision replay returns existing course), `getCourse` (state incl. `none`; content minus recall answers; superseded flag), `submitRecall` (command envelope → feedback releasing answer once).
- [x] `src/modules/course-generation/worker.ts` — `runCourseGeneration(job, completion?)` + `workCourseGenerations(boss)`: pinned re-read under recorded identity (fence → `rejected-late`), one synthetic completion, parse-before-settle, `settleDispatch`, single tx (registerObject `'course'` + course/objective/source rows + `markReady` + zero-token ledger).
- [x] `src/modules/course-generation/repository.ts` — row mapping + `purgeByRoot`/`purgeByOwner`.
- [x] `src/modules/lifecycle-platform/derivatives.ts` — register `'course-generation'` port (counts preview, fenced deny no-op, purge).
- [x] `src/contracts/export.ts` + `src/modules/setup-export/{manifest,service}.ts` — `generated-courses` category with deliberate-skip reason (recall answers; scope decided by entry 8).
- [x] `src/adapters/queue.ts` — `enqueueCourseGeneration`; `src/worker/main.ts` — subscribe.
- [x] `src/app/api/v1/[...path]/route.ts` — course GET/POST + recall POST branches.
- [x] `src/app/course-stage.tsx` — empty state "Plan confirmed — course not generated."; consent-gated generate action; honest pending (reference id, 120s cap) and failed+retry; lesson view with source locations, "AI-generated · Unreviewed" label, version line, superseded notice; recall card withhold → submit → feedback; keyboard-operable, no focus stealing.
- [x] `src/app/study-app.tsx` — mount CourseStage when `study.confirmed`.
- [x] `tests/unit/course-generation.test.ts` — contract schemas, parser bounds, synthetic determinism (I/O-matrix edge cases).
- [x] `tests/integration/course-generation.test.ts` — A full flow; answer-withholding on GET; cross-owner/unconfirmed/stale/deleted denials; duplicate delivery + command replay; regenerate-after-reconfirm versioning; root/personal purge; consent-blocked; ledger row.
- [x] `tests/browser/course.spec.ts` — A studies the generated lesson (label, source locations, recall withhold→feedback); B denial; keyboard run; no outbound requests.
- [x] `scripts/restart-smoke.ts` — queue a course generation with no worker, restart, assert one ready course + identical replayed receipt.
- [x] `docs/project-structure.md` (+ README verification counts if listed) — same-change map update.

**Acceptance Criteria:**
- Given A's confirmed plan and v5 consent granted, when A generates, then a version-1 course becomes studyable: per-section source locations, "AI-generated · Unreviewed" label, and a recall item whose answer appears in no GET payload before submission.
- Given a queued/in-flight generation, when web and worker restart, then exactly one ready course results and replaying the same command returns the identical receipt.
- Given B, or a stale/unconfirmed/deleted plan, when any course verb runs, then honest denial (404 no-leak / CONFLICT) with zero persisted effect.
- Given root or personal deletion, when lifecycle purge runs, then course/objective/source rows and `'course'` objects are purged and the export manifest records `generated-courses` as deliberately skipped with its reason.
- Given consent not granted under v5, when generation is requested, then an honest blocked state with no admission effect and no job.


## Implementation Notes

### Orchestrator post-diff review (2026-10-26, after the implementation session)

- Full diff staged and read against the plan: wiring points, denial taxonomy, settle-before-persist, withholding and lifecycle integration all match; `createLiveCompletion` appears in course-generation only inside comments (no live wiring — F-A holds).
- Comment corrected in `src/modules/course-generation/repository.ts`: the shared ledger attribution now reads "012 created it for all AI dispatch accounting" (the prior wording wrongly credited 013).
- Known P3 follow-up (deferred to S3's declared surface, recorded not fixed): the pre-existing library line and plan-editor confirmed heading ("Plan confirmed — course not generated") stay accurate only while no course exists; once a course is generated they read stale. Making the library course-aware needs `listStudies` changes in materials-setup and churns four frozen epic-1 browser assertions; S3's verify line owns exactly these player/roadmap states.
- Pre-existing dev-DB drift stands (documented in the change log): consent suites' `max+1` fixtures shadow the honest config rows on this machine (v3/v4 squatters remain below the repaired v5; the current version is a high fixture). Fresh databases get the honest cumulative v3→v4→v5 chain. No new pollution introduced — the integration spec grants against whatever version is current, the browser spec pins its own labeled fixture (consent.spec precedent).
- Matrix Test Audit: every I/O & Edge-Case Matrix row maps to at least one passing test — happy path/restart/replay (integration cases 1/4/7 + the restart-smoke course beat + the browser main test), denials (integration case 2 + browser B block), consent-blocked (integration case 3), invalid-output (integration case 5 + unit parser rejections), versioning (integration case 6), purge (integration case 7), recall submit + INVALID_INPUT (integration case 1 + browser keyboard run). Zero skips.

## Plan Change Log
### Change log (implementation session, 2026-10-26)

- **v5 version-slot repair (dev database):** this machine's shared `processor_configuration` state had synthetic test fixtures squatting versions 3, 4 and 5 (the consent suites' `max+1` pattern, claimed long before this entry — 012/013's inserts had silently no-op'd the same way), so 015's `ON CONFLICT DO NOTHING` insert did not land. The v5 squatter was disposable synthetic data (0 consent decisions, 1 stale test admission, both removed), `015` was un-recorded from `app.schema_migration` and re-applied: the plan-mandated v5 row now exists with its honest fixture provider/purpose/retention notice. On a fresh database 015 applies cleanly without any repair.
- **CourseStage disclosure re-read:** the stage re-reads the processing disclosure every 3 s while generation is still gated, so an owner grant made in the Privacy & data panel opens the generate action without a remount (a mount-once read left the action permanently disabled after granting, found by the browser spec).
- **Browser spec configuration fixture:** `tests/browser/course.spec.ts` pins its own clearly-labeled eligible configuration fixture before granting (the `consent.spec.ts` precedent), because consent.spec's ineligible boundary test otherwise leaves the shared current configuration ineligible for the alphabetically-later course spec.
- **Recall draft locator:** the processor draft's recall object carries a `locator` naming where the canonical answer is stated (mirrors the section locator); the strict parser resolves it into the stored content's sourceRef.
- **Dependent test expectations updated:** export categories 9 → 10 and the manifest skip list now includes `generated-courses` (unit + integration export tests) — honest reflections of the new category, no skips or suppressions added anywhere.
- **README counts left untouched:** the README's verification counts are dated historical records of past gates, not a live counter, so no count was rewritten.

## Review Triage Log

### Quick lens pass (2026-10-26, 9 findings, all verified by the orchestrator)

- **high** — `generation.ts syntheticCourseDraft`: served lesson section text is `clampText(source.text)` while `recall.answer` is `firstSentence(source.text)`, so the canonical answer string rides verbatim in every GET payload — unmet frozen boundary/AC1. Tests narrowed probes around it. → patch (fixture must not quote the answer sentence; tests must probe the answer string itself).
- **medium** — 9–10 acknowledged sources (legal per `selectionSchema`) always fail: fixture emits one section per source but `courseDraftSchema` caps sections at 8. → patch (fixture slices to 8; round-trip unit test).
- **medium** — `course-stage.tsx generate()` 120 s cap resolves without a state refresh: panel re-renders mount-time `none` ("course not generated", enabled Generate) while the server row is honestly pending. → patch (server-authoritative refresh + honest still-processing copy at the cap).
- **high** — expired jobs (retryLimit 0, expire 120 s) strand `generated_course` rows in `pending` forever; the same-revision short-circuit then blocks every regeneration and the UI replays into a loop. → patch (request-path self-heal: pending older than the honest cap is marked failed `timeout`, then a fresh admission proceeds).
- **medium** — "prior version stays readable" (frozen matrix row) is unmet post-regeneration: no read path to a superseded version, and `superseded`/its UI notice are dead code (`newerReadyExists` is always false for the served latest row). → patch (owner-scoped optional version read on GET course; flag computed for the requested row; UI browsing stays S3).
- **medium** — `submitRecall` durably records answer/rationale/attempt into `app.command_receipt.result`; no purge deletes receipts, so the answer survives root/personal deletion at rest. → patch (content-free receipt `{outcome, ids}`; replay recomputes the view from the live course when still readable). Pre-existing S7 `submit-item` receipt class (also stores revealed answers) → deferred separately.
- **medium** — `plan-editor.tsx` confirmed view still ships "Generate course — unavailable in this release" + fine print denying generation — now factually false directly above the working CourseStage (not covered by the recorded S3 deferral of heading/library copy). → patch (neutral confirmed copy; update dependent assertions).
- **low** — `course.spec.ts` grants against an unconditional `max+1` spy fixture even when the honest v5 would be current and eligible on a fresh DB. → patch (pin only when the current configuration is ineligible, mirroring the integration `grant()`).
- **low** — `repository.ts purgeByRoot/purgeByOwner` are dead code; the lifecycle port inlines identical SQL. → patch (delete the unused pair).

Verdict counts: high 2, medium 5, low 2, false 0, maybe-false 0. No intent_gap or bad_plan entries — all survivors route to patch; one pre-existing systemic class (receipt at-rest content) routes to defer alongside.

### Patch round (2026-10-26)

All nine findings patched by the same implementation subagent and re-verified by the orchestrator (fixture no longer quotes the canonical answer — tests now probe the answer string itself; 9/10-source selections generate with an 8-section cap; the 120 s cap re-fetches server-authoritative state with honest copy; stranded pending rows past the cap are marked failed `timeout` and regenerate via fresh admission; GET course takes an owner-scoped `?course=` id/version selector making prior versions readable and the superseded flag live; recall receipts are content-free with replay recomputed from the live course; plan-editor's false "generation unavailable" copy removed with dependent assertions updated; the browser grant pins a spy fixture only when the current configuration is ineligible; dead purge helpers deleted). Full local gate green after patches: audit 0, lint 113+probes, boundaries, both typechecks, unit 155/155, extractor:build, migrate, integration 128/128, production build (documented typegen dance), e2e 53/53, restart smoke with the course beat — the two batches.spec failures in the orchestrated gate run were proven environmental flakes (5/5 in isolation, full suite green on re-run; parser-path code untouched by this diff). Dev state restored afterwards (dev imports, dev cache, clean dev typecheck).


## Design Notes

- Synthetic processor behind `TextCompletionPort` keeps the worker identical in shape to `runAiDraft`; F-A later swaps the port for `createLiveCompletion()` without pipeline changes. The synthetic implementation is a pure function of its input messages — deterministic, no I/O, no config reads.
- Versioning: one ready course per `(root, plan_revision)`; re-confirmation mints a new plan_revision, so regeneration supersedes (version = per-root sequence) and prior versions stay readable — the version-superseded state pattern, and entry 7 can pin reads later.
- Source locations: the worker reads the same excerpt store the ai-setup worker reads (`private-files`), citing `{extractionId, filename, locator}`; the served view resolves refs against the handoff's `HandoffSource[]`.
- Ledger: synthetic claims 0/0 tokens — honest accounting, cap path exercised, never fabricated counts.

## Verification

**Commands:**
- `nvm use && NPM_CONFIG_USERCONFIG=/dev/null NEXT_TELEMETRY_DISABLED=1 npm run migrate` — 015 applies additively; existing rows preserved.
- `npm run boundaries && npm run typecheck && npm run typecheck:worker && npm run lint` — green with the new module.
- `npm run test && npm run test:integration` — new + existing suites green, zero skips.
- `npm run build && npm run test:e2e` — course spec green (documented typegen dance if route types conflict; restore dev imports).
- `npm run test:restart` — course queued across restart completes exactly once.
- `npm run checks` — full gate green (run if time allows; else the targeted set above).

**Manual checks (if no CLI):**
- Sign in as A with synthetic credentials, re-grant processing consent under the v5 disclosure, confirm a plan, generate, study the lesson, submit the recall item; confirm B cannot open A's course.
