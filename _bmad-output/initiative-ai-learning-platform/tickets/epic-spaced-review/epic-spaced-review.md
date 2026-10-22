---
type: epic
title: Learners return for controlled spaced review
parent: initiative-ai-learning-platform
covers: [R15]
sources:
  [
    _bmad-output/initiative-ai-learning-platform/initiative-ai-learning-platform.md,
  ]
companions:
  [
    _bmad-output/initiative-ai-learning-platform/product-policies.md,
    _bmad-output/initiative-ai-learning-platform/architecture-shared-technical/architecture-shared-technical.md,
  ]
after: [epic-private-study-setup, epic-assessment-and-progress]
refined: false
risk: medium
---

# Learners return for controlled spaced review

## Description

Use epic 3's real completion/evidence to schedule review across time, show an in-app due list and consolidate reminders by local day. Learners control interruptions; scheduling/practice never erases earned progress.

## Outcome

A learner can leave after studying, return to an intelligible due review and adjust reminders without mistaking review due for failure or lost completion.

## Done when

1. Completion schedules the one-day initial review; successful unaided reviews advance through 3/7/14/30-day intervals from actual success. Failure/assistance and Hard feedback follow D6 without certifying forgetting or modifying completion.
2. In-app due lists and at most one consolidated new reminder per local day work across timezone changes, overdue aggregation and duplicate execution; no email/SMS/push service is silently required.
3. Pause, tomorrow/three-day snooze, disable/resume and owner deletion behave correctly without backlog bursts or hidden progress changes. Provide course-scoped due/cancellation contracts for epic 5 enrollment revocation and reports.
4. With a controlled-clock test and an actual return smoke check, verify integrated learning → review behavior in the authorized production deployment. The real seven-day pilot remains a later initiative closure check, not fabricated elapsed time.

## Boundaries

- Owns review scheduling, due states and in-app notification preferences/aggregation; consumes epic 1 user/timezone/deletion controls and epic 3 completion/mark/unaided-evidence contracts.
- Owns controlled-clock fixtures for scheduling; epic 5 integrates real enrollment-removal cancellation and course-scoped reporting before instructor use.
- Does not recalculate completion from review outcomes, treat confidence as demonstrated recall, select an external notification provider or claim the initial interval heuristic is scientifically optimal.

## References

- parent — [initiative requirements](../../initiative-ai-learning-platform.md), R15; Constraints C1–C7 and G1/G2.
- policy companion — [product policies](../../product-policies.md), D3/D5/D6/D7/D8.
- architecture companion — [shared technical architecture](../../architecture-shared-technical/architecture-shared-technical.md), all AD-1–AD-18; especially AD-3/AD-4, AD-7–AD-9, AD-13/AD-14 and AD-17 for scoped review verdicts, clock/reminders and restore safety.
- delivery breakdown — [review prerequisite and consumer contracts](../tickets.toml), epic 4 and its epics 1/3 dependencies.

## Notes

- Decision: 2026-10-21 — review is an early-usable return journey after completion, not merely a background scheduler task.
- Waits on epic-private-study-setup because: preferences, owner controls and deletion must cancel future use/reminders.
- Waits on epic-assessment-and-progress because: review needs versioned completion and separate unaided performance without modifying earned progress.
- Decision: 2026-10-21 — adopt shared review-policy snapshot, calendar/DST, idempotency and reminder upper-bound contracts; keep whole-epic prerequisites and unrefined state.
- Open question: refine corresponding UI states and controlled-clock tests under AD-13; actual scheduler/restore/performance evidence remains required before acceptance, not inferred from architecture finalization.
