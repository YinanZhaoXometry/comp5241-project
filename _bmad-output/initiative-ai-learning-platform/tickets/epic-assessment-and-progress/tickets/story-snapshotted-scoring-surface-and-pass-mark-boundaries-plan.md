---
title: 'Snapshotted scoring surface and pass-mark boundaries (3.3)'
type: 'feature'
ticket: 3
created: '2026-10-28'
status: 'draft'
baseline_revision: '' # set at the formal run's step-03 before any code change
route: 'full'
route_source: 'auto'
risk: 'high'
review: ''
review_source: ''
lenses_ran: []
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/initiative-ai-learning-platform/ux-ai-learning-platform/EXPERIENCE.md'
  - '{project-root}/_bmad-output/initiative-ai-learning-platform/product-policies.md'
  - '{project-root}/_bmad-output/initiative-ai-learning-platform/architecture-shared-technical/architecture-shared-technical.md'
  - '{project-root}/_bmad-output/initiative-ai-learning-platform/tickets/epic-assessment-and-progress/tickets/story-plan-to-roadmap-scored-attempt-tracer-plan.md'
warnings: []
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
- [ ] `src/contracts/assessment.ts` — finite-precision points/rubric schemas + override/provisional contract types.
- [ ] `src/modules/assessment-progress/bank.ts` — partial-credit fixture + builders carry the new shape.
- [ ] `src/modules/assessment-progress/scoring.ts` — declared-credit earning + scale-aware display, rejections.
- [ ] `src/modules/assessment-progress/repository.ts` + migration (only if needed) — stored-shape extension.
- [ ] `src/modules/assessment-progress/service.ts` — grading/disclosure/snapshot-build integration; provisional label served.
- [ ] `src/app/assessment-stage.tsx` — disclosure renders rubric/override; verdict copy unchanged.
- [ ] Tests: unit / integration / browser extensions per matrix.
- [ ] `docs/project-structure.md` — same-change update.

**Acceptance Criteria:**
- Given an item with a disclosed partial-credit rubric, when a learner answers, then earned points equal the declared finite-precision credit exactly (integer arithmetic; display never contradicts the verdict), and the rubric was visible before start.
- Given a mark/rubric policy change while an attempt is open, when that attempt submits, then it grades under its pinned snapshot and the next attempt carries the new policy.
- Given a provisional-typed result, when the roadmap node and recovery derivations run, then it contributes nothing to completion and is served labeled Provisional.
- Given the full 3.1/3.2 suite, when re-run, then every boundary, exactly-once, withholding and denial case stays green.

## Implementation Notes

## Plan Change Log

## Review Triage Log

## Design Notes

Leading representation (from the spec quotes; the formal run may refine): declare a per-snapshot integer `pointsScale` (hundredths) with legacy whole-point snapshots defaulting to scale 1 — stored immutable rows stay gradeable under their own declared scale; per-item optional `partialCredit` map (choice → nonnegative scaled-integer credit share) with the full-credit answer rule as default; the instructor override rides as a snapshotted `{ source, value }` contract, `source: "default"` in personal study. All comparisons remain `earned × 100 ≥ mark × total` in the snapshot's scale.

## Verification

**Commands:**
- `nvm use && NPM_CONFIG_USERCONFIG=/dev/null NEXT_TELEMETRY_DISABLED=1 npm run checks` -- expected: all gates green (documented typegen dance; dev state restored after).
- `NPM_CONFIG_USERCONFIG=/dev/null npx vitest run tests/unit/assessment.test.ts tests/integration/assessment.test.ts --no-file-parallelism` -- expected: pass, rubric/boundary/policy-edit cases included.

**Manual checks (if no CLI):**
- D7 fixture check (HITL, re-runnable): read every partial-credit fixture item; verify each declared credit is trivially fair per its disclosure, nonnegative, and finite-precision; record the per-item list in Implementation Notes.
