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
  ]
after: [epic-private-study-setup, epic-grounded-mini-courses]
refined: false
risk: high
---

# Learners pass tests and recover targeted gaps

## Description

Add valid scored attempts, evidence-linked next-study guidance, focused review/reassessment and whole-mini-course roadmap progress to epic 2's real lessons. Preserve passed sections and versioned results rather than award completion from reading, confidence or an invented replacement score.

## Outcome

A learner sees why an objective needs attention, can recover a failed requirement through focused reassessment, and completes a mini-course only under the content-plus-tests rule.

## Done when

1. Required content/activity completion and normal test passing produce version-scoped mini-course/parent progress; missing work, unattempted tests and provisional/failed grades do not. Roadmap nodes are whole mini-courses with separate practice/review indicators and no hard locks.
2. Default 80% thresholds, applicable mark snapshots, unrounded boundaries, disclosed rubric/partial credit, version changes and result history follow D3. An ordinary passing test may contain wrong answers; policy edits or invalid-item findings do not revoke earned completion.
3. Failed question → evidence-linked review → fresh comparable targeted retest works for success, failure and partial/unassessed target coverage, preserving passed sections and original scores. Unknown, assisted and self-reported evidence remain distinct; invalid questions follow pending-versus-earned correction rules.
4. Completion/evidence outputs, ownership/export/deletion and repeated-submit/resource-delay paths are integrated. Once authorized, production verification exercises both normal and recovered completion plus denied cross-owner access; these are formative results, not certified grades.

## Boundaries

- Owns scoring/rubric/attempt snapshots, completion and gap guidance, targeted credit/correction, and roadmap progress. Consumes epic 1 ownership/plan/lifecycle and epic 2 objective/source/practice contracts.
- Supplies versioned completion, applicable mark and unaided-performance handoffs to epic 4; supplies published required-outcome, provisional subjective-grade and evidence/reporting contracts for epic 5; supplies activity/rubric/completion contracts to epic 6.
- Epic 5 adds instructor-controlled pass marks, subjective confirmation and exact-version approval before that mode is exposed. No instructor content route is enabled by this personal-study release.
- No perfect-score requirement, retroactive progress erasure, claim of permanent mastery, unchanged question relabeled as a fresh retest, or generation quota counted as a learning failure.

## References

- parent — [initiative requirements](../../initiative-ai-learning-platform.md), R10/R13/R14/R20; Constraints C1–C7 and G1/G2.
- policy companion — [product policies](../../product-policies.md), D1/D2/D3/D4/D7; D6 completion-versus-review separation.
- architecture companion — [shared technical architecture](../../architecture-shared-technical/architecture-shared-technical.md), all AD-1–AD-18; especially AD-2–AD-8 and AD-13 for pinned scoring, parent/child awards, targeted credit and review verdict handoff.
- delivery breakdown — [prerequisite and handoff contracts](../tickets.toml), epic 3, consuming epics 1/2 and supplying later integrations.

## Notes

- Decision: 2026-10-21 — tests/recovery and visible progress are one coupled deployable outcome, not separate grading-service and roadmap-UI epics.
- Waits on epic-private-study-setup because: attempt evidence/plan state must obey owner and lifecycle contracts.
- Waits on epic-grounded-mini-courses because: valid assessments/recovery require actual source-backed versioned objectives and learning units.
- Decision: 2026-10-21 — adopt shared evidence, exact scoring/recovery and monotonic completion contracts; keep whole-epic dependencies and unrefined state.
- Open question: settle relevant UX and checked reference rubrics during refinement; implement/test the shared contracts before acceptance. Blueprint checks are not proof of psychometric equivalence or functioning scoring.
