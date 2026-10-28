---
title: 'Snapshotted scoring surface and pass-mark boundaries (3.3)'
type: 'feature'
ticket: 3
created: '2026-10-28'
status: 'built'
baseline_revision: '4869a44dea9c2234dd465258d717d4d8f2d0d598'
route: 'full'
route_source: 'auto'
risk: 'high'
review: ''
review_source: ''
lenses_ran: []
review_loop_iteration: 0
followup_review_recommended: true
context:
  - '{project-root}/_bmad-output/initiative-ai-learning-platform/ux-ai-learning-platform/EXPERIENCE.md'
  - '{project-root}/_bmad-output/initiative-ai-learning-platform/product-policies.md'
  - '{project-root}/_bmad-output/initiative-ai-learning-platform/architecture-shared-technical/architecture-shared-technical.md'
  - '{project-root}/_bmad-output/initiative-ai-learning-platform/tickets/epic-assessment-and-progress/tickets/story-plan-to-roadmap-scored-attempt-tracer-plan.md'
warnings: [oversized]
deferred: []
---

<intent-contract>

## Intent

**Problem:** The scored surface (3.1/3.2) is full-credit-only with whole points and a bare 80% constant: D3/AD-8's remaining scoring surface — disclosed finite-precision partial credit, instructor pass-mark overrides carried as snapshotted contracts, and the provisional-grade state epic 5 confirms — does not exist.

**Approach:** Extend the assessment module's snapshot/scoring contracts and fixtures: per-item OPTIONAL disclosed partial-credit rubrics with declared finite precision (scaled integers — no float ever decides), instructor pass-mark override carried as an attempt-snapshotted contract type (no instructor UI/route), and a provisional-grade state that structurally cannot satisfy completion; keep every 3.1/3.2 boundary, exactly-once and denial behavior green.

## Boundaries & Constraints

**Always:**
- Every arithmetic decision stays an overflow-safe integer cross-product; fractional values exist only as declared-scale integers; display scales for humans and never contradicts the verdict.
- Partial credit only under a per-item disclosed rubric in the snapshot (absent = full credit only); every credit is nonnegative — no negative marking; invalid/zero-total/non-precision-conforming rubrics are rejected at snapshot build, never repaired.
- The instructor pass-mark override is a carried CONTRACT on the snapshot (source/provenance/value), snapshotted at start like every policy; personal study keeps the 80% default — no instructor route or UI ships.
- The provisional-grade state is a typed contract that can never award completion: `deriveRoadmapNode`/`recoverySatisfied` accept only graded-passed or fully-recovered evidence.
- Policy edits (mark/rubric) affect only NEW attempts — a running attempt's pinned snapshot decides it; mid-attempt edits never revoke an earned pass.
- Pre-start disclosure grows to show any partial-credit rubric; answers withheld until grading; receipts content-free; every verb keeps the full fence; `npm run checks` green.

**Never:**
- No AI dispatch or live anything; no instructor UI/routes (epic 5); no subjective grading that AWARDS anything (the provisional type is contract-only); no recovery/guidance/award changes (other entries); no editing applied migrations (a rubric-shape change lands in a new additive migration if stored shape changes); no new dependencies; loopback-only, original synthetic fixtures only.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Partial-credit item | item carries disclosed rubric; answer maps to declared partial credit | earned = declared fraction of item points (scaled-integer exact); disclosure showed the rubric pre-start | none |
| No-rubric item | full-credit item (all existing fixtures) | whole points or zero, unchanged | none |
| Boundary matrix stays | 79.96/80.00/80.04 vs 80 under any rubric/scale | Not passed/Pass/Pass, honest display | none |
| Policy edit mid-attempt | mark/rubric changes while an attempt is open | running attempt grades on ITS pinned snapshot; the next attempt snapshots the new policy | none |
| Override contract | snapshot built under a carried override value | that attempt's applicable mark is the override; disclosure shows it; default stays 80 | none |
| Provisional grade | a provisional-typed result exists | served labeled Provisional; completion/recovery derivations ignore it | none |
| Invalid rubric | zero-total, negative credit, precision mismatch, forged fields | rejected at build/parse | `INVALID_INPUT` |
| Repeated submit / denial sweep | 3.1/3.2 taxonomy | one receipt; FORBIDDEN_OR_NOT_FOUND/CONFLICT/INVALID_INPUT, no leak | per taxonomy |

</intent-contract>

## Code Map

