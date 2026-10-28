---
title: 'Plan-to-roadmap scored-attempt tracer (3.1)'
type: 'feature'
ticket: 1
created: '2026-10-28'
status: 'built'
baseline_revision: 'dce12ce2d47cbf6c3bef68b130c56170eb2c4fe5'
route: 'full'
route_source: 'auto'
risk: 'high'
review: 'quick'
review_source: 'pinned'
lenses_ran: [quick]
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/initiative-ai-learning-platform/ux-ai-learning-platform/EXPERIENCE.md'
  - '{project-root}/_bmad-output/initiative-ai-learning-platform/product-policies.md'
  - '{project-root}/_bmad-output/initiative-ai-learning-platform/architecture-shared-technical/architecture-shared-technical.md'
  - '{project-root}/docs/project-structure.md'
warnings: [oversized]
deferred: []
---

<intent-contract>

## Intent

**Problem:** Epic 2 delivers generated versioned courses, but no scored path exists: a learner cannot take a required test, receive an honest threshold-boundary verdict, or see whole-mini-course progress. This is epic 3's tracer — it proves the layer path, not full D3/AD-8 acceptance.

**Approach:** New assessment-progress module with the thinnest attempt path: one required objective-linked test from a manually checked synthetic fixture bank, snapshotted (blueprint/questions/rubric/point scale/80% default mark) at start, submitted once, scored deterministically by unrounded scaled-integer cross-product, driving a derived roadmap node state (In progress → Completed).

## Boundaries & Constraints

**Always:**
- Every verb: `identify` → `authorize` → `scopedRoot` → `lifecycle.replay`/`receipt` (content-free) → repository in one `transaction` (AD-2).
- Snapshot blueprint, questions, rubric, point scale and pass mark at start; grading uses only the snapshot (D3/AD-8).
- Pass ⟺ integer cross-product `earned × 100 ≥ 80 × total` (no float division decides); honest decimal display plus explicit Pass/Not passed.
- Correct answers absent from every GET until that attempt is graded; previous attempts stay listed, never overwritten.
- One tracked result per submit command: same commandKey replays the same receipt; a new commandKey on a graded attempt is `CONFLICT`.
- Only the new module's repository writes `app.test_attempt`; epic-1/2 state read only via `getCourse`; FKs `ON DELETE CASCADE`; roadmap node derived (required items done + passed attempt on current version), no award rows.
- Migration 021 idempotent, applied only by `scripts/migrate.ts`; `npm run checks` stays green.

**Never:**
- No recovery, partial credit, gap guidance, parent awards, review-due pills, instructor pass-mark overrides or provisional grades (later entries); no AI dispatch, queue/worker changes or new `processor_configuration` version (synthetic derivation, 017/019 precedent); no lifecycle port (entry 3.9); no editing applied migrations; no answers/attempt text in `command_receipt.result`; no new dependencies; static product pages untouched; loopback-only servers; original synthetic fixtures only.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Start attempt | confirmed plan + ready course | active attempt; pre-start view shows mark 80%, available points, scoring criteria | none |
| Boundary fail | wrong on the 2004-pt item (7996/10000 = 79.96%) | `79.96% — Not passed (mark is 80%)`; node In progress | none |
| Passing rerun | new attempt all correct; required items done | Pass; node Completed | none |
| Exact/above boundary | 8000/10000, 8004/10000 (unit) | Pass, Pass | none |
| Duplicate submit | same commandKey | identical receipt; one graded result | none |
| Resubmit graded | new commandKey | — | `CONFLICT` |
| Cross-owner / deleted root | actor B on A's study; deleted root | — | `FORBIDDEN_OR_NOT_FOUND`, no leak |
| No course / unconfirmed | GET assessment | honest `none`/`offered` | no error |
| Superseded version | newer ready version exists | start pins latest ready; old attempts stay readable on their pin | no error |
| Malformed body | bad uuid/schema | — | `INVALID_INPUT` |

</intent-contract>

## Code Map

