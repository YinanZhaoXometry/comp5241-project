---
type: epic
title: Learners study source-backed personalized mini-courses
parent: initiative-ai-learning-platform
covers: [R1, R6, R8, R11, R12]
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
    _bmad-output/initiative-ai-learning-platform/tickets/epic-grounded-mini-courses/delivery-checks.md,
  ]
after: [epic-private-study-setup]
refined: true
risk: high
---

# Learners study source-backed personalized mini-courses

## Description

Turn epic 1's confirmed private material/plan into versioned, personalized lessons and retrieval activities. Supplement missing explanations with checked sources, make conflicts/uncertainty visible and support successive learner-controlled why exploration. This is the personal-study route; no instructor publishing shortcut is introduced.

## Outcome

A learner can study a suitable mini-course, attempt active recall and inspect the evidence behind a deeper explanation rather than receive an unsupported summary.

## Requirements

Each line carries its parent requirement's words at this epic's altitude; `covers` and each line's parenthetical resolve to the parent ids. The PRD companion's consolidated consequences and the UX spine's patterns bind the stories through References.

- **R1 — Generated mini-course from a confirmed plan** (parent R1): epic 1 delivers upload/extraction/setup through the confirmed plan; this epic delivers "obtain a mini-course": a confirmed plan generates a versioned, source-linked mini-course whose lessons show visible source locations, AI-generated/unreviewed labels and honest pending/failure states on restart-safe jobs. Verify a confirmed-plan → generated-course → study path plus failed/oversized/slow generation honesty — by 120 seconds the state is complete, honest pending, or a retryable failure with saved input; timeout never means success.
- **R2 — Supplement missing explanations** (parent R6): where uploads lack a necessary explanation, supplement with identified, claim-supporting external sources. Source identity and location are visible; uploads and supplements are distinguishable; conflicting claims are displayed side by side and never silently rewritten; unsupported answers stop short of an authoritative answer and generate no scored item; an AI-generated citation is not verification.
- **R3 — Background and goal adaptation** (parent R8): tailor explanations and support to different backgrounds/goals while preserving factual correctness. Verify suitable side-by-side treatment of the same objective for a non-CS beginner and a CS graduate without learner edits weakening requirements; personal-study generated lessons/explanations carry unreviewed labels, visible sources and an error-report path.
- **R4 — Deeper why exploration** (parent R11): learners can successively request deeper explanations and stop at any depth. Deeper levels address purpose, assumptions or trade-offs beyond restatement with visible sources; when evidence is exhausted the interface states that honestly and stops rather than inventing causes.
- **R5 — Active recall** (parent R12): practice tasks withhold their answer until the learner attempts retrieval, followed by feedback. Verify attempt-before-answer behavior rather than rereading alone, on scored attempts and keyboard-only runs alike.

## Done when

1. One private material → confirmed plan → generated mini-course → lesson/recall path works, including factual adaptation of the same objective for non-CS and CS backgrounds.
2. A missing explanation receives a clearly attributed supplement with supporting source location; conflicting or insufficient evidence remains visible, and deeper why requests stop honestly when support runs out.
3. Retrieval tasks withhold their answer until the attempt; learner control of depth, extraction/generation errors, consent denial and descendant export/deletion are integrated and checked. Record source/version/objective provenance for downstream assessment.
4. Once authorized, deploy the slice into the same production system and verify the integrated private-study and denial/error paths with checked fixtures. Unreviewed AI output is labeled; fixture checks do not establish general correctness or efficacy.

## Boundaries

- Owns full course generation, versioned source-linked learning units/objectives, personalization, supplementation, active recall and learner-controlled deeper explanation; consumes epic 1 private extraction/plan/consent/lifecycle controls.
- Hands versioned objectives, source evidence and practice units to epic 3 assessment/recovery, epic 5 versioned instructor authoring and epic 6 activity/domain extensions.
- Scored completion, retest credit and roadmap states belong to epic 3. New instructor-mode lessons/why responses will remain subject to epic 5 approval; this personal route cannot expose instructor drafts.
- No fabricated citations, unexplained replacement of uploads, certain-cause diagnosis, guaranteed optimal course or data sent without consent.
- Activity-family interaction design (simulation, role play/mock interview, mini-game, narrated animation/slides, online coding) stays deferred to epic-subject-and-activity-breadth; this epic's player implements only the lesson shell, content-item tracker, honest-unavailable state and media floor the UX spine bequeaths, and claims no per-family contract.
- Touch point: bounded external source retrieval for attributed supplements — first introduced and owned here; live fetch needs its own feasibility evidence and authorization and is never a general browsing/proxy surface.

