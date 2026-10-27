---
title: 'Learner-controlled why exploration with honest stopping'
type: 'feature'
ticket: '2.6'
created: '2026-10-27'
status: 'built'
baseline_revision: '84b02c9'
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

**Problem:** Learners cannot ask "why" behind a lesson — successive deeper explanations tied to the evidence, with honest stopping when the evidence runs out, do not exist.

**Approach:** Build the spine's why-stepper on lesson content: a per-lesson "Go deeper" command dispatches one generation through the existing admission/settle machinery and persists a why-explanation derivative (depth-addressing purpose, assumptions or trade-offs beyond restatement, each level tied to visible sources including S2 supplements). Evidence availability is computed server-side from the stored course/supplement material BEFORE any dispatch — a request past the available evidence returns an honest exhaustion notice and performs zero dispatch (no invented cause). The stop control is always visible and keyboard-operable at every depth; depth never unlocks content or credit; every response carries the unreviewed label and derivative lineage (cascading purge with the course).

**Gate decisions (2026-10-27):** covered by the owner's "continue to implement all the rest tickets of epic 2" direction; checkpoints proceed under the standing decision delegation (surfaced, logged, renegotiable). No new processor-configuration version: why requests consume already-consented categories (lesson summaries, source excerpts, supplements) under v7; nothing new leaves the machine.

## Boundaries & Constraints

**Always:**
- Depth quality bar: each level must address purpose, assumptions or trade-offs BEYOND restatement (strict parser rejects restatement-shaped drafts — deterministic check against the lesson's own section/framing text); every level cites visible sources (lesson sources and/or verified supplements with locators); fixture derives levels from actual stored evidence only.
- Honest stopping: `availableWhyDepth` is pure server-side code over stored content + supplements (deterministic, documented, tested); a request past it gets an exhaustion state ("the sources here are exhausted for this question") with ZERO dispatch and no stored response; the stepper never offers a level it cannot ground.
- Learner control: stop control visible at every depth, keyboard-operable (collapses the stepper; focus choreography per the spine); "Go deeper" is consent-gated by the existing disclosure state; depth unlocks nothing (no tracker, credit, completion or content effects).
- Derivative lineage: why explanations are root derivatives (owner, course version, lesson index, depth; UNIQUE(owner, course, lesson, depth) — one explanation per level; regenerate-after-supersede creates rows on the new version); cascade purge with the course; export gains an honest `why-explanations` skip; responses carry the "AI-generated · Unreviewed" label.
- Restart-safety and idempotency: command envelope + receipt replay; same (course, lesson, depth) request replays the existing explanation instead of dispatching; worker re-fences lineage under the recorded identity; claim-first terminal transitions (the 2.2 patch pattern); stranded-pending self-heal at the honest cap.
- Migration `020` additive; tests unit+integration+browser, zero skips; `docs/project-structure.md` same change; Node v24.22.0, loopback-only, no new dependencies, no live dispatch, no egress.

**Never:**
- No invented causes or fabricated depth; no why-driven unlocking; no second dispatch pipeline (reuse the course-generation job pattern); no instructor surfaces; no cross-lesson synthesis (per-lesson only in this entry).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Go deeper (level 1) | ready course lesson + consent | 202/job → explanation: non-restatement depth (purpose/assumption/trade-off) + visible sources + unreviewed label | — |
| Level 2 | second request | second distinct dimension, sources cited, stepper shows both | — |
| Exhaustion | request past available depth | honest exhaustion state; ZERO dispatch; no row; stepper states it and stops | — |
| Stop control | any depth | always visible, keyboard-operable, collapses stepper with focus choreography | — |
| Replay / duplicate | same command; same (course,lesson,depth) | identical receipt; existing explanation returned; no second dispatch | — |
| Restatement draft | processor returns restatement | markFailed invalid-output honestly; retryable | — |
| Consent / cross-owner / deleted / ungenerated | standard gates | honest blocked/denied states; zero effect | — |
| Purge | root/personal deletion | why rows removed with course lineage; export records the skip | — |
| Legacy content | stored v1–v3 courses | why works on their lessons too (levels derive from their stored evidence) | — |

</frozen-after-approval>

## Code Map

- `src/modules/course-generation/*` — add the why phase beside supplements: request/settle verbs, worker phase, pure depth/availability + parser code (`why.ts` new); queue `WHY_QUEUE` wiring (contracts, adapters/queue, scripts/migrate, worker/main).
- `src/contracts/courses.ts` — why schemas (job, explanation, serving; availability states), export category.
- `migrations/019` (practice precedent) — `020` adds `app.why_explanation` (UNIQUE(owner, course, lesson, depth); CASCADE from course) + lifecycle preview counts.
- `src/modules/lifecycle-platform/derivatives.ts` — counts; purge rides CASCADE.
- `src/modules/setup-export/{manifest,service}.ts` — `why-explanations` skip.
- `src/app/course-stage.tsx` — why-stepper UI per the spine's why-stepper pattern (Go deeper / Stop always visible / depth ladder with sources / exhaustion notice / unreviewed labels; keyboard-complete; polling rules from 2.1–2.3).
- Tests: unit (availability function, restatement rejection, fixture determinism), integration (levels 1–2 grounded, exhaustion zero-dispatch, replay/duplicate/self-heal, denials, purge, export skip, legacy courses), browser (keyboard journey: deeper ×2, exhaustion notice, stop control, label; no outbound).

## Tasks & Acceptance

**Execution:**
- [x] `migrations/020-why-explanations.sql` — table + guards + lifecycle counts.
- [x] `src/modules/course-generation/why.ts` — `availableWhyDepth` (pure, evidence-derived), prompt builder, strict parser (restatement rejection, source citation requirement), fixture completion.
- [x] `src/contracts/courses.ts` + queue wiring — schemas, `WHY_QUEUE`, serving states.
- [x] `src/modules/course-generation/{service,worker,repository}.ts` — `requestWhyStep`/`getWhyState` (availability pre-check BEFORE admission; exhaustion without dispatch), worker phase (claim-first), purge/export.
- [x] `src/app/course-stage.tsx` — why-stepper UI (patterns above).
- [x] Tests per Code Map; `docs/project-structure.md`.

**Acceptance Criteria:**
- Given a fixture lesson, when the learner goes deeper twice, then two successive levels show non-restatement depth (distinct purpose/assumption/trade-off dimensions) each tied to visible sources, labeled unreviewed.
- Given a request past the available evidence, when submitted, then an honest exhaustion state returns with zero dispatch and no stored row, and the stepper stops.
- Given any depth, when studying, then the stop control is visible and keyboard-operable and depth has unlocked nothing.
- Given replay, duplicate delivery, restart or a stranded pending row, then exactly one explanation per (course, lesson, depth).
- Given deletion, when purge runs, then why rows are removed and the export records the skip.

## Implementation Notes

## Plan Change Log

## Review Triage Log

### Quick lens pass (2026-10-27, 4 findings, verified by the orchestrator)

- **high** — the why-stepper's "Retry depth N" button dispatches the first AVAILABLE level, not the failed one: retrying depth 1 dispatches depth 2 (server CONFLICTs on sequencing), and retrying a failed depth with none available silently does nothing; the stepper can also offer "Go deeper (depth 2)" that the server unconditionally refuses. → patch (retry targets its own failed depth; the offered next action is computed from the ladder truth — a failed depth blocks deeper offers until retried, per the server's sequencing fence).
- **medium** — the exhaustion notice renders whenever no level is available/pending, including when a retryable evidence-grounded level merely FAILED — claiming "sources are exhausted / the stop is final" over a processing failure (state-identity dishonesty). → patch (exhaustion notice only when the evidence truly grounds nothing more; failed levels show retry, not exhaustion).
- **medium** — the stop control is disabled while `busy` (the whole dispatch window, up to the 120 s cap), so it is not keyboard-operable at every depth. → patch (stop is a local UI action: never busy-gated; it also cancels the pending poll/wait).
- **medium** — a "Go deeper" that returns the exhaustion verdict re-reads silently: the focused button unmounts, focus falls to body, nothing announces the stop. → patch (focus the exhaustion notice / announce via the live region; keyboard journey covers the path).