- `migrations/021-assessment-attempts.sql` (NEW) — `app.test_attempt` (owner, root FK cascade, course FK cascade, course_version, plan_revision_id, status `active|graded`, snapshot jsonb incl. answer key, earned/total points, passed, timestamps); header names story + write owner.
- `src/contracts/assessment.ts` (NEW) — zod mirroring `src/contracts/diagnostic.ts`: `startTestSchema`/`submitAttemptSchema` extend `commandSchema`; answers live only in the stored snapshot; `AssessmentState` union (none/offered/active/graded + attempts + roadmap node `not-started|in-progress|completed`).
- `src/modules/assessment-progress/bank.ts` (NEW) — manually checked synthetic bank: one required test from course objectives (positional index), 5 choice items, points [1999,1999,1999,1999,2004] (total 10000), declared answer rules, full-credit rubric, 80% default mark.
- `src/modules/assessment-progress/scoring.ts` (NEW) — pure: cross-product pass, honest decimal display (below), zero-total/negative rejection.
- `src/modules/assessment-progress/repository.ts` (NEW) — SQL + ownership header (pattern: course-generation `repository.ts` L5–28); status-guarded grade transition (pattern: `claimReady` L190).
- `src/modules/assessment-progress/service.ts` (NEW) — verbs mirror `takeCheck` (`src/modules/setup-diagnostic/service.ts` L145–180); consumes `getCourse` (`src/modules/course-generation/service.ts` L144) read-only for courseId/version/planRevisionId/objectives/required-item done.
- Reuse: `src/modules/lifecycle-platform/repository.ts` (`scopedRoot` L12, `assertObjects` L56, `replay` L104, `receipt` L135), `src/platform/commands.ts` (`requestHash`), `src/adapters/postgres/database.ts` (`transaction` L14).
- `src/app/api/v1/[...path]/route.ts` — new branches (shape of check verbs L112–125).
- `src/app/assessment-stage.tsx` (NEW), mounted in `src/app/study-app.tsx` after CourseStage (keyed user:root:revision; props `{study,busy,onBusy,onFailure}`; `src/app/client.ts` fetches).
- `src/app/globals.css` — reuse `panel`/`notice`/`answer-row`/`tracker-row`; add only if a state needs one.
- Tests (NEW): `tests/unit/assessment.test.ts`; `tests/integration/assessment.test.ts` (helpers modeled on `tests/integration/course-generation.test.ts`); `tests/browser/attempt.spec.ts` (mirror `tests/browser/course.spec.ts`); one `scripts/restart-smoke.ts` beat; `docs/project-structure.md` same-change update.

## Tasks & Acceptance

**Execution:**
- [x] `migrations/021-assessment-attempts.sql` — create `app.test_attempt` idempotently; no queue/config changes — durable attempt storage.
- [x] `src/contracts/assessment.ts` — commands, snapshot/view schemas (answers server-side only), state union — the honest contract surface.
- [x] `src/modules/assessment-progress/bank.ts` — synthetic boundary-capable test bank linked to objectives — the manually checked fixture (D7).
- [x] `src/modules/assessment-progress/scoring.ts` — pure unrounded cross-product scoring + display — AD-8 arithmetic.
- [x] `src/modules/assessment-progress/repository.ts` — attempt insert/read + status-guarded grade — single write authority.
- [x] `src/modules/assessment-progress/service.ts` — fenced verbs + derived roadmap node — the tracer path.
- [x] `src/app/api/v1/[...path]/route.ts` — assessment branches — HTTP surface.
- [x] `src/app/assessment-stage.tsx` + `src/app/study-app.tsx` — disclosure → options → submit → result/history → roadmap line — the visible flow.
- [x] `tests/unit/assessment.test.ts` — matrix edge cases (boundaries 79.96/80.00/80.04, zero-total, negative, display, bank validity, node derivation).
- [x] `tests/integration/assessment.test.ts` — real-PG end-to-end: snapshot pinning, exactly-once, denial sweep, answer withholding, supersession stability.
- [x] `tests/browser/attempt.spec.ts` — UI journey incl. boundary honesty, In progress → Completed, second-account denial, keyboard/360px, payload no-leak probes.
- [x] `scripts/restart-smoke.ts` — attempt + result survive stop/start; replayed submit yields one receipt.
- [x] `docs/project-structure.md` — add module/migration rows in this change.

