---
title: 'Targeted recovery ledger and fresh retest chain (3.2)'
type: 'feature'
ticket: 2
created: '2026-10-28'
status: done
baseline_revision: '20aeeedef188946d3a69ecddc24a562b3e649889'
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
  - '{project-root}/_bmad-output/initiative-ai-learning-platform/tickets/epic-assessment-and-progress/tickets/story-plan-to-roadmap-scored-attempt-tracer-plan.md'
warnings: [oversized]
deferred: []
---

<intent-contract>

## Intent

**Problem:** A failed required test (3.1) is a dead end: the learner can only retake the whole ordinary test. Epic 3's riskiest story builds AD-8's targeted recovery: preserve passed sections, ledger failed objective groups as open targets, and clear them through fresh same-demand retests — original score never rewritten, credit shown separately.

**Approach:** Extend the assessment-progress module: grading a FAILED ordinary attempt writes a per-objective-group recovery-target ledger under that attempt's own snapshot; `startRetest`/`submitRetest` verbs run fresh retests from a manually checked synthetic retest bank mirroring the root blueprint's per-group item structure; a group clears only when it independently reaches the root attempt's snapshotted threshold; the failed-test requirement (and the derived roadmap node) is satisfied only when every target is cleared.

## Boundaries & Constraints

**Always:**
- Only an originally FAILED ordinary attempt opens recovery; initial group results compute under that attempt's own snapshot; passing groups are preserved and never re-tested (AD-8/D3).
- Every failed group is ledgered open at grade time, in the same transaction as the failed grade; uncleared/untested targets are never inferred passed (AD-8).
- Retests declare a non-empty subset of the open targets; the retest snapshot mirrors each target group's root item count and per-item points exactly (comparable demand/coverage), with fresh manually checked questions, the ROOT attempt's pinned pass mark/rubric/answer rule — root policy fixed through the chain; a new policy means a new ordinary attempt.
- A target clears only when its retest group independently reaches the root threshold by the same integer cross-product; clearing is a status-guarded transition in the retest's grade transaction.
- Original score never rewritten (graded ordinary rows stay immutable); the served state shows original result and per-group recovery credit side by side, never merged; receipts stay content-free.
- Retests/recovery rows are new additive tables (021's CHECK is untouchable); the module's repository stays sole writer; FKs `ON DELETE CASCADE` with the course lineage; one open retest per root attempt (partial unique).
- Every verb runs the full fence (identify → authorize → scopedRoot → replay/receipt → repository in one transaction); `npm run checks` stays green.

**Never:**
- No AI dispatch, no live retest generation (F-A blocked — synthetic bank only, the 021 precedent); no partial credit, disputed-item "Under review" flows (3.7), gap guidance (3.5), award rows or parent awards (3.4); no repeating passed sections; no invented merged/averaged score; no editing applied migrations; no new dependencies; loopback-only, original synthetic fixtures only.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Failed grade opens recovery | ordinary attempt fails (e.g. 5997/10000; groups obj1+obj2 failed, obj0 passed) | targets ledgered for exactly the failed groups with initial group results; obj0 preserved, never retested | none |
| Retest clears one group | retest targets {obj1,obj2}, answers clear only obj1 | obj1 `cleared`, obj2 `open`; requirement unsatisfied; original 5997 shown beside per-group credit | none |
| Later retest clears remainder | new retest targets {obj2}, clears it | all targets cleared → requirement satisfied; original score unchanged; node can complete with required items done | none |
| Duplicate retest command | same commandKey | identical receipt; one tracked retest row | none |
| Resubmit graded retest | new commandKey | — | `CONFLICT` |
| Retest on passed/active attempt | root attempt not graded-failed | — | `CONFLICT` |
| Foreign target declaration | target index not an open target of that root | — | `INVALID_INPUT` |
| Cross-owner / deleted root / stale revision / unknown ids | standard denial taxonomy | — | `FORBIDDEN_OR_NOT_FOUND` / `CONFLICT` / `INVALID_INPUT`, no leak |
| Superseded version mid-chain | newer ready version exists | recovery stays pinned to the root attempt's course version; the node derives from the current version only | no error |
| Retake ordinary test after failed grade | fresh ordinary start command | new ordinary attempt (no pedagogical limit); its own failed grade re-ledgers under ITS snapshot; earlier chain stays readable | none |

</intent-contract>

## Code Map

- `migrations/022-targeted-recovery.sql` (NEW) — `app.recovery_target` (id, root_attempt_id → test_attempt CASCADE, owner_id, root_id, course_id CASCADE, course_version, objective_index 0..7, objective text pinned, initial_earned/initial_total, status `open|cleared`, cleared_by/cleared_at, UNIQUE(root_attempt_id, objective_index)); `app.retest_attempt` (mirror of test_attempt plus root_attempt_id CASCADE, target_objective_indexes jsonb, group_results jsonb, status `active|graded`, partial UNIQUE one-open-per-root-attempt, cross-column CHECK like 021's). Header names story + write owner; idempotent guards.
- `src/contracts/assessment.ts` — EXTEND (amend the "no recovery fields" header comment to scope it to 3.1's tracer slice): `startRetestSchema` (commandSchema + attemptId + non-empty targetIndexes), `submitRetestSchema` (commandSchema + retestId + answers), `RetestSnapshot` (reuse snapshotItemSchema; positions renumbered 1..n within the retest), `RecoveryTargetView`, `RetestView` (active: items without answers; graded: per-group results + item reveal), `RecoveryState` on `AssessmentState` (rootAttemptId, targets, retest summaries, requirementSatisfied).
- `src/modules/assessment-progress/bank.ts` — EXTEND: a fresh retest item pool (one fresh single-choice item per bank position, same objective slot and points, manually checked) + pure `buildRetestSnapshot(rootSnapshot, targetIndexes)`: filters root items to target groups, swaps fresh items in, renumbers positions, keeps root pass mark/rubric/answer rule; total = sum of mirrored per-item points.
- `src/modules/assessment-progress/scoring.ts` — EXTEND: pure `groupResultsOf(snapshot, answers)` (per objectiveIndex earned/total), `groupCleared(group)` via the existing cross-product at the root mark, `recoverySatisfied(targets)`, and `deriveRoadmapNode` gains `recoveredOnCurrentVersion` (completed = required done AND (passed OR fully-recovered-failed) attempt on the current version).
- `src/modules/assessment-progress/repository.ts` — EXTEND: ledger insert (failed-grade transaction), target reads, status-guarded clear, retest insert/read/grade (mirror `gradeAttempt`).
- `src/modules/assessment-progress/service.ts` — EXTEND: `submitAttempt` grades + (on fail) writes targets in ONE transaction; NEW `startRetest`/`submitRetest` with the full fence (mirrors `startTest`/`submitAttempt`, including the returned-attempt's-own-pin receipt rule); `getAssessment` assembles recovery state next to attempt/attempts.
- `src/app/api/v1/[...path]/route.ts` — branches: POST `studies/{id}/assessment/retest` (start), POST `.../assessment/retest/{retestId}/submit`; recovery state rides the existing GET.
- `src/app/assessment-stage.tsx` — EXTEND: failed-graded view groups items per objective ("Needs practice", cause unnamed) as focused review; recovery panel lists targets with initial results + status; retest flow mirrors the attempt flow; original verdict and recovery credit side by side, never merged.
- Tests (NEW/EXTEND): `tests/unit/assessment.test.ts` (+retest bank comparability, groupResults/clearing, subset chains, node derivation); `tests/integration/assessment.test.ts` (+the matrix rows verbatim); `tests/browser/attempt.spec.ts` (+recovery UI journey incl. side-by-side honesty and denial); `scripts/restart-smoke.ts` (+one recovery beat: ledger + cleared targets survive restart); `docs/project-structure.md` same-change update.

## Tasks & Acceptance

**Execution:**
- [x] `migrations/022-targeted-recovery.sql` — additive ledger + retest tables, idempotent — durable recovery storage.
- [x] `src/contracts/assessment.ts` — retest commands, snapshot/view types, RecoveryState — the honest contract surface.
- [x] `src/modules/assessment-progress/bank.ts` — fresh retest pool + `buildRetestSnapshot` — comparable-coverage fixture (D7).
- [x] `src/modules/assessment-progress/scoring.ts` — group arithmetic + node extension — AD-8 targeted credit.
- [x] `src/modules/assessment-progress/repository.ts` — ledger/clear/retest writers — single write authority.
- [x] `src/modules/assessment-progress/service.ts` — failed-grade ledgering + `startRetest`/`submitRetest` + state assembly — the recovery chain.
- [x] `src/app/api/v1/[...path]/route.ts` — retest branches — HTTP surface.
- [x] `src/app/assessment-stage.tsx` — focused review + recovery panel + retest flow — the visible path.
- [x] `tests/unit/assessment.test.ts` — matrix edge cases (grouping, subset clearing, bank comparability, node).
- [x] `tests/integration/assessment.test.ts` — matrix rows on real PG + denial sweep + immutability of the original.
- [x] `tests/browser/attempt.spec.ts` — recovery journey with honest side-by-side states + second-account denial.
- [x] `scripts/restart-smoke.ts` — recovery beat across a real restart.
- [x] `docs/project-structure.md` — same-change update.

**Acceptance Criteria:**
- Given a graded-failed ordinary attempt, when grading completes, then exactly its failed objective groups are ledgered open with initial results under that attempt's snapshot, and its passed groups are never retested.
- Given a retest clearing one target group but not another, when the state renders, then the first reads cleared, the second open, the failed-test requirement stays unsatisfied, and the original verdict/percentage is shown beside the per-group recovery credit, never merged or averaged.
- Given a later retest clearing the last open target, when it grades, then the requirement reads satisfied, the original score row is byte-identical, and the roadmap node can read Completed only with the required items also done.
- Given any recovery verb under a second owner, deleted root, stale revision, unknown id, or foreign target declaration, when handled, then the standard denial taxonomy returns with zero leak or effect.
- Given web/worker restart mid-chain, when the study reloads, then ledger, cleared targets, retests and their results are unchanged and replays return identical receipts.

## Implementation Notes

D7 fixture check (HITL checkpoint, re-runnable — performed 2026-10-28 against `src/modules/assessment-progress/bank.ts`, the fresh retest pool in addition to 3.1's root bank): every FRESH retest item's correct choice is trivially, self-evidently true against its synthetic claim, each wrong choice is self-evidently false, and each target group's retest points mirror the root blueprint exactly (unit-asserted in `tests/unit/assessment.test.ts`).

Per-item verification list (fresh pool, one item per root bank position):

1. Pool item 1 (1999 pts, correct = "b"): claim "only the objective groups that failed — passing groups are preserved and never re-tested" is exactly D3 targeted credit / AD-8 "preserve passing groups". Wrong choices assert re-taking passed sections (explicitly forbidden), an invented extra section never taught, and rounding the failing score up to a pass (the anti-pattern 3.1's root item 1 also rejects).
2. Pool item 2 (1999 pts, correct = "b"): claim "the retest's fresh items for that group independently reach the original attempt's pass mark" is AD-8 "clears only reassessed groups reaching the root attempt's applicable threshold". Wrong choices assert averaging original and retest scores (an invented merged score), time-spent-as-credit (engagement theater), and one-correct-answer-clears (threshold bypass).
3. Pool item 3 (1999 pts, correct = "c"): claim "the original failing score stays unchanged in the record; recovery credit is shown separately beside it" is D3 "do not invent a higher original numeric score; show the original result and subsequent recovery credit separately". Wrong choices assert rewriting to the retest percentage, replacing the score with a word, and averaging the two — all explicitly rejected.
4. Pool item 4 (1999 pts, correct = "a"): claim "every failed objective group of that attempt has independently cleared — no untested group is inferred passed" is AD-8's no-inference rule. Wrong choices assert a promise to study later (untested inference), half-cleared satisfaction (partial credit), and AI-judged mastery ("no unchecked AI appeal awards a pass").
5. Pool item 5 (2004 pts, correct = "d"): claim "the same intended demand and comparable points coverage per objective group, with the original pass mark and rubric" is D3 fresh-questions comparability plus the story's root-policy pinning. Wrong choices assert mark-only comparability, verbatim reuse of the original questions (not fresh), and an easier lower mark for retests.

Run deviation (orchestrator record): the implementing subagent was killed twice by the harness's 10-minute subagent-inactivity cap mid-run — a long silent gate command, not a code fault (the assessment suites were already 25/25 green when the second kill landed, and the agent never returned its report). Per the workflow's cannot-continue fallback, the orchestrator completed verification inline. Two files changed beyond the plan's task list, both retained deliberately: `tests/integration/restore.test.ts` (the pre-existing backup test's explicit budget raised to 120 s in the suite's own established pattern — its physical pg_dump/tar/encrypt toolchain had outgrown vitest's 30 s default against accumulated local state; nothing skipped or weakened, and it passed inside the next full gate) and `next-env.d.ts` (the documented typegen-dance side effect, restored to the authorized development imports before commit).

Point mirroring: the retest of {obj1, obj2} in the 5997 fixture carries exactly [1999 (obj1), 1999 (obj2), 2004 (obj1)] — the root blueprint's own per-item points for those groups, positions renumbered 1..3; `buildRetestSnapshot` rejects any declaration a root item does not carry (foreign/duplicate/empty), and the service additionally rejects any index that is not an OPEN target of that root (a passed group or an already-cleared target is foreign).

Display honesty note: 5997/10000 = 59.97% serves as "60.0% — Not passed (mark is 80%)" under the spine's existing display rule (one decimal only when it cannot contradict the verdict; 60.0% < 80% so it cannot mislead) — the Design Notes' "59.97%" names the fraction, and `earnedPoints/totalPoints` 5997/10000 is shown beside the verdict exactly as the matrix requires.

Serving decisions (within the plan's contract): `RecoveryState` roots at the newest graded-failed ordinary attempt that HAS a ledger — recovery opens only at grade time, so a pre-022 legacy failed attempt (no ledger rows) opens nothing and is never inferred recovered; its honest path is a fresh ordinary attempt. `recovery.retests` are the chain's retest summaries; earlier chains stay durable and readable in their rows (integration asserts the earlier ledger/retest rows remain after a retake re-ledgers), the ordinary `attempts` history lists every attempt, and the UI labels a chain whose root is not the shown attempt. The failed-test requirement (`requirementSatisfied`) is computed only from the ledger — non-empty and all-cleared — and the derived node accepts a fully-recovered failed attempt only on the CURRENT course version (a chain pinned to a superseded version never completes the current node).

## Plan Change Log

## Review Triage Log

## Design Notes

The story's verify figure "68%" predates the shipped 3.1 bank and is not a subset-sum of its per-item points [1999, 1999, 1999, 1999, 2004]; the fixture maps to the honest achievable failed score **5997/10000 (59.97%)** with a 3-outcome plan: wrong on items 3 (obj2) and 5 (obj1) fails exactly groups obj1+obj2 while obj0 (items 1,4) passes. All verify-clause semantics (exactly-its-failed-groups, partial clearing, later completion, original preserved, one tracked retest per command) hold unchanged.

Retest comparability is structural, not asserted: each target group's retest items mirror the root blueprint's per-item points for that group one-for-one (fresh questions, same objective slot), so "same intended cognitive demand with comparable rubric/points coverage" is checkable in a unit test against the root snapshot. Retest positions renumber 1..n; the pinned root pass mark/rubric ride the retest snapshot.

## Verification

**Commands:**
- `nvm use && NPM_CONFIG_USERCONFIG=/dev/null NEXT_TELEMETRY_DISABLED=1 npm run checks` -- expected: all gates green with the extended suites (documented typegen dance for the production pass, dev state restored after).
- `NPM_CONFIG_USERCONFIG=/dev/null npx vitest run tests/unit/assessment.test.ts tests/integration/assessment.test.ts --no-file-parallelism` -- expected: pass, recovery matrix included.

**Manual checks (if no CLI):**
- D7 fixture check (HITL checkpoint, re-runnable): read every FRESH retest item; verify each correct choice is trivially true, wrong choices self-evidently false, and per-group retest points mirror the root blueprint exactly; record the per-item verification list in Implementation Notes.