Verdict counts: high 1, medium 3, false 0, maybe-false 0. All route to patch.

## Design Notes

- Availability as pure code keeps the zero-dispatch promise structural: the service never admits a why command whose depth exceeds `availableWhyDepth(content, supplements)` — exhaustion is not a worker outcome, it is a precondition.
- Dimension sequencing is fixed (level 1 purpose, level 2 assumptions/trade-offs) so "beyond restatement" is checkable and the fixture's determinism holds across runs.
- Reuse the supplements job shape (one proposal completion per command; zero-token ledger row; claim-first persist) — a why step is a tiny supplement-shaped generation.

## Verification

**Commands:**
- `nvm use && NPM_CONFIG_USERCONFIG=/dev/null NEXT_TELEMETRY_DISABLED=1 npm run migrate` — 020 additive.
- `npm run boundaries && npm run typecheck && npm run typecheck:worker && npm run lint` — green.
- `npm run test && npm run test:integration` — green, zero skips.
- `npm run build && npm run test:e2e` — why journey green; typegen dance; dev state restored.
- Full `npm run checks` at the next wave boundary.

**Manual checks (if no CLI):**
- Keyboard-run: deeper, deeper, exhaustion notice, stop; verify sources and labels at each level.


### Patch round (2026-10-27, orchestrator-completed)

The patch agent was interrupted mid-round (session interruption killed it after the code edits, before verification). The orchestrator verified all four findings were fixed in code (retry targets its own failed depth and the ladder never offers a rung it cannot ground; exhaustion renders only when the evidence truly grounds nothing more — a failed within-evidence level shows retry, never an exhaustion claim; the stop control is never busy-gated and ends the wait immediately; the exhausted verdict moves focus onto the notice with an id-anchored focus path), then completed the interrupted work: the react-hooks compiler rules (purity/refs) rejected the patched handler shape, resolved structurally by making `deepen` fully ref-free and impure-free — per-depth envelopes in state, the pending WAIT (polling, 120-second honest cap, settle focus) owned by a scalar-dep `useEffect`, the stop control collapsing the stepper to end the wait, DOM-id focus choreography — and the dead ref-based wait machinery deleted. A stale production build (the interrupted agent died before rebuilding) caused two browser failures that both pass against the fresh build (26.7s). Post-patch verification: lint clean (113+probes), both typechecks, boundaries, unit 225/225, integration 166/166 (after restarting the interrupted database), browser course suite green including the exhausted-verdict keyboard journey.