**Acceptance Criteria:**
- Given a confirmed plan and ready course, when the owner opens assessment, then threshold (80%), available points and scoring criteria are visible before starting, and no correct answer appears in any GET payload before that attempt is graded.
- Given a submitted attempt scoring 79.96% against the 80% mark, when the result renders, then it reads Not passed with the honest percentage and the course node reads In progress; given a later passing attempt with required items done, then the node reads Completed.
- Given the same submit commandKey re-sent, when handled, then the identical receipt returns and exactly one graded row exists; given a second commandKey on a graded attempt, then CONFLICT.
- Given a second account, deleted root or malformed request, when any assessment verb runs, then FORBIDDEN_OR_NOT_FOUND (no existence/content leak) or INVALID_INPUT per taxonomy.
- Given web/worker restart after grading, when the study reloads, then the attempt, its snapshot and result are unchanged.

## Implementation Notes

D7 fixture check (HITL checkpoint, re-runnable — performed 2026-10-28 against `src/modules/assessment-progress/bank.ts`): every bank item's correct choice is trivially, self-evidently true against its synthetic claim, each wrong choice is self-evidently false, and the rubric declares full credit with per-item points summing to the blueprint total.

Per-item verification list:

1. Item 1 (1999 pts, correct = "b"): claim "the unrounded comparison decides; 79.96% is below the 80% mark so the attempt does not pass" is exactly D3/AD-8 policy and the story's own golden example. Wrong choices each assert a rounding/tilde/rewrite rule the policy explicitly rejects ("79.96% rounds to 80.0%, so the attempt passes", "within one percentage point counts", "change the display so it looks consistent").
2. Item 2 (1999 pts, correct = "b"): claim "the attempt is graded against the question set snapshotted when it started; newer versions apply only to new attempts" is D3 attempt integrity / AD-5 "never a silent replacement". Wrong choices assert mid-attempt silent switching, deletion of the started attempt, and pass-mark recalculation — all explicitly forbidden.
3. Item 3 (1999 pts, correct = "b"): claim "withhold the correct answers until the attempt is submitted, then reveal them with the result" is D3/AD-8 answer withholding. Wrong choices assert pre-submission preview, marking-done-as-pass (D1 "tests remain separate"), and mislabeled unaided AI assistance (D2 evidence separation).
4. Item 4 (1999 pts, correct = "c"): claim "both attempts listed separately; the earlier failure is never overwritten or hidden" is D3 "show previous attempts rather than silently overwriting them". Wrong choices assert overwrite, merged average, and regrading the failed attempt with later answers — all policy violations.
5. Item 5 (2004 pts, correct = "b"): claim "Completed requires the required items explicitly done and the required test passed at its threshold" is D1 content-finished + tests-remain-separate. Wrong choices assert dwell-time completion, celebration-as-completion (R20/D1 no engagement theater), and AI-certified completion without a submitted attempt.

Point scale: [1999, 1999, 1999, 1999, 2004] sums to exactly 10000 (verified in `tests/unit/assessment.test.ts`); correct on items 1–4 and wrong on item 5 yields 7996/10000 = 79.96%, the honest boundary below the 80% mark. Objective links are positional round-robin (`position p → objective index (p−1) mod N`), so every course objective count 1–8 resolves every link and nothing is renumbered or fabricated.

## Plan Change Log

## Review Triage Log

### 2026-10-28 — Review pass
- verdicts: 1 findings — high 0, medium 1, low 0, false 0, maybe-false 0
- findings:
  - `[medium]` `[patch]` `startTest` returned and receipted the freshly resolved current `pin.planRevisionId` while returning a pre-existing open attempt (or raced winner) pinned to an older course version — verified in `service.ts` (the `existing`/winner branches returned the older attempt id beside the newer revision; the supersession integration test asserted only `operationId` equality). Fixed: the result and its receipt now carry the returned attempt's own `plan_revision_id` in all three branches, with a regression assertion (`reoffered.planRevisionId === started.planRevisionId`) added to the supersession test; full verification re-run green.

## Auto Run Result

**Summary.** Epic-3 story 1 (3.1) implemented on branch `feat/epic3-assessment-and-progress` from baseline `dce12ce2…`: the assessment-progress module delivers the thinnest scored path — one required objective-linked test from a manually checked synthetic bank, snapshotted at start (blueprint/questions/answer key/answer rules/rubric/point scale [1999×4, 2004]/80% default mark) into migration 021's `app.test_attempt`, submitted exactly once, graded by the unrounded integer cross-product with the honest two-decimal boundary display (`79.96% — Not passed (mark is 80%)`), answers withheld from every pre-grade GET, prior attempts listed never overwritten, and a derived roadmap node (`not-started`/`in-progress`/`completed` = all required items done + passed attempt on the current course version; no award rows). No recovery, partial credit, guidance, awards, AI dispatch, queue/worker or lifecycle-port changes, per the Never list.

