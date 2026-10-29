---
title: 'Content-plus-tests completion and monotonic parent awards (3.4)'
type: 'feature'
ticket: 4
created: '2026-10-29'
status: built
baseline_revision: 'bd0dbc2d9a94f4b8a6c13eb39e54d3ecf26ab819'
route: 'full'
route_source: 'auto'
risk: 'high'
review: ''
review_source: ''
lenses_ran: []
review_loop_iteration: 0
followup_review_recommended: true
context:
  - '{project-root}/_bmad-output/initiative-ai-learning-platform/product-policies.md'
  - '{project-root}/_bmad-output/initiative-ai-learning-platform/architecture-shared-technical/architecture-shared-technical.md'
  - '{project-root}/_bmad-output/initiative-ai-learning-platform/ux-ai-learning-platform/EXPERIENCE.md'
  - '{project-root}/_bmad-output/initiative-ai-learning-platform/tickets/epic-assessment-and-progress/tickets/story-plan-to-roadmap-scored-attempt-tracer-plan.md'
warnings: [oversized]
deferred: []
---

<intent-contract>

## Intent

**Problem:** Completion is still a DERIVED read-time state (3.1–3.3): no version-scoped award exists, nothing records WHEN completion was earned, the roadmap node recomputes (and could theoretically un-complete), and the parent/monotonic guarantees of AD-5/D1 have no persisted carrier.