## References

- parent — [initiative requirements](../../initiative-ai-learning-platform.md), R1/R6/R8/R11/R12; Constraints C1–C7 and G1/G2.
- policy companion — [product policies](../../product-policies.md), D2/D4/D5/D7, with D1/D3 downstream evidence boundaries.
- architecture companion — [shared technical architecture](../../architecture-shared-technical/architecture-shared-technical.md), all AD-1–AD-18; especially AD-4–AD-7 and AD-9–AD-12 for lineage, confirmed plan, source/approval and provider boundaries.
- PRD companion (adopted) — [consolidated PRD](../../prd-ai-learning-platform/prd-ai-learning-platform.md), §4.2 consequences for FR-6/8/11/12 and the FR-1 generation leg, §8 guardrails and §9 NFRs.
- UX companions (adopted) — [experience spine](../../ux-ai-learning-platform/EXPERIENCE.md), player/practice/why surfaces, recall-card, why-stepper and feedback-block patterns, state patterns and interaction/accessibility floor; [visual identity](../../ux-ai-learning-platform/DESIGN.md), Fieldnotes tokens.
- delivery companion — [story contracts and feasibility gates](delivery-checks.md), S1–S10 and F-A/F-B/F-C.
- delivery breakdown — [ordered stories](tickets/tickets.toml).

## Notes

- Decision: 2026-10-21 — private source-grounded study is the next early-usable outcome after confirmed setup; no mock lesson stands in for generation.
- Waits on epic-private-study-setup because: generation requires authenticated material/extraction, confirmed plan, consent and derivative lifecycle enforcement.
- Decision: 2026-10-21 — adopt shared AD contracts rather than select parallel provenance/content/fetch rules; retain the earlier whole-epic prerequisite and unrefined state.
- Decision: 2026-10-23 — at the user's direction this epic is refined and sliced ahead of epic-private-study-setup's completion. This relaxes only the refine-after-epic-1 planning order; the 2026-10-21 whole-epic execution gate stands — no story starts before epic 1 completes, and starting work needs its own authorization.
- Decision: 2026-10-23 — adopt the final product-wide UX spine (EXPERIENCE.md/DESIGN.md) and the consolidated PRD as companions; the spine's deferral of activity-family interaction design to epic 6 is honored (Boundaries).
- Decision: 2026-10-23 — tracer bullet is entry 1 "Confirmed-plan-to-generated-course tracer": the thinnest confirmed-plan → generated source-linked mini-course → lesson/recall path through web, contracts, modules, worker and adapters, leading with the riskiest path (generation with attributed sources). Sequencing: bounded source retrieval (least certain) second; player, adaptation, recall, why, provenance handoff and lifecycle integration follow in one ordered lane; refactor sweep and the integrated suite close.
- Decision: 2026-10-26 — the owner authorized the epic-2 build kickoff ("implement and kick off Epic 2", parallel agent sessions). Epic-1 closure (2026-10-25; 1.14 dropped-deferred by owner decision) satisfies the whole-epic gate. Start scope is local synthetic-fixture implementation under the standing constraints — no external dispatch, loopback only, no deployment — which settles and removes the start-blocking `unknown` on entries 1 and 2. F-A and F-B remain the live gates in delivery-checks: live generation needs a purpose-scoped (v5) processor configuration admitted by the owner through the S6 owner-admission record pattern (v4's consented purpose covers setup assistance only), under ai-live.ts destination enforcement and budget cap; live source fetch needs F-B feasibility evidence and authorization. Entry 10's F-C deployment `unknown` stands.
- Decision: 2026-10-26 — kickoff waves for the parallel sessions: entry 1 alone first (every other entry waits on the tracer); entry 2 next; entries 3 and 4 then form the first parallel pair (both touch the generation surface — serialize merges, rebase before each merge). Later waves re-derive from `after` at their kickoff.
- Open question: F-C deployment authorization stays `unknown` on entry 10 until release verification is authorized; it blocks deployment only, not synthetic-fixture work.
