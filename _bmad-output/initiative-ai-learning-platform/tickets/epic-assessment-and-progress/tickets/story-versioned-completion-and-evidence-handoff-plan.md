---
title: 'Versioned completion and evidence handoff surface (3.8)'
type: 'feature'
ticket: 8
created: '2026-10-29'
status: 'done'
baseline_revision: 'c0f0fb89e938be37ad5da1dfd81edc20e760e724'
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
  - '{project-root}/_bmad-output/initiative-ai-learning-platform/tickets/epic-assessment-and-progress/tickets/story-whole-mini-course-roadmap-surface-plan.md'
  - '{project-root}/_bmad-output/initiative-ai-learning-platform/tickets/epic-assessment-and-progress/tickets/story-disputed-item-correction-and-honest-retries-plan.md'
warnings: []
deferred: []
---

<intent-contract>

## Intent

**Problem:** Epics 4–6 must not consume ad-hoc reads of this epic's tables. The epic contract's Boundaries promise three supplies — "versioned completion, applicable mark and unaided-performance handoffs to epic 4; published required-outcome, provisional subjective-grade and evidence/reporting contracts for epic 5; supplies activity/rubric/completion contracts to epic 6" — but today every one of those facts lives inside learner-facing views only: awards are served per-root inside `getAssessment`, applicable pass-mark pins exist only inside graded-attempt views, the AD-13 "authoritative review-purpose verdict from Assessment/progress's shared evaluator" exists as a RULE (the `testSatisfied` predicate inside `evaluateAwardOnCourse`) with no exposed computation a review consumer could call, the provisional-grade contract is typed beside the statuses with no reporting projection, and epic 6 has no published activity/rubric/completion shape to extend. There is no versioned query surface a downstream consumer can pin, and no scope-declaration fence proving out-of-scope reads are denied.

**Approach:** A READ-TIME, owner-scoped, lineage-fenced handoff document served at `GET /api/v1/studies/{rootId}/assessment/handoff` — the epic-2 `getProvenance` precedent (S7) applied to assessment facts, zero writes, zero tables. Version pinning mirrors the course reads exactly: the optional `?course=<uuid|version>` selector resolves one READY release (a foreign/stale pin is the same no-leak `FORBIDDEN_OR_NOT_FOUND` as every view); absent it, the STUDIED release resolves (explicit `app.studied_release` pointer, else `getCourse`'s default: the current confirmed revision's row in ANY status — honest `pending`/`failed`/`none` states — falling back to the latest ready one), because AD-13's review consumer pins "the learner's studied content release". The document carries the five supplies: **awards** (the release's monotonic mini-course award row + every parent manifest pinning it as a child, with each pin's required standing and the parent award state), **marks** (the applicable pass-mark snapshot of every attempt that started on the release — mark, carried `{source,provenance,value}` override contract, declared point scale — immutable row data), **the AD-13 shared evaluator verdict** (a pure `deriveEvaluatorVerdict` over the SAME predicate family the award evaluation uses: unaided scored evidence only, outcome `demonstrated` exactly when a clean final-pass or fully-recovered (cleared-or-corrected) path exists and no open dispute pauses the pending decision, computed under the PINNED policy of the attempt that satisfies it — root policy fixed — falling back to the release's published deterministic build when no attempt exists), **reporting projections for epic 5** (per-attempt grade/pass history with grade kinds, the release's recovery chain state through the shared additive predicate, and the provisional-grade count — always zero in personal study, the typed contract epic 5's confirmed grades ride), and **the activity/rubric/completion contract shape epic 6 extends** (`ActivityCompletionLink` instances: the release's tracker items as required-item/optional-activity links and the required test as a required-test link carrying its rubric contract). A `fields=` scope declaration (the provenance fence) checks the consumer's intended field names against the contract FIRST: `answers`, `scheduling`, `roster` or any invented name is `INVALID_INPUT` before a single row is read — the surface structurally cannot serve what it does not own. Supersession stability is the provenance no-live-pointer rule: no field anywhere in the document reads "latest ready version" or any live pointer, so a superseding release changes nothing in a pinned read — every array is immutable row data scoped to the pinned release's own rows (new attempts/manifests on that release may only APPEND entries, never rewrite one — the documented monotonic-derivatives split). The verdict computation imports nothing from `review-port.ts`: the review seam stays one-directional (the roadmap READS review state; review CONSUMES this verdict), so a review consumer computes success sequencing from this surface with zero scheduling dependency — no scheduling, due-list, reminder or instructor surface is built here.

