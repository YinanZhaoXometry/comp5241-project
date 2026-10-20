---
type: epic
title: Learners study source-backed personalized mini-courses
parent: initiative-ai-learning-platform
covers: [R1, R6, R8, R11, R12]
sources: [_bmad-output/initiative-ai-learning-platform/initiative-ai-learning-platform.md]
companions: [_bmad-output/initiative-ai-learning-platform/product-policies.md, _bmad-output/initiative-ai-learning-platform/architecture-shared-technical/architecture-shared-technical.md]
after: [epic-private-study-setup]
refined: false
risk: high
---

# Learners study source-backed personalized mini-courses

## Description

Turn epic 1's confirmed private material/plan into versioned, personalized lessons and retrieval activities. Supplement missing explanations with checked sources, make conflicts/uncertainty visible and support successive learner-controlled why exploration. This is the personal-study route; no instructor publishing shortcut is introduced.

## Outcome

A learner can study a suitable mini-course, attempt active recall and inspect the evidence behind a deeper explanation rather than receive an unsupported summary.

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

## References

- parent — [initiative requirements](../../initiative-ai-learning-platform.md), R1/R6/R8/R11/R12; Constraints C1–C7 and G1/G2.
- policy companion — [product policies](../../product-policies.md), D2/D4/D5/D7, with D1/D3 downstream evidence boundaries.
- architecture companion — [shared technical architecture](../../architecture-shared-technical/architecture-shared-technical.md), all AD-1–AD-18; especially AD-4–AD-7 and AD-9–AD-12 for lineage, confirmed plan, source/approval and provider boundaries.
- delivery breakdown — [prerequisite and handoff contracts](../tickets.toml), epic 2 and its dependency on epic 1.

## Notes

- Decision: 2026-10-21 — private source-grounded study is the next early-usable outcome after confirmed setup; no mock lesson stands in for generation.
- Waits on epic-private-study-setup because: generation requires authenticated material/extraction, confirmed plan, consent and derivative lifecycle enforcement.
- Decision: 2026-10-21 — adopt shared AD contracts rather than select parallel provenance/content/fetch rules; retain the earlier whole-epic prerequisite and unrefined state.
- Open question: settle relevant UX during refinement; spine G2/G3 require actual eligible model/terms, bounded fetch/extraction and source-support evidence before live processing. Architecture selection is not provider activation or a correctness guarantee.