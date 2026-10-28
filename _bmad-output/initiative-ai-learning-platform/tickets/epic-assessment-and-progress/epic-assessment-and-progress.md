---
type: epic
title: Learners pass tests and recover targeted gaps
parent: initiative-ai-learning-platform
covers: [R10, R13, R14, R20]
sources:
  [
    _bmad-output/initiative-ai-learning-platform/initiative-ai-learning-platform.md,
  ]
companions:
  [
    _bmad-output/initiative-ai-learning-platform/product-policies.md,
    _bmad-output/initiative-ai-learning-platform/architecture-shared-technical/architecture-shared-technical.md,
    _bmad-output/initiative-ai-learning-platform/prd-ai-learning-platform/prd-ai-learning-platform.md,
    _bmad-output/initiative-ai-learning-platform/ux-ai-learning-platform/EXPERIENCE.md,
    _bmad-output/initiative-ai-learning-platform/ux-ai-learning-platform/DESIGN.md,
  ]
after: [epic-private-study-setup, epic-grounded-mini-courses]
refined: true
risk: high
---

# Learners pass tests and recover targeted gaps

## Description

Add valid scored attempts, evidence-linked next-study guidance, focused review/reassessment and whole-mini-course roadmap progress to epic 2's generated courses. Attempt evidence and completion awards obey epic 1's owner/consent/lifecycle contracts; epic 2's versioned objectives, source-linked units and practice evidence are consumed, never re-written. Preserve passed sections and versioned results rather than award completion from reading, confidence or an invented replacement score. This epic supplies the versioned completion, applicable pass-mark and unaided-evidence handoffs that review, instructor reporting and later activity families consume.

## Outcome

A learner sees why an objective needs attention, can recover a failed requirement through focused reassessment, and completes a mini-course only under the content-plus-tests rule.

## Requirements

Each line carries its parent requirement's words at this epic's altitude; local ids resolve to the parent ids in `covers`. The PRD companion's §4.3 consequences and the UX spine's test/recovery/roadmap patterns bind the stories through References.

- **R1 — Evidence-linked gaps and next-study guidance** (parent R10): identify knowledge needing attention and explain what to study next from relevant response/objective evidence — scored attempts, targeted-recovery target state, practice and required-content completion — citing the evidence each recommendation draws on and its uncertainty; keep Unknown (unassessed) distinct from Needs practice (observed difficulty, cause unnamed); keep assisted practice, unaided performance, self-report and engagement separate rather than claim certain diagnosis. Verify guidance that cites its response/objective evidence, shows unknown-versus-observed-difficulty distinctions, separates the four evidence kinds, and offers a flag-an-unclear-question path feeding R3 correction.
- **R2 — Snapshotted scoring and content-plus-tests completion** (parent R13): finish required content items (explicitly marked done) and required non-test activities and pass all related required tests, normally or through R3, before completing a mini-course; complete every required mini-course before completing its parent. Each attempt snapshots the test blueprint, questions, rubric, point scale and applicable pass mark at start; compare unrounded earned-points percentages at or above the applicable mark — the 80% default, instructor-configurable for their courses. Verify required-item/activity gaps, provisional/failed/unattempted tests, threshold/rounding boundaries, passing with some wrong answers, version changes and normal/recovered completion without retroactive loss of earned progress.
- **R3 — Targeted recovery and reassessment** (parent R14): inspect failed questions, offer focused review, then a fresh same-objective/same-intended-demand retest of still-failed groups. Passing a targeted group clears that failed area toward the original failed-test requirement without repeating passed sections or inventing a new original score; uncleared recovery targets still block that requirement. Verify successful/failed/partial-target recovery, retained passes, disclosed rubrics, unlimited pedagogical retries with honest resource delays, disputed-item correction, and C4 approval boundaries where instructor versions exist (epic 5 activates them).
- **R4 — Whole-mini-course roadmap nodes** (parent R20): after goal selection, show entire-mini-course nodes as Not started, In progress or Completed, with separate Needs practice/Review due indicators. Verify R2 completion mapping, recommended prerequisite order and free browsing of available authorized nodes without hard locks, XP or loss of completion when review becomes due.

## Constraints