**Files changed.**
- `migrations/021-assessment-attempts.sql` — idempotent `app.test_attempt` (snapshot + exactly-once graded state, one-open-attempt partial unique, FK cascades).
- `src/contracts/assessment.ts` — commands, snapshot schema (answer key server-side only), state/result view types.
- `src/modules/assessment-progress/bank.ts` — D7 manually checked synthetic bank, positional objective links, boundary-capable point scale.
- `src/modules/assessment-progress/scoring.ts` — pure cross-product pass decision, honest display, invalid-rubric rejection, node derivation.
- `src/modules/assessment-progress/repository.ts` — sole writer; status-guarded atomic grade transition.
- `src/modules/assessment-progress/service.ts` — fenced verbs `getAssessment`/`startTest`/`submitAttempt`; read-only `getCourse` consumption.
- `src/app/api/v1/[...path]/route.ts` — assessment route branches.
- `src/app/assessment-stage.tsx`, `src/app/study-app.tsx` — disclosure → options → one submit → verdict/history → roadmap line.
- `tests/unit/assessment.test.ts`, `tests/integration/assessment.test.ts`, `tests/browser/attempt.spec.ts`, `scripts/restart-smoke.ts` — boundary/exactly-once/withholding/denial/restart coverage.
- `docs/project-structure.md` — same-change structure update.

**Review findings breakdown.** One finding (medium): patched as recorded in the Review Triage Log; nothing deferred; nothing rejected.

**Follow-up review recommendation.** `false` — one medium patched (no high; below the two-medium threshold); the patched surface is covered by the added regression assertion and the re-run full gate.

**Verification performed.** Full local gate under Node v24.22.0 with the documented typegen dance (production checks, development imports/cache restored after): audit 0 vulnerabilities; ESLint+Oxlint 0 warnings + 113-rule coverage probes; module boundaries; both typechecks; unit 242/242 (assessment 10); extractor build + sandbox admission; db start + migrations (021 applied); integration 185/185 (assessment 3/3 — one pre-existing restore-suite timing flake at its 30 s vitest budget under triple-gate disk load passed 6/6 in immediate isolation); production build; e2e 61/61 (one pre-existing journey focus flake in the first run passed on the immediate full re-run; the new attempt spec green in every run); restart smoke green including the new assessment beat (attempt + graded result survive restart; replayed submit replays the identical result with one graded row). D7 manual fixture check performed and recorded per-item in Implementation Notes (re-runnable by the owner).

**Residual risks.** None claimed beyond the story's own scope: this is the layer tracer, not full D3/AD-8 acceptance (recovery, partial credit, guidance and award semantics belong to later entries); local synthetic evidence only — no deployment, release-readiness or F1-closed claim; the roadmap node is a thin derived state, not the versioned award contract entry 3.4 builds.

## Design Notes

Display honesty (spine example `79.96% — Not passed (mark is 80%)`): round to one decimal only when that cannot contradict the verdict; otherwise show two decimals. Golden example:
```
earned=7996, total=10000 → 7996×100 < 80×10000 → Not passed; display "79.96%" (one-decimal "80.0%" would mislead)
earned=8000 → 8000×100 ≥ 80×10000 → Pass; display "80.0%"
```
Start resolves the latest ready course version and pins courseId+version+planRevisionId into the snapshot; submit grades only the snapshot, so supersession mid-attempt never changes a verdict (AD-5 "never a silent replacement").

## Verification

**Commands:**
- `nvm use && NPM_CONFIG_USERCONFIG=/dev/null NEXT_TELEMETRY_DISABLED=1 npm run checks` -- expected: all gates green (audit, lint, boundaries, both typechecks, unit, extractor, db+migrate, integration, build, e2e, restart) with the new suites included.
- `NPM_CONFIG_USERCONFIG=/dev/null npx vitest run tests/unit/assessment.test.ts tests/integration/assessment.test.ts --no-file-parallelism` -- expected: pass, boundary cases included.

**Manual checks (if no CLI):**
- D7 fixture check (HITL checkpoint, re-runnable): read every bank item in `bank.ts`; verify each question's correct choice is trivially, self-evidently true against its synthetic claim and the rubric declares full credit with per-item points summing to the blueprint total; record the per-item verification list in Implementation Notes.
