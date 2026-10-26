---
title: 'Active recall practice set and typed feedback'
type: 'feature'
ticket: '2.5'
created: '2026-10-27'
status: 'draft'
baseline_revision: ''
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

**Problem:** The course carries exactly one recall item — the plan's objectives have no practice set, no typed feedback, and no recorded practice evidence for later epics.

**Approach:** Extend generation to a practice set across the confirmed plan's objectives (one recall card per objective, answers and rationales withheld server-side until submission), upgrade the recall flow to per-card submission with typed feedback blocks (correctness, canonical answer, rationale, source location, evidence kind), record each submission as typed practice evidence (unaided vs assisted, chosen by the learner; no scores, no course-attempt semantics — epic 3 owns those), make retries fresh non-duplicate attempts, and purge practice derivatives with the course lineage.

**Gate decisions (2026-10-27):** covered by the owner's "continue to implement all the rest tickets of epic 2" direction; checkpoints proceed under the standing decision delegation (surfaced, logged, renegotiable). No new processor-configuration version: the practice set derives from the same consented categories (plan outcomes, source excerpts) already covered by v7 — nothing new leaves the machine.

## Boundaries & Constraints

**Always:**
- Attempt-before-answer on EVERY card: answers and rationales never appear in any GET payload; released only in per-card submission feedback. The single-recall contract from 2.1 generalizes (field-level withholding; the fixture's lesson/framing/enrichment text must not quote any card's canonical answer).
- Typed evidence without attempt semantics: one row per submission (owner, course version, card id, attempted text, outcome, evidence kind unaided|assisted, submitted_at); NO score, credit, completion, course-attempt or scheduling fields (epics 3/4 own those); retries are fresh rows under new commands — never deduplicated, never double-counted as anything; command-envelope replay of the SAME command returns the recorded feedback idempotently.
- Assisted practice is learner-declared at submission and labeled everywhere it is shown ("Assisted" vs "Unaided"); evidence kinds are never conflated (D2).
- Feedback blocks follow the spine: appear only after submission; state correctness, canonical answer, rationale, source and evidence kind; uncertainty is stated, not hidden.
- Practice set integrity: every confirmed-plan objective has exactly one card; cards bind to objective indexes and source refs that resolve (strict parser, 2.1 rules); per-version practice sets (regeneration supersedes; prior versions keep their cards and evidence); stored v1–v3 content serves unchanged (legacy single recall becomes the one-card set view).
- Deletion/export: practice evidence is a root derivative cascading with the course lineage; export gains a `practice-evidence` category with an honest deliberate skip (inclusion decided by entry 8 — attempted text is owner content but the bundle carries answer keys in rationale references).
- Migration `019` additive (`app.practice_attempt` + no other DDL); tests unit+integration+browser, zero skips; `docs/project-structure.md` in the same change; Node v24.22.0, loopback-only, no new dependencies, no live dispatch.

**Never:**
- No scored items, pass marks, scheduling (spaced review is epic 4), course-attempt semantics (epic 3), or completion effects; no inference of evidence kind; no second submission path.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Practice set generated | course v4 (plan with N outcomes) | N cards, one per objective, each with prompt + withheld answer/rationale/source | — |
| Card submission | learner submits attempt text (+ assisted toggle) | typed feedback: correctness, canonical answer, rationale, source, evidence kind; evidence row persisted | invalid body → INVALID_INPUT |
| Withholding | any GET before submission | no card answer/rationale in any payload; page DOM clean | — |
| Retry | new submission after feedback | fresh attempt row + fresh feedback; prior rows untouched; no double-count anywhere | — |
| Command replay | same commandKey re-sent | recorded feedback replayed; no second evidence row | — |
| Assisted label | assisted toggle on | evidence + feedback labeled Assisted; never merged with unaided | — |
| Legacy content | stored v1–v3 course | serves as its own (single-card or no-card) set unchanged | — |
| Cross-owner / deleted / ungenerated | B; deleted root; no ready course | standard denial taxonomy | — |
| Purge | root/personal deletion | practice_attempt rows removed with the course lineage; export lists the honest skip | — |

</frozen-after-approval>

