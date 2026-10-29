---
title: 'Evidence-linked gap guidance with Unknown separation (3.5)'
type: 'feature'
ticket: 5
created: '2026-10-29'
status: 'done'
baseline_revision: '5809ccfc01f1cde24e87effb39d29c8f2bf27c99'
route: 'full'
route_source: 'auto'
risk: 'high'
review: ''
review_source: ''
lenses_ran: []
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/initiative-ai-learning-platform/product-policies.md'
  - '{project-root}/_bmad-output/initiative-ai-learning-platform/architecture-shared-technical/architecture-shared-technical.md'
  - '{project-root}/_bmad-output/initiative-ai-learning-platform/ux-ai-learning-platform/EXPERIENCE.md'
  - '{project-root}/_bmad-output/initiative-ai-learning-platform/tickets/epic-assessment-and-progress/tickets/story-targeted-recovery-ledger-and-fresh-retest-chain-plan.md'
warnings: []
deferred: []
---

<intent-contract>

## Intent

**Problem:** The graded result already names failed groups ("Needs practice", `assessment-stage.tsx` Focused review) but explicitly disclaims guidance ("This tracer has no gap guidance; that belongs to a later entry" — the line this story replaces). There is no surface that cites the specific responses behind each recommendation, `app.practice_attempt` has **no serving read** (write + export/lifecycle raw SQL only), Unknown (unassessed) is not rendered anywhere, and assessment items have **no flag path** (verified: no flag/unclear write exists in assessment-progress).

**Approach:** Guidance is a READ-TIME deterministic view over already-recorded typed evidence — no new evidence rows, no awards, no score changes. A pure `deriveGuidance` classifies each studied-release objective as **Needs practice** (an open recovery-target group of the served chain — observed difficulty, cause unnamed) or **Unknown** (no graded-attempt item covering it), attaches lean per-item scored citations (attempt + failed targeted-retest items) and a **labeled practice lane** (per-kind counts + latest incorrect response, `evidence_kind` rendered, never merged with unaided scored evidence), and serves it on `AssessmentState.guidance` inside the existing `getAssessment` transaction. The only new write is the **thinnest honest flag**: a one-way insert-once `app.assessment_flag` row behind a full AD-2 fence, mirroring the diagnostic's `flagUnclear`/`markUnclear` precedent (only a GRADED item can be flagged; the flag changes no outcome), deliberately stopping short of entry 7's Under-review/pause machinery. Deterministic fixture guidance is the acceptance core; AI-narrated guidance stays F-A blocked (no dispatch, no provider reads).

## Boundaries & Constraints