- Parent C1–C7 bind every story; especially C4 (no access or approval shortcuts during personalization, supplementation and tailored reassessment) and C6 (formative scope; policy edits and invalid-item findings cannot revoke earned passes/completion; annotate defects and pause only pending/unearned decisions).
- Delegated defaults bind as written: D1 (structure, whole-mini-course nodes, version-scoped progress, no locks/XP), D2 (evidence separation; Unknown vs Needs practice; guidance cites evidence and uncertainty), D3 (80% default, unrounded thresholds, attempt snapshots, disclosed partial-credit rubrics, no negative marking, no pedagogical retry limit, targeted-group credit, disputed-item correction), D6 (completion-versus-review separation) and D7 (manual fixture claim/rubric checks, keyboard/360px/desktop bar, 120-second honesty, retry double-count ban).
- Shared AD-1–AD-18 bind; especially AD-2 (row locks serialize attempt finalization, recovery credit and completion), AD-3/AD-4 (per-operation scope checks; attempts/evidence/credits/awards are scoped lifecycle-registered derivatives), AD-5 (immutable revisions, pinned manifests, monotonic version-scoped awards), AD-7 (purpose-typed shared evidence; scored-assessment distinct from practice/self-report), AD-8 (nonnegative scaled-integer points, exact rational threshold comparison, targeted-credit ledger, monotonic completion), AD-9 (idempotent durable jobs), AD-13 (review consumes this epic's shared evaluator verdict; review never writes completion), AD-14 (reporting consumes scoped query contracts) and AD-15/AD-18.
- No learner-facing time limits, no XP/rewards/hard prerequisite locks, no perfect-score requirement on passing tests, and no conflation of engagement or self-report with unaided performance.

## Done when

1. Required content/activity completion and normal test passing produce version-scoped mini-course/parent progress; missing work, unattempted tests and provisional/failed grades do not (R2). Roadmap nodes are whole mini-courses with separate practice/review indicators and no hard locks (R4).
2. Default 80% thresholds, applicable mark snapshots, unrounded boundaries, disclosed rubric/partial credit, version changes and result history follow D3 (R2). An ordinary passing test may contain wrong answers; policy edits or invalid-item findings do not revoke earned completion.
3. Failed question → evidence-linked review → fresh comparable targeted retest works for success, failure and partial/unassessed target coverage, preserving passed sections and original scores (R1/R3). Unknown, assisted and self-reported evidence remain distinct; invalid questions follow pending-versus-earned correction rules.
4. Completion/evidence outputs, ownership/export/deletion and repeated-submit/resource-delay paths are integrated, and the versioned completion, applicable-pass-mark and unaided-evidence handoffs for epics 4–6 are exposed and contract-tested. Once authorized, production verification exercises both normal and recovered completion plus denied cross-owner access; these are formative results, not certified grades.

## Boundaries

- Owns scoring/rubric/attempt snapshots, completion and gap guidance, targeted credit/correction, and roadmap progress. Consumes epic 1 ownership/plan/lifecycle and epic 2 objective/source/practice contracts.
- Supplies versioned completion, applicable mark and unaided-performance handoffs to epic 4; supplies published required-outcome, provisional subjective-grade and evidence/reporting contracts for epic 5; supplies activity/rubric/completion contracts to epic 6.
- Epic 5 adds instructor-controlled pass marks, subjective confirmation and exact-version approval before that mode is exposed. No instructor content route is enabled by this personal-study release.
- No perfect-score requirement, retroactive progress erasure, claim of permanent mastery, unchanged question relabeled as a fresh retest, or generation quota counted as a learning failure.
- Touch point: export/deletion/retention derivative classes — extended here for attempt/evidence/credit/award/guidance derivatives; owner: epic-private-study-setup (S8/S9/S10).
- Touch point: versioned course/objective/provenance query surface and content-done/practice evidence — consumed read-only, never re-written; owner: epic-grounded-mini-courses (S3/S5/S7).
- Touch point: review-state query feeding the roadmap's Review-due indicator — stubbed port here, scheduling/verdict sequencing owned by epic-spaced-review; this epic exposes only the AD-13 shared evaluator verdict.
- Touch point: setup-diagnostic typed-evidence pattern (`src/contracts/diagnostic.ts`) — reused as the shape for purpose-typed evidence; the starting check itself and its evidence stay epic 1's.

## References

- parent — [initiative requirements](../../initiative-ai-learning-platform.md), R10/R13/R14/R20; Constraints C1–C7 and G1/G2.
- policy companion — [product policies](../../product-policies.md), D1/D2/D3/D7; D6 completion-versus-review separation.
- architecture companion — [shared technical architecture](../../architecture-shared-technical/architecture-shared-technical.md), all AD-1–AD-18; especially AD-2–AD-8, AD-13 and AD-14 for pinned scoring, parent/child awards, targeted credit, review verdict handoff and scoped reporting.
- PRD companion (adopted) — [consolidated PRD](../../prd-ai-learning-platform/prd-ai-learning-platform.md), §4.3 consequences for FR-10/FR-13/FR-14/FR-20, §8 guardrails and §9 NFRs.
- UX companions (adopted) — [experience spine](../../ux-ai-learning-platform/EXPERIENCE.md), Test & recovery and Roadmap surfaces, Test attempt view / Recovery path / Roadmap node / Feedback block patterns, State Patterns (Pass-mark boundary, Item under review, Partial recovery, Version superseded), Flow 2 and the interaction/accessibility floor; [visual identity](../../ux-ai-learning-platform/DESIGN.md), Fieldnotes tokens.
- delivery breakdown — [prerequisite and handoff contracts](../tickets.toml), epic 3, consuming epics 1/2 and supplying later integrations.
- story breakdown — [ordered implementable entries](tickets/tickets.toml), local R1–R4 coverage, dependencies, human steps and start-blocking unknowns. No leaf has been pulled or started.

## Notes

- Decision: 2026-10-21 — tests/recovery and visible progress are one coupled deployable outcome, not separate grading-service and roadmap-UI epics.
- Waits on epic-private-study-setup because: attempt evidence/plan state must obey owner and lifecycle contracts.
- Waits on epic-grounded-mini-courses because: valid assessments/recovery require actual source-backed versioned objectives and learning units.
- Decision: 2026-10-21 — adopt shared evidence, exact scoring/recovery and monotonic completion contracts; keep whole-epic dependencies.
- Decision: 2026-10-24 — refined under the user's standing delegation (the 2026-10-24 "finish them" product-wide companion adoption and this epic's refinement direction): local R1–R4 are the four owned parent lines, one per parent id, deepened only with the PRD/UX/architecture consequences already adopted product-wide; no parent scope is added or dropped. This resolves the 2026-10-21 open question on UX and reference rubrics: the UX spine is adopted below, and manually checked fixture claim/rubric verification stays a D7 bar carried by every scored-item story and the closing suite.
- Decision: 2026-10-24 — adopt the consolidated PRD and the final product-wide UX spine (EXPERIENCE.md/DESIGN.md) as this epic's companions; their test & recovery, roadmap and honest-state patterns are the binding UX contracts for its stories.
- Decision: 2026-10-24 — tracer bullet is entry 1 "Plan-to-roadmap scored-attempt tracer": the thinnest confirmed-plan → objective-linked test attempt → snapshotted 80%-default scoring → roadmap node state path through web, contracts, modules, worker and adapters on local synthetic fixtures. It proves the layer path and is neither full D3/AD-8 acceptance nor full-epic Done.
- Decision: 2026-10-24 — entry 2 (targeted recovery ledger and fresh retest chain) is the riskiest/most-uncertain story and comes next: AD-8's targeted-credit arithmetic, failed-group mapping, root-policy pinning and demand/coverage equivalence are the epic's recorded uncertainty ("blueprint checks are not proof of psychometric equivalence"), so they precede the full scoring surface, completion assembly, guidance and roadmap. Declined alternative: full scoring surface second — its arithmetic is deterministic and well specified, so it follows rather than leads.
- Decision: 2026-10-24 — one ordered lane of eleven entries — tracer, recovery chain, scoring surface, completion/parent awards, gap guidance, roadmap surface, disputed-item correction and honest retries, downstream handoff surface, lifecycle/ownership integration, Refactor sweep, closing integrated suite — because attempt/evidence/award schema and scoring semantics evolve story to story. The sweep waits on every entry except the closing suite, which mirrors epic 2's entry-10 shape with live/deployment bits `unknown`-blocked.
- Decision: 2026-10-24 — the roadmap's Review-due indicator is rendered from a stubbed review-state query port owned by epic-spaced-review; this epic exposes only the AD-13 shared evaluator verdict review consumes. No scheduling, due-list or reminder behavior is built here.
- Assumption: personal-study scored tests use objective items with declared answer rules scored deterministically (AD-8); the provisional-subjective-grade type is specified here as a contract for epic 5, whose instructor confirmation step owns awarding — no subjective grading ships in this epic.
- Assumption: development and local-gate acceptance run on manually checked original-synthetic fixture test/retest banks; live AI generation of fresh retest variants and AI-narrated gap guidance are live-gated enhancements whose acceptance waits on a purpose-re-gated eligible processor (epic 2's F-A pattern), not blockers for the deterministic contracts.
- Assumption: content-done and practice evidence are recorded by epic 2's tracker/practice surfaces under the shared AD-7 evidence contract; this epic records only scored-assessment, recovery and completion evidence and never re-writes epic-2 records.
- Assumption: Needs practice is derived deterministically from failed or partially-recovered objective groups and practice evidence, cause unnamed (D2); Unknown covers unassessed objectives. The starting check's diagnostic evidence is not consumed by guidance in this epic.
- Open question: whole-epic execution gates and start authorization (entry 1's `unknown`): epic 1 is not closed (S6, S7 take-path closure and S12 remain blocked on F3/F6) and epic 2's supplied contracts are unbuilt; the 2026-10-21 whole-epic gate stands and no story starts without explicit authorization. Owner: user/future planner.
- Open question: live processor eligibility re-gated for assessment purpose (fresh retest generation, AI gap guidance) and deployment authorization for the closing suite — recorded as `unknown` on entries 2, 5 and 11 following epic 2's F-A/F-C pattern; synthetic-fixture development is not blocked. Blueprint/fixture checks do not establish psychometric equivalence or release readiness.