## Boundaries & Constraints

**Always:**
- Read-only everywhere: the handoff document derives purely from rows 021–026 and the epic-2 course row already own (attempts, targets, retests-as-history-inputs, disputes, awards, manifests, studied pointer, course content); no repository function gains a write; `getAssessmentHandoff` runs one gather transaction (identify → authorize → scopedRoot → reads) and the pure derivation after it.
- Version pinning: `?course=<uuid|version>` resolves only a READY release of THIS owner and root (`readyCourseById`/`readyCourseByVersion`; anything else `FORBIDDEN_OR_NOT_FOUND`, no leak); the default read resolves the STUDIED release (pointer first, else `getCourse`'s default resolution with honest `pending`/`failed`/`none` states) — the same release `getAssessment` serves, which is what AD-13's review consumer pins.
- Supersession stability (structural): the document has NO live supersession pointer and no field derived from anything but the pinned release's own rows — a pinned read after a superseding regeneration is value-identical; a NEW default read resolves the new release and serves ITS facts. New evidence on the pinned release itself (a new attempt, a newly planted parent manifest) may only append — existing entries are immutable rows and are never rewritten.
- The evaluator verdict is the SHARED truth, not a second one: outcome/denial reuse `gradeAwardsCompletion`'s final-only fence, `recoverySatisfiedWithCorrections` (the additive cleared-or-corrected predicate) and `deriveCompletionPause` (the 3.7 pause predicate) — the verdict can never disagree with the award evaluation, the recovery panel or the roadmap. Assisted practice and self-report have no input path (the derivation's input type has no practice field at all — AD-7 separation is structural); a provisional-typed grade can never read as a pass (the same `GradeDecision` fence); an open dispute that pauses the pending completion decision also holds the verdict honestly `not-demonstrated` (`pausedByOpenDispute: true`), and an earned award is served read-only (`awardAwardedAt`) — review never grants or revokes completion, and this surface exposes no write that could.
- The pinned policy: the verdict's `policy` is the satisfying attempt's own snapshotted mark/override/answer-rule/rubric (root policy fixed through recovery — AD-8), falling back to the newest attempt's pin, falling back to the release's published deterministic build (the same `buildSnapshot(objectives)` the offered disclosure serves — later policy edits affect only later attempts/reviews, never a pinned one).
- Scope denial: `fields=` names are checked against the contract's field-name set before anything is read (`INVALID_INPUT` otherwise — including empty); the declaration never projects or filters (the response is always the full document) — it exists so an out-of-scope consumer intent is refused by the contract, the provenance rule verbatim.
- Cross-owner and cross-root denial are structural: every read is owner_id-scoped and root-scoped (another owner's rootId fails `scopedRoot`; a foreign release pin fails the ready-release read) — same taxonomy, no leak.
- `npm run lint`, `typecheck`, `typecheck:worker`, `boundaries`, full unit suite green NOW; integration suite AUTHORED to the assessment.test.ts conventions but NOT RUN this phase (the shared DB cluster is reserved for the serialized full gate the orchestrator runs); no skips/overrides/suppressions anywhere.

**Never:**
- No migration: the handoff changes NO stored shape — it is pure read-time over existing tables (the documented 3.3/3.6 no-migration precedent). Migration number 027 stays UNUSED by this story; no other numbered migration is created. Flagged to the orchestrator since the lane numbering reserves 027 for this story.
- No writes, no review scheduling, no due-list, no reminders, no verdict sequencing, no instructor surface, no UI (a downstream query surface only — the tracer app does not grow a screen); no edits to `tests/unit/assessment.test.ts`, `tests/integration/assessment.test.ts`, `tests/integration/disputes.test.ts`, `tests/integration/roadmap.test.ts` (sibling-lane collision rule — new test files only; `tests/integration/handoff.test.ts` is EPIC-1 S5's file and is not touched — this story's integration file is `assessment-handoff.test.ts`).
- No AI dispatch, no provider reads, no queue changes, no new dependencies, no lint-config changes, no refactors (3.10's job); no answer-key exposure anywhere (the rubric contract carries the DISCLOSED policy — mark, override provenance, answer rule, rubric text, scale, total — never an `answerId`); loopback-only, original synthetic fixtures only.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Pinned consumer read | `?course=<v1 courseId>` after v1 earned an award | document pins release v1: award row, marks of v1's attempts, verdict computed under the satisfying attempt's pinned policy, reporting projections, activity links | none |
| Default read | no selector, studied release ready | the STUDIED release serves (pointer, else confirmed-plan row, else latest ready) | none |
| Supersession stability | v2 regeneration lands after the pinned read | pinned v1 read value-identical (no live pointer field exists); a fresh DEFAULT read resolves v2 | none |
| Pinned prior by version | `?course=1` when v2 is current | v1 document serves (ready-by-version read) | none |
| No course yet | confirmed study, no course row | honest `none` state (no invented facts) | none |
| Generation in flight / failed | resolved row pending/failed | honest `pending`/`failed` states (requestId/failureCode) — no document | none |
| Stale/foreign selector | another owner's course id, unknown version, non-ready pin | — | `FORBIDDEN_OR_NOT_FOUND`, no leak |
| Cross-owner root | B requests A's rootId | — | `FORBIDDEN_OR_NOT_FOUND` (scopedRoot fence) |
| Out-of-scope fields | `fields=answers` / `fields=scheduling` / `fields=` (empty) | — | `INVALID_INPUT` before any row is read |
| Valid fields declaration | `fields=awards,evaluator-verdict` | full document serves unchanged (declaration checks scope, never filters) | none |
| Verdict: clean final pass | graded passing attempt, no open disputes | `demonstrated`, basis `final-pass` + attemptId, policy = that attempt's pinned snapshot policy | none |
| Verdict: full recovery | failed attempt, every target cleared-or-corrected, no open dispute on the chain | `demonstrated`, basis `full-recovery` + root attemptId | none |
| Verdict: open recovery | failed attempt, ≥1 open target | `not-demonstrated` (uncleared targets never inferred passed) | none |
| Verdict: dispute pause | open dispute taints every would-be path | `not-demonstrated` + `pausedByOpenDispute: true`; earned award still served read-only | none |
| Verdict: clean newer pass escapes | open dispute on an OLD failed attempt, newer clean pass exists | `demonstrated` (basis the clean pass), `pausedByOpenDispute: false` — the 3.7 rule | none |
| Verdict: no attempts | release ready, nothing started | `not-demonstrated`, policy = the release's published build (the offered disclosure's) | none |
| Provisional projection | personal study, any state | `provisionalGrades: 0`, every attempt `gradeKind: "final"` — the typed contract epic 5 rides | none |
| Parent manifest pins | manifest lists the release as required/optional child | parents entry with the pin's required standing + parent award state; new manifests may append only | none |
| Evidence growth on pinned release | new attempt/manifest lands on the pinned release | existing entries unchanged; arrays append (the monotonic-derivatives split, documented) | none |

</intent-contract>

## Code Map

- `src/contracts/assessment.ts` — EXTEND (Story-8 section, appended): `EVALUATOR_VERDICT_VERSION`, `evaluatorVerdictOutcomes`, `EvaluatorPolicyPin`, `EvaluatorVerdict`; `HANDOFF_...` field-name set `handoffFieldNames` + pure `parseHandoffFields` (the provenance parser pattern — `{ ok: false }` for any non-contract or empty name); `ACTIVITY_COMPLETION_LINK_VERSION`, `ActivityRubricContract`, `activityCompletionRoles`, `ActivityCompletionLink`; `HandoffReleasePin`, `HandoffAwardsBlock` (mini-course award view + parent pins), `PassMarkSnapshot`, `HandoffAttemptProjection`, `HandoffRecoveryProjection`, `HandoffReportingBlock`, `AssessmentHandoffDocument`, `AssessmentHandoffState` (the none/pending/failed/ready state union mirroring `ProvenanceState`).
- `src/modules/assessment-progress/handoff.ts` (NEW, pure — the guidance/roadmap/disputes pattern) — `deriveEvaluatorVerdict(input)` (the AD-13 shared evaluator: clean-pass / full-recovery basis selection newest-first, the shared pause predicate, the pinned-policy fallback chain) and `deriveHandoffDocument(input)` (awards block, marks, verdict, reporting projections, activity links over the release's tracker items + the required-test rubric contract). Imports row TYPES only from `./repository` and predicates from `./scoring`/`./disputes` — never `review-port` (one-directional seam).
- `src/modules/assessment-progress/service.ts` — EXTEND (surgical add, one exported read): `getAssessmentHandoff(identity, rawId, requested?, rawFields?)` — selector/fields validation, one gather transaction (authorize → scopedRoot → batchRow → pointer/release resolution → owner-scoped reads), `buildSnapshot(objectives)` for the published-policy fallback, the pure derivation, `objectIds` for the protected-response fence. No existing function changes.
- `src/app/api/v1/[...path]/route.ts` — EXTEND (one GET branch): `studies/{rootId}/assessment/handoff` — the `provenance` branch's shape (optional `?course=`, every-value-joined repeated `?fields=`, `protectedResponse` with the document's objectIds).
- `src/modules/assessment-progress/repository.ts` — NO EDITS (every read the surface needs already exists: `attemptsForRoot`, `targetsForRoot`, `disputesForRoot`, `awardForCourse`, `parentManifestsFor`, `studiedRelease`, plus course-generation's `readyCourseById`/`readyCourseByVersion`/`courseForPlan`/`latestReadyCourse` through the established read-only precedent).
- Tests — NEW files only: `tests/unit/assessment-handoff.test.ts` (verdict matrix incl. pause/escape/recovery/no-attempts/policy-pinning, document derivation incl. marks/awards/parents/reporting/activity links, supersession stability of the pure derivation, strict `parseHandoffFields` contract, answer-key absence in the serialized document); `tests/integration/assessment-handoff.test.ts` (AUTHORED to the assessment.test.ts conventions — owner/actor/confirmedStudy/generateCourse helpers, real verbs — covering the ticket's verify scenarios; NOT RUN this phase: the shared DB cluster is reserved for the serialized full gate; the orchestrator merges and executes it later).
- `docs/project-structure.md` — EXTEND: the assessment-progress entry grows the story-8 handoff read surface in the same change.

## Tasks & Acceptance

**Execution:**
- [ ] `src/contracts/assessment.ts` — Story-8 handoff contracts + the pure fields parser.
- [ ] `src/modules/assessment-progress/handoff.ts` — `deriveEvaluatorVerdict` + `deriveHandoffDocument`.
- [ ] `src/modules/assessment-progress/service.ts` — `getAssessmentHandoff` (surgical add).
- [ ] `src/app/api/v1/[...path]/route.ts` — the handoff GET branch.
- [ ] `tests/unit/assessment-handoff.test.ts` — pure-surface coverage.
- [ ] `tests/integration/assessment-handoff.test.ts` — authored-pending-execution verify scenarios.
- [ ] `docs/project-structure.md` — same-change update.

**Acceptance Criteria:**
- A synthetic downstream consumer resolves a course's awards, applicable marks and evaluator verdict pinned to an exact revision (`?course=` selector), and the pinned read is value-identical across a superseding regeneration while a fresh default read resolves the new release.
- The evaluator verdict is computable with zero scheduling surface: the document exposes outcome/basis/pinned policy/pause/award-read-only and contains no scheduling, due or reminder field anywhere; the derivation never reads `review-port`.
- The verdict's outcome agrees structurally with the completion machinery (same final-only fence, same additive recovery predicate, same pause predicate) — demonstrated exactly on a clean pass or full recovery, honestly not-demonstrated while an open dispute pauses, never readable from a provisional grade, and never influenced by practice/self-report evidence (no input path exists).
- Out-of-scope and cross-owner reads are denied: `fields=` naming anything outside the contract is `INVALID_INPUT` before any read; another owner's root or release pin is `FORBIDDEN_OR_NOT_FOUND` with no leak.
- Full unit suite green; lint/typecheck/typecheck:worker/boundaries green; integration suite authored and convention-conformant, execution deferred to the orchestrator's serialized phase.

## Design Notes

Latitude taken (recorded per the house rule): (1) **No migration** — the surface is pure read-time over 021–026 and the epic-2 course rows (the documented 3.3/3.6 precedent); migration number 027 stays unused and is flagged to the orchestrator. (2) The evaluator verdict REUSES the completion machinery's predicates instead of defining new ones (`gradeAwardsCompletion` fence, `recoverySatisfiedWithCorrections`, `deriveCompletionPause`) — one shared truth; the only new logic is basis selection (which attempt's pinned policy to serve) with the published-build fallback, mirroring AD-13's "defaulting to its published policy". (3) The default resolution is the STUDIED release (pointer-aware), unlike `getProvenance`'s confirmed-plan default — assessment facts follow the learner's studied version, which is what AD-13 tells review to pin; the honest pending/failed/none states still mirror `ProvenanceState`. (4) Supersession stability follows the provenance no-live-pointer rule: the document deliberately omits any latest-ready/superseded field, and the arrays are documented as evidence-monotonic (append-only) rather than byte-frozen — new attempts on a pinned release are new evidence, not supersession, and existing entries are immutable rows. (5) `fields=` never filters (the provenance rule verbatim) — it is a scope CHECK, so the out-of-scope denial is proven by the contract set itself. (6) The activity/rubric/completion link carries the release's own tracker items plus the required test — epic 6's activity families extend the shape; nothing here invents activity kinds that do not exist yet. (7) The rubric contract exposes only pre-start DISCLOSED policy (mark, override provenance, answer rule, rubric text, scale, total points) — the answer key stays snapshot-only (serialized-document answer-absence is unit-asserted). (8) `reporting.provisionalGrades` is a count, not a list — in personal study it is always 0; the typed `GradeKind` on every attempt projection is the contract epic 5's instructor grades ride, and no pass can be read off a provisional kind anywhere in the document.

## Verification

**Commands (this phase):**
- `nvm use && NPM_CONFIG_USERCONFIG=/dev/null NEXT_TELEMETRY_DISABLED=1 npm run lint` — expected: green, covered-rule count unchanged.
- `npm run typecheck` / `npm run typecheck:worker` — expected: green (Next generated types are provided; no dev server is booted this phase).
- `npm run boundaries` — expected: green (contracts import nothing new; handoff.ts imports types/predicates only).
- `npm run test` — expected: full unit suite green including the new `tests/unit/assessment-handoff.test.ts`.
- `tests/integration/assessment-handoff.test.ts` — AUTHORED ONLY this phase (the shared DB cluster is reserved for the serialized full gate); the orchestrator merges, runs migrations (unchanged set) and executes it. Unit coverage mirrors the verify scenarios on the pure surface to de-risk that run.