**Always:**
- Needs practice is derived ONLY from open recovery-target groups of the served chain on the STUDIED release (D2: observed difficulty, cause unnamed), guarded by: a newer graded PASSING attempt on the same release covers those groups (recovered normally — completion's own rule) and suppresses the still-failed listing; ledger rows themselves are never rewritten.
- Unknown is derived ONLY from absence of graded scored coverage (no graded attempt/retest item on the studied release maps to the objective — snapshots can cover fewer objectives than the release has, so Unknown legitimately coexists with a graded failed attempt). Practice evidence NEVER flips Unknown to Needs practice — practice records no score (AD-7).
- Evidence kinds stay structurally separate in the contract: scored citations and the practice lane are distinct typed fields; practice rows render their `evidence_kind` label; engagement, self-report and content-done evidence never enter guidance at all.
- Version honesty: every scored citation and practice row must pin the STUDIED course release (`course_id` equality); a version switch starts a fresh guidance state on the new release while prior-release evidence stays listed in attempts/awards (3.4 semantics).
- The fixed uncertainty note is a contract constant (needs practice names observed difficulty, claims no cause — forgetting, misunderstanding or a bad item — and no mastery; Unknown means not yet assessed, not weakness), stated in text per the accessibility floor, never color/iconography alone.
- The flag verb runs the full fence (identify → authorize → scopedRoot → expected-revision check → replay → validation → insert → content-free receipt) in ONE transaction (AD-2); `INSERT ... ON CONFLICT DO NOTHING` makes it exactly-once; it is one-way and never unset; graded views, scores, targets and awards are byte-identical before and after flagging.
- Practice rows are consumed READ-ONLY through course-generation's scoped repository reads (the established cross-module precedent: `itemStates`, `readyCourseVersions`); assessment-progress never writes epic-2 tables.
- Cleared targets and passed groups are not guidance entries (nothing needs attention); they stay visible in the result/recovery panels. Guidance is null when there is no evidence to cite (no graded attempt and no practice row on the studied release) and when nothing needs attention and nothing is Unknown.
- `npm run checks` green (documented typegen dance; dev state restored), restart smoke extended, `docs/project-structure.md` updated in the same change.

**Never:**
- No AI dispatch, provider reads or live guidance paths (F-A blocked — the entry's own `unknown` and the owner's finish-direction); no Under-review state, decision pause, correction or replacement surface (entry 7, `after = [2, 5]`); no roadmap Needs-practice pill (entry 6); no lifecycle/export/retention registration changes (entry 3.9 registers `app.assessment_flag`); no mutation of attempt/retest rows or their answers (immutability — hence a separate flag table, unlike diagnostic's in-row `markUnclear`); no new dependencies; no editing applied migrations; no learner-facing time limits; loopback-only, original synthetic fixtures only.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Failed attempt, no practice | graded failed attempt, open targets | guidance lists exactly the failed groups; each entry cites the group's non-perfect root-attempt items (position, earned/points) | none |
| Mixed practice on failed groups | practice rows on studied course | practice lane renders per kind (unaided/assisted × correct/incorrect counts) + latest incorrect response text, labeled, beside — never inside — scored citations | none |
| Partial recovery | open target with graded retest history | entry cites BOTH root-attempt items and the group's failed retest items (source labeled targeted-retest) | none |
| Unassessed objective | release objective with no graded item mapping | entry status Unknown with "not yet assessed — not weakness" framing, never Needs practice; incorrect practice does NOT reclassify it | none |
| Recovered normally | newer passing attempt on same release after the failed chain | no needs-practice entries for its covered groups (ledger untouched) | none |
| All passed / fully recovered | no open targets, no unknowns | `guidance: null` — callout hidden | none |
| No evidence yet | offered state, zero attempts and zero practice rows on the release | `guidance: null` (offered panel already invites the test) | none |
| Version switch | studied release moves | guidance recomputes from the new release only; prior-release citations/practice excluded; attempts/awards lists unchanged | none |
| Flag a graded item | valid command on a graded attempt/retest item | one flag row + receipt; replay/duplicate → identical result, one row; scores/targets/awards byte-identical | none |
| Flag an active/ungraded item | command names an ungraded container | — | `CONFLICT` (only a graded item can be flagged) |
| Flag foreign/stale/invalid | other owner's evidence, wrong root, out-of-range position, stale revision | — | `FORBIDDEN_OR_NOT_FOUND` / `INVALID_INPUT` / `CONFLICT`, no leak |

</intent-contract>

## Code Map

- `migrations/024-assessment-item-flags.sql` (NEW) — `app.assessment_flag` (id, owner_id, root_id FK per the 021 attempt pattern, evidence_kind CHECK `('attempt','retest')`, evidence_id, position, flagged_at; `UNIQUE (owner_id, evidence_kind, evidence_id, position)`; insert-once, no update/delete path); idempotent guards; header names story 3.5 + write owner assessment-progress.
- `src/contracts/assessment.ts` — EXTEND (Story-5 section): `guidanceStatuses = ["needs-practice","unknown"]`; `GuidanceScoredCitation = { source: "attempt"|"targeted-retest", evidenceId, position, earned, points }`; `GuidancePracticeLane = { unaidedCorrect, unaidedIncorrect, assistedCorrect, assistedIncorrect, latestIncorrect: { attempted, evidenceKind, submittedAt } | null }`; `GuidanceEntry = { objectiveIndex, objective, status, scored: GuidanceScoredCitation[], practice: GuidancePracticeLane | null }`; `GUIDANCE_UNCERTAINTY_NOTE` constant; `GuidanceView = { entries, note }`; `flagAssessmentItemSchema = commandSchema.extend({ evidenceKind: z.enum(["attempt","retest"]), evidenceId: uuid, position: z.number().int().min(1) })`; `AssessmentFlag` result `{ rootId, evidenceKind, evidenceId, position, flagged: true, revision }`; `AssessmentState` gains `guidance: GuidanceView | null` and `flags: Array<{ evidenceKind, evidenceId, position, flaggedAt }>`.
- `src/modules/assessment-progress/guidance.ts` (NEW, pure — the `scoring.ts` pattern) — `deriveGuidance({ objectives, studiedCourseId, attempts, targets, retests, practice })` implementing the classification rules above; unit-testable without DB.
- `src/modules/course-generation/repository.ts` — EXTEND (read-only, epic-2-owned table): `practiceSummariesForCourse` (GROUP BY card_id, outcome, evidence_kind with counts) and `practiceLatestIncorrectForCourse` (DISTINCT ON card_id latest incorrect row for the citable response text); both owner+course scoped and bounded (≤ 8 cards per course by the `^practice:[0-7]$` CHECK); `card_id` maps to `objectiveIndex` by the `practice:${objectiveIndex}` construction (generation.ts:213).
- `src/modules/assessment-progress/repository.ts` — EXTEND: `insertFlag` (ON CONFLICT DO NOTHING → inserted bool), `flagsForRoot`.
- `src/modules/assessment-progress/service.ts` — EXTEND: `getAssessment` computes guidance inside its transaction (calls `deriveGuidance` with the already-fetched attempts/targets/retests plus the new course-repository practice reads) and serves flags; `flagAssessmentItem` verb mirroring `setup-diagnostic/service.ts:294` `flagUnclear` (replay first, receipt-exists guard, `lifecycle.assertObjects`, only-graded check at the `existing.path !== "item-submit"` analogue).
- `src/app/api/v1/[...path]/route.ts` — EXTEND: `studies/{rootId}/assessment/flag` POST branch (the switch branch's shape).
- `src/app/assessment-stage.tsx` — EXTEND: guidance callout after the Focused-review block (spine Recovery-path visual: guidance `{components.callout}` inside the result/recovery path), REPLACING the "no gap guidance" fine print; per entry: status label in text, scored citations anchored/linked to the existing item fieldsets (Flow 2 "links each to its evidence"), labeled practice lane; quiet per-item "Flag as unclear" button hidden once flagged, notice in the diagnostic's words — "The flag is recorded with the evidence; it changes no outcome."
- Tests: `tests/unit/assessment.test.ts` (+deriveGuidance matrix), `tests/integration/assessment.test.ts` (+guidance after failed attempt with planted practice rows via course-generation's own writer; flag journey + denial taxonomy + byte-identical graded view after flagging), `tests/browser/attempt.spec.ts` (+guidance/flag beats), `scripts/restart-smoke.ts` (+flag survives restart, view unchanged); `docs/project-structure.md` same-change update.

## Tasks & Acceptance

**Execution:**
- [x] `migrations/024-assessment-item-flags.sql` — insert-once flag table.
- [x] `src/contracts/assessment.ts` — guidance/flag contracts + `AssessmentState` extension.
- [x] `src/modules/assessment-progress/guidance.ts` — pure derivation.
- [x] `src/modules/course-generation/repository.ts` — bounded read-only practice queries.
- [x] `src/modules/assessment-progress/repository.ts` — flag writers/readers.
- [x] `src/modules/assessment-progress/service.ts` — guidance serving + flag verb.
- [x] `src/app/api/v1/[...path]/route.ts` — flag branch.
- [x] `src/app/assessment-stage.tsx` — guidance callout + flag buttons (built after 94a33fd landed the parallel session's UI fix).
- [x] Tests (unit/integration/browser) + restart beat per matrix; D7 manual fixture-claim check on the planted practice rows.
- [x] `docs/project-structure.md` — same-change update.

**Acceptance Criteria:**
- Given a failed attempt and mixed practice, guidance lists exactly the failed groups with their cited responses (position + earned/points + anchored item), marks an unassessed objective Unknown rather than Needs practice, labels assisted practice separately from the unaided attempt, and never asserts a cause or mastery (the uncertainty note renders verbatim).
- Given practice-only evidence on an otherwise unassessed objective, the scored status stays Unknown with the practice lane labeled — practice never reclassifies, never scores.
- Given partial recovery, the entry cites root-attempt and failed-retest items with their sources labeled; given a newer passing attempt on the release, its groups stop listing as still-failed without any ledger rewrite.
- Given a version switch, guidance derives solely from the studied release's evidence; prior-release rows remain listed in attempts/awards.
- Given a flag command on a graded item: exactly one row and one receipt (replays identical), and the graded view, targets and awards are byte-identical before and after; ungraded containers `CONFLICT`, foreign/stale/out-of-range per taxonomy with no leak; flags survive restart.
- Full local gate green with the documented typegen dance and dev state restored.

## Design Notes

Latitude taken (recorded per the house rule): (1) guidance is null until evidence exists on the studied release — an all-Unknown pre-test panel would be honest but redundant beside the offered disclosure; (2) status is a scored-evidence-only dimension while practice renders as its own labeled lane — this is what makes "practice never flips Unknown" structural rather than copy-enforced; (3) citations are lean (container id + position + earned/points) because the graded view already carries full item detail — the UI links rather than duplicates; (4) the flag lives in its own table because attempt/retest rows are immutable (AD-5), unlike diagnostic items which had their own mutable row to mark; (5) served `flags` list on `AssessmentState` powers hide-once-flagged without extra reads; (6) the newer-passing-attempt guard mirrors 3.4's completion rule so guidance, recovery panel and node state agree about "still-failed" whenever the served chain pins the studied release — under an explicit switch to an older release that also carries its own open chain, the two surfaces legitimately diverge (the panel serves the root's newest chain; guidance names the studied release's groups), each individually version-honest; the same edge renders citation points under the latest graded view's scale (cosmetic, scales differ only across a 3.3 hundredths-scale boundary); (7) practice SQL aggregates in-database so the read is bounded by the card CHECK, not by attempt history; (8) REVIEW-LATITUDE (2026-10-29): the flag table implements as attempt_id/retest_id FK columns under two partial unique indexes rather than the Code Map's evidence_kind/evidence_id + plain UNIQUE — the FK shape carries real lineage and CASCADE purge coverage and matches the repository SQL exactly; (7) practice SQL aggregates in-database so the read is bounded by the card CHECK, not by attempt history.

## Auto Run Result

**Status: BUILT — full local gate green in ONE run (2026-10-29, run 8 of the day's sequence; dev state restored after).** audit 0, lint 113 rules + probes, module boundaries, both typechecks, unit 278/278 (assessment 46 incl. the deriveGuidance matrix and the strict flag-schema surface), extractor re-admission (the toolchain churn below rebuilt the TXT helper under clang 21), db start + migrations (024 applied), PG integration 195/195 (18 files — the two new story-5 journeys: guidance cites exactly the failed group's responses after the honest 79.96% boundary fail on an 8-objective course, marks indexes 5-7 Unknown, labels the practice lanes per kind with the latest incorrect citable text, suppresses still-failed listings after a passing retake; and the flag journey: attempt-item + retest-item flags exactly-once across replay and a NEW commandKey, byte-identical attempt/recovery views before and after, the full denial taxonomy incl. active-container CONFLICT), production build, e2e 65/65 (the new guidance/flag journey: Unknown distinct from Needs practice, practice labeled, citation anchored to the focused-review item, flag hides once flagged + notice, B denied, 360px/1280 overflow-free), real-process restart smoke (flag + views survive restart; replayed flag command identical receipt; NEW commandKey inserts nothing — still one row).

**Build summary.** Guidance is a READ-TIME pure derivation (`guidance.ts`) served on `AssessmentState.guidance` inside `getAssessment`'s transaction — no tables, no writes, no AI anywhere. Practice evidence gets its FIRST serving reads (bounded in-database aggregates + DISTINCT-ON latest incorrect) in course-generation's repository, consumed read-only. The only new write is migration 024 `app.assessment_flag`: insert-once per graded container item under two partial uniques, behind the full AD-2 fence (`flagAssessmentItem`, verb `flag-assessment-item`), mirroring the diagnostic's only-a-graded-item rule. UI: the guidance note callout + entry rows after Focused review, replacing the old "no gap guidance" fine print; per-citation quiet flag buttons hidden once flagged (served `AssessmentState.flags`).

**Environment events encountered and their dispositions (all outside the code):** (1) a leftover `next dev -p 3100` from the parallel 3.4 session kept regenerating `.next/dev`, defeating the documented typegen dance mid-gate — killed (idle 90 min; noted to the owner); (2) a macOS system update replaced the Xcode Command Line Tools AT 12:45 WHILE a gate run compiled (`system_installd` churn; `/usr/bin/clang` briefly absent) — the extractor leg failed transiently and self-healed when the CLT 27 install completed; (3) the update's aftermath kept load at 8-10, producing two DOCUMENTED load flakes in full-gate e2e runs (the practice-typing journey — the 3.3-known flake — and the supplements journey — epic-2's recorded e2e load-sensitivity qualifier); each was solo-disproven per the house triage rule before the clean run 8. No skip, override or suppression exists anywhere in these runs.

## Review Triage Log

In-run self-review findings (found by the verification passes and fixed before the gate record; the independent review lens's record is appended when it lands):

1. `insertFlag` parameter order mismatched the SQL column order (root_id received the owner id) — caught by the integration FK violation; fixed.
2. The first guidance-journey fixture assumed multi-item objective groups; with 8 objectives each covered group holds ONE item, so the single-failed-group-and-failed-attempt fixture is the 2004-point boundary item (79.96%) — test recomputed.
3. Strict-mode duplicates after the callout renders the D2 phrases a second time: the recovery journey's "Needs practice" strong (scoped to first match = focused review) and the note's shared "not yet assessed, not weakness" phrase (entry-form matched by its em-dash prefix).
4. The guidance entries were initially nested inside `.notice` — a FLEX container — laying rows out horizontally and overflowing 360px; restructured to the house pattern (heading + note callout + sibling entry rows in a `.guidance-entries` wrapper).

**Independent review lens (2026-10-29, post-commit against 838439b): PASS-WITH-NOTES — all eight binding rule groups verified clean; three P3 notes, all dispositioned:**
1. P3 — under an explicit switch back to an older release that also has an open chain, guidance (studied-release chain) and the served recovery panel (root-wide chain) can legitimately diverge, and citation points render under the latest graded view's scale; accepted-and-documented (this plan's design note 6 + the guidance.ts comment rewritten) — suppressing the studied release's honest open groups would be the worse lie.
2. P3 — the flag table's implemented shape (attempt_id/retest_id FKs + partial uniques) deviates from the Code Map's evidence_kind/evidence_id + plain UNIQUE; recorded as design-note latitude (8).
3. P3 — restart-smoke.ts lost its trailing EOF newline on a touched line; restored.

## Verification

**Commands:**
- `nvm use && NPM_CONFIG_USERCONFIG=/dev/null NEXT_TELEMETRY_DISABLED=1 npm run checks` -- expected: all gates green (documented typegen dance; dev state restored after).
- `NPM_CONFIG_USERCONFIG=/dev/null npx vitest run tests/unit/assessment.test.ts tests/integration/assessment.test.ts --no-file-parallelism` -- expected: pass, guidance/flag matrices included.

**Manual checks (if no CLI):**
- D7 fixture-claim check: the planted practice rows' `attempted` text/outcomes match the original synthetic practice fixtures; the served guidance practice lane renders exactly those rows with kind labels.