**Approach:** Add the monotonic completion-award layer: required content items done + every required test ordinarily passed or fully recovered awards a UNIQUE version-scoped mini-course completion (migration 023 `app.completion_award`, INSERT-once, never updated or deleted by policy); a parent-manifest evaluation awards parent completion only when every required child release is awarded (optional children never block — exercised synthetically for multi-child shapes, since personal study has one mini-course per root); evaluation runs at each contributing verb (submitAttempt pass, submitRetest final clear, and epic-2's markItemDone through an exported assessment interface — the AD-1 cross-module-command pattern); the roadmap node derives FROM awards (a passed/recovered attempt with no award yet still reads honestly In progress); version switching is an explicit informed choice disclosing changed required work; supersession, policy edits and later review outcomes never revoke an earned award.

## Boundaries & Constraints

**Always:**
- An award is awarded exactly once per (owner, course release): status-guarded/idempotent insert (ON CONFLICT DO NOTHING), monotonic — no code path updates, revokes or re-derives an existing award row; history-preserving.
- Award conditions per D1/AD-8: every REQUIRED tracker item done (epic-2 evidence, consumed read-only) AND every required test ordinarily passed (final grade through the provisional fence) or fully recovered (every ledger target cleared) — nothing else awards (no dwell, no engagement, no self-report).
- Parent evaluation: a parent manifest pins its required/optional child RELEASES; parent award only when every required child award exists; optional children never block. In personal study the parent shape is the study's own path (single child); multi-child cases are exercised through synthetic manifests via the module's own writer, mirroring 3.3's planted-fixture precedent.
- The roadmap node and served completion state derive from AWARD ROWS (plus honest pending states); version-scoped: an award pins its course release; a superseding version starts its own award condition set; earned awards on prior versions stay readable and listed.
- Explicit version switch (selecting an older/newer release to study) is an informed command that first DISCLOSES changed required work (added/removed required items and tests) before switching; switching never erases prior awards.
- Every verb keeps the full fence (identify → authorize → scopedRoot → replay/receipt → repository in one transaction); the markItemDone-triggered evaluation joins the caller's transaction or runs in its own fenced transaction consistently; receipts content-free; `npm run checks` green.

**Never:**
- No award revocation, averaging or rewriting (policy edits, review outcomes, invalid-item findings never touch earned rows — 3.7 owns pausing pending decisions); no completion from provisional grades; no XP/locks/rewards; no instructor surfaces (epic 5); no AI dispatch; no lifecycle-port changes (entry 3.9 registers awards in the deletion/export inventory); no editing applied migrations; no new dependencies; loopback-only, original synthetic fixtures only.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Full completion | last required item marked done after a passed (or fully-recovered) test | exactly one award row inserted (idempotent on repeat events); node Completed; award timestamp served | none |
| Missing test | all items done, test failed/unrecovered | no award; node honestly In progress | none |
| Missing item | test passed, a required item not done | no award; node In progress | none |
| Duplicate triggers | the same completing event re-fires (replay, repeat mark) | one award row (ON CONFLICT DO NOTHING); identical receipts | none |
| Parent complete | synthetic parent manifest: every required child awarded | parent award inserted once | none |
| Parent incomplete | one required child unawarded; an optional child unawarded | no parent award (optional never blocks) | none |
| Supersession | a new course version becomes current after an award | prior award intact and listed; the new version has its own unawarded condition set | none |
| Policy edit / later review | any later state change on the version | earned award unchanged (byte-identical row) | none |
| Version switch | explicit switch command to another release | changed required work disclosed BEFORE switching; prior awards never erased | none |
| Stale/foreign switch or denial sweep | standard taxonomy | — | `CONFLICT` / `FORBIDDEN_OR_NOT_FOUND` / `INVALID_INPUT`, no leak |

</intent-contract>

## Code Map

- `migrations/023-completion-awards.sql` (NEW) — `app.completion_award` (id, owner_id, root_id FK, course_id FK CASCADE, course_version, plan_revision_id, kind `mini-course|parent-path`, child manifest jsonb for parent rows, awarded_at; UNIQUE (owner_id, course_id, kind)); idempotent guards; header names story + write owner (assessment-progress).
- `src/contracts/assessment.ts` — EXTEND: award view types (`CompletionAwardView`, parent-manifest types), `switchCourseVersionSchema` (commandSchema + courseId + acknowledged-changes shape), completion state on `AssessmentState` (awards list + current-version award).
- `src/modules/assessment-progress/scoring.ts` — EXTEND: pure `completionEarned(inputs)` (required done + passed-or-recovered per the grade fence) and `parentEarned(manifest, childAwards)`; node derivation reads award existence.
- `src/modules/assessment-progress/repository.ts` — EXTEND: `insertAward` (ON CONFLICT DO NOTHING, returns inserted bool), `awardsForRoot`, parent-manifest read/write (module-owned).
- `src/modules/assessment-progress/service.ts` — EXTEND: `recordCompletionIfEarned` (exported, transactional, called from submitAttempt/submitRetest and epic-2's markItemDone — the AD-1 exported-interface pattern; join the caller's transaction where one is open, else open its own fenced one); `switchCourseVersion` verb (disclosure GET + confirmed switch command); awards served in `getAssessment`.
- `src/modules/course-generation/service.ts` — EXTEND (one call): `markItemDone` invokes the exported completion hook after its own writes — read-only consumption of assessment's interface, no reverse writes.
- `src/app/api/v1/[...path]/route.ts` — EXTEND: switch-disclosure GET + switch POST branches.
- `src/app/assessment-stage.tsx` — EXTEND: awards line (version-scoped, listed never overwritten), switch flow with changed-work disclosure.
- Tests: `tests/unit/assessment.test.ts` (+completionEarned/parentEarned matrices), `tests/integration/assessment.test.ts` (+award lifecycle: exact-once across duplicate triggers, item/test orderings, parent synthetic manifests, supersession non-revocation, switch disclosure), `tests/browser/attempt.spec.ts` (+award/switch journey honesty), `scripts/restart-smoke.ts` (+award survives restart), `docs/project-structure.md` same-change update.

## Tasks & Acceptance

**Execution:**
- [x] `migrations/023-completion-awards.sql` — award table + parent manifest storage.
- [x] `src/contracts/assessment.ts` — award/manifest/switch contracts.
- [x] `src/modules/assessment-progress/scoring.ts` — pure completion/parent predicates.
- [x] `src/modules/assessment-progress/repository.ts` — idempotent award + manifest writers.
- [x] `src/modules/assessment-progress/service.ts` — recordCompletionIfEarned + switchCourseVersion + award serving.
- [x] `src/modules/course-generation/service.ts` — markItemDone completion hook.
- [x] `src/app/api/v1/[...path]/route.ts` — switch branches.
- [x] `src/app/assessment-stage.tsx` — awards line + informed switch flow.
- [x] Tests (unit/integration/browser) + restart beat per matrix.
- [x] `docs/project-structure.md` — same-change update.

**Acceptance Criteria:**
- Given all required items done and the required test passed (or fully recovered), when any contributing verb completes, then exactly one version-scoped award row exists (duplicate triggers insert nothing new), the node reads Completed, and re-derivation never changes the row.
- Given any incomplete condition (missing item, failed/unrecovered test, provisional-typed result), when evaluation runs, then no award exists and the state reads honestly In progress.
- Given a parent manifest whose required children are all awarded, when evaluation runs, then the parent award exists exactly once; an unawarded required child blocks while an unawarded optional child never does.
- Given an earned award, when the course is superseded, a policy edited, or a review outcome lands, then the award row and its served view are unchanged and still listed.
- Given an explicit version switch, when the learner confirms the disclosed changed-work diff, then the studied version moves and no award is erased; stale/foreign/unconfirmed switches deny per taxonomy.

## Implementation Notes

Design decisions taken inside the plan's latitude (recorded per the plan's own instruction that the Design Notes leave the manifest carrier to the implementer):