NOTE (pre-planned draft, authored during 3.2's gate from the completed spec investigation): the formal run re-derives this map against the landed tree — verify every symbol below still exists and read 3.2's final shapes first.

- `src/contracts/assessment.ts` — `snapshotCoreSchema` (3.2's shared core: where finite precision + optional per-item partial-credit rubric + `passMarkOverride` carried type land, for attempts AND retests together), `snapshotItemSchema` (`points` field), `attemptStatuses` (provisional-grade contract type beside, not inside), `TestDescriptorView` (disclosure grows the rubric).
- `src/modules/assessment-progress/scoring.ts` — `scoreAttempt`/`displayPercentOf`/`groupResultsOf`/`groupCleared` (all stay integer-exact; earn-by-declared-credit replaces the whole-points branch when a rubric exists).
- `src/modules/assessment-progress/bank.ts` — full-credit root + retest pools stay; ADD one manually checked partial-credit fixture (D7) exercising the new surface.
- `src/modules/assessment-progress/service.ts` — `submitAttempt`/`submitRetest` grading path; `descriptorOf` disclosure; snapshot build sites (`buildSnapshot`/`buildRetestSnapshot`).
- `src/modules/assessment-progress/repository.ts` + `migrations/` — only if the stored snapshot/result shape needs new columns (additive migration 023; 021/022 CHECKs untouched).
- Carried-contract precedent: `src/contracts/provenance.ts` (strict shape, forbidden fields structurally absent) for the override/provisional types.
- Tests: extend `tests/unit/assessment.test.ts` (rubric arithmetic, boundary matrix under scale, rejection set), `tests/integration/assessment.test.ts` (policy-edit-mid-attempt, override snapshot, provisional-ignored-by-node, disclosure), `tests/browser/attempt.spec.ts` (disclosure shows rubric; boundary honesty unchanged), `scripts/restart-smoke.ts` only if behavior shape changes; `docs/project-structure.md` same-change update.

## Tasks & Acceptance

**Execution:**
- [x] `src/contracts/assessment.ts` — finite-precision points/rubric schemas + override/provisional contract types.
- [x] `src/modules/assessment-progress/bank.ts` — partial-credit fixture + builders carry the new shape.
- [x] `src/modules/assessment-progress/scoring.ts` — declared-credit earning + scale-aware display, rejections.
- [x] `src/modules/assessment-progress/repository.ts` + migration (only if needed) — stored-shape extension. (Verdict: NOT needed — the snapshot jsonb carries `pointsScale`/`passMarkOverride`/per-item `partialCredit` additively inside the immutable at-start pin and the earned/total integer columns already hold scaled integers; migrations 021/022 and their CHECKs are untouched, so no migration exists for 3.3.)
- [x] `src/modules/assessment-progress/service.ts` — grading/disclosure/snapshot-build integration; provisional label served.
- [x] `src/app/assessment-stage.tsx` — disclosure renders rubric/override; verdict copy unchanged.
- [x] Tests: unit / integration / browser extensions per matrix.
- [x] `docs/project-structure.md` — same-change update.

**Acceptance Criteria:**
- Given an item with a disclosed partial-credit rubric, when a learner answers, then earned points equal the declared finite-precision credit exactly (integer arithmetic; display never contradicts the verdict), and the rubric was visible before start.
- Given a mark/rubric policy change while an attempt is open, when that attempt submits, then it grades under its pinned snapshot and the next attempt carries the new policy.
- Given a provisional-typed result, when the roadmap node and recovery derivations run, then it contributes nothing to completion and is served labeled Provisional.
- Given the full 3.1/3.2 suite, when re-run, then every boundary, exactly-once, withholding and denial case stays green.

## Implementation Notes

D7 fixture check (HITL checkpoint, re-runnable — performed 2026-10-28 against `src/modules/assessment-progress/bank.ts`'s partial-credit pool): the root and retest pools are BYTE-IDENTICAL to their 3.1/3.2 form (same prompts, choices, answer keys, points [1999×4, 2004], full-credit answer rule/rubric), so their recorded per-item verification lists stand unchanged. The NEW two-item partial-credit fixture (`required-test-partial-credit`, scale 100, points [600000, 400000] = [6000.00, 4000.00], total 1000000 = 10000.00) was checked item by item:

1. Item 1 (600000 pts = 6000.00, NO rubric — absent means full credit only): claim "Only on the item that carries the disclosed rubric, and only the exact credit it declared when the attempt started — items without a rubric stay full credit or zero" is exactly D3 ("Partial credit is allowed only where a disclosed rubric defines it") plus this story's snapshot-pinning rule. Wrong choices assert post-hoc grader discretion, whole-test rubrics, and on-request credit — each self-evidently false per D3/AD-8.
2. Item 2 (400000 pts = 4000.00, disclosed rubric: `credits: { c: 199900 }` — choice c earns the declared 1999.00 of 4000.00): correct choice b states BOTH required facts (partial credit only under a disclosed rubric; no negative marking) — trivially true per D3. Choice c states exactly ONE of the two facts (the disclosed-rubric fact), so the declared 1999.00 (a non-round hundredths value exercising the finite precision) is trivially fair per the item's own disclosure, which states the one-fact selection earns exactly that amount; the disclosure is shown pre-answer in the descriptor and as a per-choice credit hint. Choices a (asserts both facts falsely) and d (automatic half credit) earn zero — self-evidently false. The correct answer is structurally absent from the credits map (schema-enforced), so the rubric discloses credit without disclosing the key.

Boundary under scale: correct on item 1 + the declared partial credit on item 2 = 600000 + 199900 = 799900/1000000 = 79.99% — honestly Not passed at 80, displayed with two decimals because the one-decimal "80.0%" would contradict the verdict; the 79.96/80.00/80.04 matrix is additionally unit-covered at the raw scale-100 integers (799600/800000/800400 of 1000000).

Design decisions recorded for the run:

- **Applicable mark representation (refines the Design Notes' leading representation):** the snapshot's `passMarkPercent` IS the applicable mark, and the carried `passMarkOverride` contract (`{ source: "default" | "instructor", value, +recordedAt provenance on the instructor variant }`) is pinned equal to it by a schema refine on every snapshot kind. Grading code therefore reads one field under all policies; a disagreeing/forged/provenance-less contract is rejected at build, never repaired.
- **Legacy tolerance:** pre-3.3 stored snapshot rows parse and serve unchanged — `pointsScale` defaults to 1 and `passMarkOverride` defaults to the default-source contract; read-side builders normalize through `pointsScaleOf`/`passMarkOverrideOf`, so no stored row was rewritten.
- **Serving surface:** personal study keeps building the full-credit root test only (`buildSnapshot(objectives)` — no override argument at any call site). The partial-credit fixture (`buildPartialCreditSnapshot`) and the instructor override exist as builder + contract (the epic-5 integration point); tests plant them through the module's own repository writer so the REAL verbs grade and disclose them. No instructor route or UI ships.
- **Retest interaction:** `buildRetestSnapshot` mirrors the root's points, scale, mark and carried override (root policy fixed through the chain); a retest on a partial-credit-fixture root is rejected at build (`INVALID_INPUT`) because the synthetic retest pool mirrors only the root bank's items — a rubric-comparable fresh retest pool would be new work under its own entry.
- **Provisional:** typed beside the statuses (`GradeDecision = { gradeKind: "final"; passed } | { gradeKind: "provisional"; pendingSince }`) — the provisional variant structurally has no `passed`; `gradeAwardsCompletion` is the single fence the roadmap derivation routes through, and every graded view carries `gradeKind` ("final" for every deterministic objective attempt; a provisional row would serve labeled Provisional and award nothing). No writer produces provisional grades in this build.

Run deviation (orchestrator record): the pre-existing epic-2 spec `tests/browser/course.spec.ts` ("practice set: multi-card keyboard-only journey") failed twice at card 3 with a truncated typed value ("Synt" of the canonical answer in the controlled textbox) — zero-delay `page.keyboard.type` drops characters when a sibling re-render lands mid-type; 3.3 touches nothing in the practice path (the larger served DOM plausibly raises the odds). Repair: per-keystroke settling (`keyboard.type(..., { delay: 20 })`) at the spec's three typing sites — pure-keyboard coverage unchanged, no assertion touched; the spec then passed twice consecutively (10s each). Restart smoke and every other gate step green; e2e otherwise 62/62 in the orchestrator's independent run with all three assessment journeys green.

## Plan Change Log

## Review Triage Log

### 2026-10-29 — Review pass
- verdicts: 9 findings — high 0, medium 4, low 4, false 1, maybe-false 0
- findings:
  - `[medium]` `[patch]` `recoveredOnCurrentVersion` bypassed the provisional-grade fence (only the pass input routed through gradeDecisionOf/gradeAwardsCompletion) — fixed: the recovered path requires a final-grade decision the same way; a provisional-typed row can never complete via recovery.
  - `[medium]` `[patch]` retest point amounts rendered at the LATEST attempt descriptor's scale while retest views belong to the root chain's snapshot (a planted scale-100 latest attempt made scale-1 retest amounts render ÷100) — fixed: `ActiveRetestView`/`GradedRetestView` carry their own `pointsScale`; all retest renders (and the Available-now ledger line) use it.
  - `[medium]` `[patch]` the rubric schema permitted keying every non-correct choice (zero credits allowed), disclosing the answer by elimination in the pre-grade descriptor — fixed: a refine rejects credits maps covering all non-correct choices; absent ≡ zero-credit stays indistinguishable.
  - `[medium]` `[patch]` the plan's "Files changed" omitted `tests/browser/course.spec.ts` (the typing-delay repair) — fixed: the list now records it.
  - `[low]` `[patch]` the graded-retest item legend lacked the partly-correct branch (a positive sub-full earned amount would read "not correct · 0 points") — fixed: mirrors the ordinary legend.
  - `[low]` `[patch]` "a rubric-carrying snapshot can never masquerade as the ordinary required test" was convention, not schema — fixed: `noRubrics` refines on the required-test and retest schemas; only the partial-credit fixture schema accepts rubric items.
  - `[low]` `[patch]` the provisional-kind unit case asserted a locally redefined literal (vacuous) — fixed: imports the exported `attemptStatuses`.
  - `[low]` `[patch]` builder rejections surfaced as raw ZodError where the matrix records INVALID_INPUT — fixed: a `buildParsed` helper maps parse failure to `fail("INVALID_INPUT")` (the commands.ts precedent).
  - `[false]` `[reject]` `next-env.d.ts` staged with production imports — the finalize step restores the authorized development imports before commit; the staged intermediate is the documented typegen-dance side effect.

## Auto Run Result

**Summary.** Epic-3 story 3 (3.3) implemented on branch `feat/epic3-assessment-and-progress` from baseline `4869a44…`: the assessment module's D3/AD-8 scoring surface is completed around the unchanged 3.1/3.2 path. The shared snapshot core now carries a declared finite precision (`pointsScale` 1 | 100, legacy rows defaulting to 1) and the snapshotted pass-mark override contract (`{ source, provenance, value }`, default-source in personal study, pinned equal to the applicable mark by schema refine); items may carry an OPTIONAL disclosed partial-credit rubric (`{ disclosure, credits }` — nonnegative scaled-integer credits, never keyed on the answer, never over full points; absent = full credit only). Earning is declared-credit (`earnedOfItem` — full, declared-exact, or zero; no negative marking; no float anywhere), the pass decision stays the overflow-safe integer cross-product (scale-invariant), and point amounts render scale-aware for humans without ever deciding anything. A new manually checked (D7) hundredths-scale partial-credit fixture (`required-test-partial-credit`, [600000, 400000] = [6000.00, 4000.00]) rides ordinary attempt rows through the module's own builder + writer and is graded/disclosed by the REAL verbs; the instructor override is exercised the same way (a planted 90-mark attempt grades 80.01% Not passed while the next real attempt at the default 80 passes with the same answers — policy edits touch only new attempts). The provisional-grade state is typed beside the statuses with NO pass field (`GradeDecision`), fenced by `gradeAwardsCompletion` in the roadmap derivation, and every graded view carries `gradeKind` (always "final" for deterministic objective attempts; the Provisional label path renders for the epic-5 variant). The full-credit root and retest pools are byte-identical; every 3.1/3.2 boundary, exactly-once, withholding and denial case re-ran green unchanged. NO stored-shape change: the snapshot jsonb carries the additions and no migration exists (021/022 CHECKs untouched).

**Files changed.**
- `src/contracts/assessment.ts` — pointsScale/passMarkOverride on the shared core (legacy-defaulted), optional per-item partialCredit with build-time rejection refines, the partial-credit fixture schema, the override contract (discriminated, provenance on the instructor variant), the GradeDecision/provisional types, legacy-normalizing helpers, and the view additions (descriptor rubrics/scale/override, graded gradeKind/scale/override, per-row scale on summaries/ledger/group views).
- `src/modules/assessment-progress/bank.ts` — builders carry the new shape (root default-80/default-contract, retest mirrors root scale/override); NEW D7 partial-credit fixture pool + `buildPartialCreditSnapshot` (scale 100, one disclosed rubric, one full-credit item beside it).
- `src/modules/assessment-progress/scoring.ts` — `earnedOfItem` (declared-credit earning), `displayPointsOf` (integer-only scale-aware display), `gradeAwardsCompletion` (the provisional fence), group earning through the declared-credit rule, scale riding group views.
- `src/modules/assessment-progress/repository.ts` — snapshot type widened to the fixture variant (same columns; no migration).
- `src/modules/assessment-progress/service.ts` — declared-credit grading on submit and graded views, disclosure descriptor carrying scale/override/per-item rubrics, grade-decision mapping through the fence, scale carried on summary/ledger views.
- `src/app/assessment-stage.tsx` — disclosure renders per-item rubric lines, per-choice credit hints (credit named, never the answer), override provenance line, scale-rendered point amounts, partly-correct earned labels, and the Provisional label path; verdict copy unchanged.
- `tests/unit/assessment.test.ts` (+10 cases), `tests/integration/assessment.test.ts` (+2 cases), `tests/browser/attempt.spec.ts` (+1 journey) — per the matrix.
- `tests/browser/course.spec.ts` — pre-existing epic-2 spec repair (run deviation): per-keystroke settling on its three keyboard.type sites; no assertion touched, keyboard-only coverage unchanged.
- `docs/project-structure.md` — same-change rows.

**Verification performed.** Full local gate under Node v24.22.0 with the documented typegen dance (production imports generated, dev imports/cache restored after; the dev cache was moved aside for the production checks and restored verbatim): audit 0 vulnerabilities; ESLint+Oxlint 0 warnings + 113-rule coverage probes; module boundaries; both typechecks; unit 264/264 (assessment 32); extractor build + sandbox admission; db start + migrations (no new migration); integration 190/190 (assessment 8/8); production build; e2e 63/63 on the immediate full re-run after one run with two keyboard-focus flakes in UNTOUCHED epic-2 specs (course.spec.ts practice-card Space toggle and journey.spec.ts assisted checkbox — the same flake pattern recorded at 3.1's closure; both passed in the immediate re-run and the new attempt journey was green in every run); real-process restart smoke green (its assessment beats unchanged). Targeted command: `vitest run tests/unit/assessment.test.ts tests/integration/assessment.test.ts --no-file-parallelism` → 40/40.

Orchestrator's independent verification (after the review patches): full local gate green through integration 190/190 (assessment 8/8) and the production build; unit 264/264; the seven patched surfaces re-verified scoped (40/40, attempt spec 3/3) by the implementer; e2e 61/63 in the gate run — the two failures are the known full-gate-load flakes in pre-existing epic-2 keyboard-heavy specs (course practice card-3 typing, journey Review-removal focus), each green SOLO on this exact tree (practice ×3 across the delay repair and after; journey 2/2 in 34.1s); restart smoke green after restarting the local DB it found down (ECONNREFUSED — the aborted gate run had left Postgres stopped; environment, not code). The typing-delay repair (course.spec.ts, run deviation above) made the practice spec deterministically green solo where it previously failed solo too.

**Residual risks.** None claimed beyond the story's own scope: the instructor override and provisional grades are contract+builder only (epic 5 supplies writers/routes); the partial-credit fixture has no served start path (personal study builds the full-credit root test only), so its pre-START disclosure is exercised through the active state's descriptor (shown before any answer) rather than the offered state; a retest on a fixture-pinned attempt is rejected at build (the synthetic retest pool mirrors the root bank only) — a rubric-comparable retest pool would be new work under its own entry; local synthetic evidence only — no deployment, release-readiness or F1 claim.

## Design Notes

Leading representation (from the spec quotes; the formal run may refine): declare a per-snapshot integer `pointsScale` (hundredths) with legacy whole-point snapshots defaulting to scale 1 — stored immutable rows stay gradeable under their own declared scale; per-item optional `partialCredit` map (choice → nonnegative scaled-integer credit share) with the full-credit answer rule as default; the instructor override rides as a snapshotted `{ source, value }` contract, `source: "default"` in personal study. All comparisons remain `earned × 100 ≥ mark × total` in the snapshot's scale.

## Verification

**Commands:**
- `nvm use && NPM_CONFIG_USERCONFIG=/dev/null NEXT_TELEMETRY_DISABLED=1 npm run checks` -- expected: all gates green (documented typegen dance; dev state restored after).
- `NPM_CONFIG_USERCONFIG=/dev/null npx vitest run tests/unit/assessment.test.ts tests/integration/assessment.test.ts --no-file-parallelism` -- expected: pass, rubric/boundary/policy-edit cases included.

**Manual checks (if no CLI):**
- D7 fixture check (HITL, re-runnable): read every partial-credit fixture item; verify each declared credit is trivially fair per its disclosure, nonnegative, and finite-precision; record the per-item list in Implementation Notes.