## Code Map

- `src/contracts/courses.ts` — content v4 (`practice: { cards: [...] }` replacing/augmenting the single recall; keep `recall` as derived-from-first-card for compatibility), evidence schemas, submission command, serving shapes (cards without answers; feedback with).
- `src/modules/course-generation/{generation,worker,service,repository}.ts` — fixture/parser: one card per plan outcome (answer derived from the card's own source, distinct from lesson text — withholding preserved); serving: per-version cards + evidence joins; `submitPracticeCard` generalizes `submitRecall` (per-card, assisted flag, typed evidence row, content-free receipt with recompute-on-replay); purge/export wiring.
- `migrations/019-practice-evidence.sql` — `app.practice_attempt` (owner, course_id CASCADE, card_id, attempted, outcome, evidence_kind, submitted_at; UNIQUE nothing — fresh rows allowed; replay guarded by command receipts) + lifecycle preview/purge counts.
- `src/contracts/export.ts` + `src/modules/setup-export/{manifest,service}.ts` — `practice-evidence` deliberate-skip category.
- `src/app/course-stage.tsx` — practice section: per-card recall cards (prompt, attempt textarea, assisted checkbox labeled, submit), feedback blocks after submission only, retry affordance, keyboard-complete; live-region rules from 2.3.
- Tests: `tests/unit/course-generation.test.ts` (set shape, withholding, per-card judging), `tests/integration/course-generation.test.ts` (set across objectives, typed evidence rows, retry freshness, replay idempotency, assisted separation, legacy serving, purge, export skip), `tests/browser/course.spec.ts` (multi-card journey keyboard-only, feedback-after-submission, assisted label, retry fresh).

## Tasks & Acceptance

**Execution:**
- [ ] `migrations/019-practice-evidence.sql` — practice evidence table + guards; lifecycle counts.
- [ ] `src/contracts/courses.ts` — v4 practice schemas, submission/feedback/evidence shapes, legacy compat.
- [ ] `src/modules/course-generation/generation.ts` — fixture + parser: one card per objective, per-card source-bound answers, strict bounds, withholding preserved across lesson/framing/enrichment.
- [ ] `src/modules/course-generation/{service,repository}.ts` — `submitPracticeCard` (typed evidence, assisted, replay-recompute), set serving, purge/export.
- [ ] `src/app/course-stage.tsx` — practice cards UI per the spine (withhold → submit → feedback; retry fresh; assisted labeled; keyboard-complete).
- [ ] API route updates if paths change; tests per Code Map; `docs/project-structure.md`.

**Acceptance Criteria:**
- Given a course generated from a plan with N outcomes, when studied, then N recall cards each withhold answer/rationale until that card's submission and feedback states correctness, canonical answer, rationale, source and evidence kind.
- Given a submission, then one typed evidence row (unaided or assisted as declared) persists with no score/credit/attempt semantics, and a retry produces a fresh row without duplicating or altering prior evidence.
- Given stored pre-2.5 courses, when studied, then they serve unchanged.
- Given root/personal deletion, when purge runs, then practice evidence is removed and the export records the honest skip.

## Implementation Notes

## Plan Change Log

## Review Triage Log

## Design Notes

- Keep the 2.1 single-recall submission endpoint working (legacy clients/tests) by deriving it from card 0 — one judge, two thin verbs — rather than a parallel path.
- Card ids follow the tracker pattern: `practice:<objectiveIndex>`; evidence uniqueness is per submission event, keyed by command receipts.

## Verification

**Commands:**
- `nvm use && NPM_CONFIG_USERCONFIG=/dev/null NEXT_TELEMETRY_DISABLED=1 npm run migrate` — 019 additive.
- `npm run boundaries && npm run typecheck && npm run typecheck:worker && npm run lint` — green.
- `npm run test && npm run test:integration` — green, zero skips.
- `npm run build && npm run test:e2e` — practice journey green; typegen dance; dev state restored.
- Full `npm run checks` at the next wave boundary.

**Manual checks (if no CLI):**
- Keyboard-run every card; submit; verify feedback and assisted label; retry and confirm a fresh attempt.