1. **One award table, manifest INTENT rows** (the plan's preferred shape): `app.completion_award` carries kind `mini-course` rows (INSERT-once per `UNIQUE (owner_id, course_id, kind)`, `awarded_at` set at insert, no status column — no code path can update them) and kind `parent-path` manifest carriers (the "parent award INTENT rows": `manifest_id` + `manifest` jsonb pinned at plant time, `awarded_at` NULL until the single status-guarded `UPDATE ... WHERE awarded_at IS NULL` lands the award; nothing ever clears it). A partial `UNIQUE (owner_id, manifest_id) WHERE kind='parent-path'` keeps one row per manifest identity; a manifest edit is a new manifest identity, never a rewrite.
2. **`app.studied_release`** (second, small table in 023): the explicit switch needs durable state ("the studied version moves" is observable across reads and restarts), and it is deliberately NOT an award-table column — award rows never change after insert, while the pointer is mutable learner choice upserted only by the switch verb. `ON DELETE CASCADE` from `generated_course` returns a purged study to default (latest-ready) resolution.
3. **Evaluation scope**: each contributing verb evaluates the course release its evidence belongs to — submitAttempt the attempt's `course_id`, submitRetest the ROOT attempt's release (the chain pins it), markItemDone the command's `courseId`. Epic-2 tracker evidence is consumed read-only through course-generation's scoped repository reads (`readyCourseById`, `itemStates`, plus the new `readyCourseVersions`), the codebase's established cross-module read precedent (`batchRow`, `preferenceRow`, `ledgerTotalTokens`); the exported `recordCompletionIfEarned` hook joins the caller's transaction (AD-1 cross-module command), or runs its own full fence standalone. Parent evaluation re-runs idempotently inside every contributing verb of a REQUIRED child (an optional child's award changes nothing).
4. **Node derivation from awards**: `deriveRoadmapNode` now reads `awardOnCurrentVersion` — completed ⟺ an earned award pins the STUDIED release (explicitly switched when a pointer exists, else the default resolution); a passed/recovered attempt with no award yet reads honestly In progress, and a later failed retake or supersession never un-completes an awarded release.
5. **Switch semantics**: the served disclosure GET diff is added/removed REQUIRED tracker item ids plus `requiredTestChanged` (the required test is deterministic derivation from a release's objectives, so differing objectives ⇒ changed test); the confirmed switch re-computes the diff inside the fenced transaction and requires the acknowledged set to match EXACTLY (stale/unconfirmed ⇒ CONFLICT, foreign target ⇒ FORBIDDEN_OR_NOT_FOUND). The pointer steers getAssessment/startTest resolution through getCourse's existing explicit per-version read path, so the offered disclosure and a started attempt's pin always agree (the 3.1 returned-attempt's-own-pin invariant).

## Plan Change Log

## Review Triage Log

## Design Notes

Award at verb time, not read time: completion is an EVENT (the moment the last condition lands), so evaluation runs inside the three contributing verbs' transactions; the exported hook lets epic-2's markItemDone participate without epic-2 writing assessment tables. The parent manifest is stored on parent award INTENT rows (or a manifest table the implementer picks — keep it one table if possible): multi-child shapes are test fixtures via the module writer (the 3.3 planted-fixture precedent), not new learner-facing structure.

## Auto Run Result

**Status: BUILT — the environment block is resolved; every leg is green.** The "machine exhaustion" diagnosis was wrong; the true root causes were found and fixed 2026-10-29:

1. **Parser-admission transient (week-old latent bug):** one docker-CLI hiccup inside the fail-closed admission check failed the whole extraction job with no retry — this intermittently killed browser setups since 2026-10-28 (diagnosed then as machine exhaustion). Fix: `admittedParser` retries the read-only verification once after 250ms (every check still runs; persistently failing admissions still fail closed). RUN DEVIATION, deliberately out of this story's planned files: it blocked the whole lane's verification; fingerprint re-established by `npm run extractor:build`, then the full gate's own extractor step re-validated it.
2. **Assessment-panel staleness:** after an API-driven regeneration the panel never re-read (its poll stopped once non-`none`; the study panel's refresh signal rides course readiness it had already seen). Fixes: `study.revision` added to the read-effect deps + an always-on 2s/3s poll.
3. **Switch-confirm stale revision:** the confirm command carried the UI study object's possibly-stale `expectedRevision` and was silently denied after API-driven regenerations. Fix: the confirm envelope carries the DISCLOSURE's server-fresh revision (review-hardened below).

**Review (quick lens, 7 findings, 2 patched):** switch-confirm minted a fresh commandKey per click (lost-response retry would CONFLICT against a committed switch) — fixed with a pinned per-disclosure envelope; the switch validated its acknowledgment against pre-transaction views (a two-tab interleave could confirm a disclosure computed against a superseded release) — fixed by re-resolving the current studied release inside the fenced transaction and refusing with CONFLICT when it moved. Two findings were refuted by evidence postdating the lens's snapshot (browser legs green in the final gate: e2e 64/64 incl. all four assessment journeys); one was finalize-ordering (dev imports restored before commit); one is the documented admission-retry deviation above; one is inherent (policy-edit/review-outcome non-revocation is structurally guaranteed — no such verbs exist until entry 7's tests).

**Verification (final):** full local gate green end to end — audit 0; lint+coverage; boundaries; both typechecks; unit 14 files (assessment 39); extractor build + re-admission; db + migrations (023); integration 193/193 (assessment 11: award exact-once across duplicate triggers, byte-identical through failed retake and supersession, synthetic parent manifests incl. optional-never-blocks, informed switch with prior awards never erased); production build; e2e 64/64 (8.1m) including "A earns a version-scoped award, regenerates, and switches back only after the changed-work disclosure"; restart smoke green (award survives restart). Post-review-patch re-verification: tsc + eslint clean, scoped suites 2 files green, award journey green solo (57.6s) against the rebuilt bundle. Residual: no dedicated automated test for the interleaved-switch CONFLICT (verified by inspection + types; the scenario needs a same-owner concurrent-switch harness) — recorded as the named follow-up risk.

**Summary.** Migration 023: `app.completion_award` (insert-once monotonic awards; parent-path manifest carriers in-table) + `app.studied_release` (explicit switch pointer). Pure `completionEarned`/`parentEarned` predicates (empty-required and vacuous-parent never award; provisional fenced via gradeAwardsCompletion). `recordCompletionIfEarned` exported hook joining the three contributing verbs' transactions (submit pass, retest final clear, epic-2 markItemDone — the AD-1 cross-module pattern). `switchCourseVersion` with disclosure-before-switch, exact-acknowledgment, and in-transaction from-verification. Node derives FROM award rows. UI: awards line, informed switch flow, eventual-consistency poll.

## Design Notes

Award at verb time, not read time: completion is an EVENT (the moment the last condition lands), so evaluation runs inside the three contributing verbs' transactions; the exported hook lets epic-2's markItemDone participate without epic-2 writing assessment tables. The parent manifest is stored on parent award INTENT rows (or a manifest table the implementer picks — keep it one table if possible): multi-child shapes are test fixtures via the module writer (the 3.3 planted-fixture precedent), not new learner-facing structure.

## Auto Run Result

**Status: BLOCKED (environment), not code.** The implementation is complete and verified at every level except the NEW browser journey's execution on this machine tonight:

Verified green: full local gate ×2 through integration 193/193 (story-4 awards: exact-once across duplicate triggers, byte-identical through failed retake and supersession; synthetic parent manifests incl. optional-never-blocks and one-unawarded-required-blocks; informed switch flow with prior awards never erased), unit 39 (assessment) incl. completionEarned/parentEarned matrices, scoped 50/50, production build, real-process restart smoke.

Blocked: the NEW award/switch browser journey. Diagnosis trail: (1) real UI staleness bug found — after an API-driven regeneration the panel never re-read (data-layer diagnostic proves the API serves v2/in-progress while the page stayed v1/Completed); two fixes built (study.revision added to the read-effect deps; always-on 3s poll replacing the none-only poll) and confirmed into the production bundle; (2) every subsequent browser run — including journeys that were green all night — stalls in SETUP (extraction preview) with all tests timing out at 5:0m; the manually-run worker is healthy (worker-ready, no errors), no advisory locks held, queue shows the historical 20k completed extractions, disk at 7.3Gi with macOS CacheDelete thrashing, uptime 1d14h. Conclusion: machine-level exhaustion; the browser leg needs a healthy environment (restart recommended) and must re-run `npx playwright test tests/browser/attempt.spec.ts` plus a full gate before this plan can leave blocked.

**Summary (code as it stands).** Migration 023 `app.completion_award` (insert-once monotonic awards; parent-path manifest carriers in-table) + `app.studied_release` (explicit switch pointer); pure `completionEarned`/`parentEarned` predicates (empty-required and vacuous-parent never award; provisional fenced); `recordCompletionIfEarned` exported hook joining the three contributing verbs' transactions (submit pass, retest final clear, epic-2 markItemDone — the AD-1 cross-module pattern); `switchCourseVersion` with disclosure-before-switch; node derives FROM awards; UI awards line + informed switch flow + eventual-consistency poll.

## Verification

**Commands:**
- `nvm use && NPM_CONFIG_USERCONFIG=/dev/null NEXT_TELEMETRY_DISABLED=1 npm run checks` -- expected: all gates green (documented typegen dance; dev state restored after).
- `NPM_CONFIG_USERCONFIG=/dev/null npx vitest run tests/unit/assessment.test.ts tests/integration/assessment.test.ts --no-file-parallelism` -- expected: pass, award matrices included.

**Manual checks (if no CLI):**
- Read the award table after the integration run: exactly one row per completing fixture, byte-stable across the supersession/switch cases (recorded in Implementation Notes).
