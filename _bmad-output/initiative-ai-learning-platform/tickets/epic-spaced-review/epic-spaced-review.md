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
    _bmad-output/initiative-ai-learning-platform/prd-ai-learning-platform/prd-ai-learning-platform.md,
    _bmad-output/initiative-ai-learning-platform/ux-ai-learning-platform/EXPERIENCE.md,
    _bmad-output/initiative-ai-learning-platform/ux-ai-learning-platform/DESIGN.md,
  ]
after: [epic-private-study-setup, epic-assessment-and-progress]
refined: true
risk: medium
---

# Learners return for controlled spaced review

## Description

Use epic 3's real completion/evidence to schedule review across time, show an in-app due list and consolidate reminders by local day. Learners control interruptions; scheduling/practice never erases earned progress. This is the learner's return journey after study — not a background scheduler alone, and not a claim about memory.

## Outcome

A learner can leave after studying, return to an intelligible due review and adjust reminders without mistaking review due for failure or lost completion.

## Requirements

Parent R15 is this epic's single owned requirement; these local IDs split it into its distinct capabilities under D6/AD-13. They refine, never replace, initiative IDs. `refined: true` means specified for planning, not executed or authorized to start.

- **R1 — Review scheduling heuristic** (parent R15; D6 schedule/adaptation, AD-13): completing a mini-course schedules the first review one day later; each successful unaided review advances to the next of 3, 7, 14, then 30 days, repeating 30-day intervals thereafter, anchored on the actual successful review rather than the completion date. A failed or assisted review offers targeted support and a next-day review, restarting the sequence after the next unaided success; Hard self-report can only bring the next review to the next day — never postpone, award credit or extend an interval. Reviews run on the applicable snapshotted pass mark through epic 3's shared evaluator; assisted, under-review or provisional outcomes never advance the sequence. Verify interval advancement, restart, Hard-forward and verdict snapshotting under a controlled clock.
- **R2 — In-app due list** (parent R15; D6 delivery): a persistent in-app due-review inbox with a nav badge shows each due review by local calendar day with overdue items aggregated, renders honestly when empty, and stays independent of reminder delivery. Verify due rows appear at their due instant and persist across restarts and days with no new reminder created.
- **R3 — Consolidated reminders within an upper bound** (parent R15; D6 delivery, AD-13): at most one new consolidated reminder per local calendar day combines all due/overdue items; unique `(userId, localDate)` plus a minimum 24-hour gap from the last reminder prevents timezone-change bursts; duplicate job execution never re-delivers; delivery rechecks scope, controls and cancellation state before creating anything. No email/SMS/push surface exists or is required. Verify one-per-day behavior across duplicate runs, zone edits and growing overdue lists.
- **R4 — Reminder controls** (parent R15; D6 controls): learners can pause reminders, snooze a review until tomorrow or three days later, disable reminders and resume. Controls change notification timing only — never evidence, due instants or completion — and resume shows the current due list without a backlog burst. Verify every control plus resume under keyboard-only operation.
- **R5 — Timezone and DST correctness** (parent R15; D6 delivery, AD-13): intervals use local-calendar-day addition preserving local wall time — DST gaps shift forward, overlaps choose the earlier occurrence — with the learner's stored IANA timezone from epic 1's settings; a timezone change recomputes due instants from the same anchor, displays the change predictably and never alters evidence or completion. Verify gap/overlap fixtures and zone-change recompute.
- **R6 — Earned-progress preservation** (parent R15; D6, AD-8): review outcomes, overdue states and self-report never revoke or rewrite earned completion, progress or recovery credit, and never write completion awards; review-due/failure states display separately from completion, including the roadmap "Review due" indicator contract consumed by epic 3. Verify a failed or overdue review leaves the completion award intact and distinguishable.
- **R7 — Deletion cancellation and scoped contracts** (parent R15; D5/D6, AD-4): owner/root deletion and enrollment removal immediately cancel future reminders and due-list entries for the affected scope without disturbing other roots; restore replays protective state before any reminder dispatch; course-scoped due/overdue query and cancellation contracts serve epic 5's reporting and enrollment revocation without exposing personal-study evidence. Verify cancellation, race suppression and scope denial.

## Constraints

- Parent C1–C7 and D1–D8 remain binding. D6 is load-bearing here: in-app-only delivery — no external notification provider is selected, integrated or silently required, and no email/SMS/push surface may appear.
- The 1/3/7/14/30-day heuristic is the transparent D6 default: no scientific-optimality claim, no per-learner algorithm tuning, no retention guarantee. Review scheduling stays separate from course completion (D6/D1).
- AD-13's one review clock is authoritative: an injectable server clock with owned controlled-clock and IANA timezone/DST fixtures extending epic 1's lifecycle-clock fixtures. The real seven-day delayed observation stays a D8 initiative-closure check — elapsed pilot time is never fabricated or reported as passed.
- Whole-epic execution gates stand: no entry starts before epic-private-study-setup and epic-assessment-and-progress are done. Cross-epic prerequisites on epic 3's not-yet-refined entries stay at the epic slug until pinned (repointed afterward).
- UX follows the adopted spine's review-inbox patterns (row-scoped snooze naming its target, inbox-wide pause/disable in their own section, honest empty/paused states, focus choreography). The static `/review` product page is a styled shell, not this epic's implementation.

## Done when

1. Completion schedules the one-day initial review; successful unaided reviews advance through 3/7/14/30-day intervals from actual success; failure/assistance and Hard feedback follow D6 without certifying forgetting or modifying completion (R1, R6).
2. In-app due lists and at most one consolidated new reminder per local day work across timezone changes, DST boundaries, overdue aggregation and duplicate job execution; no email/SMS/push service is silently required (R2, R3, R5).
3. Pause, tomorrow/three-day snooze, disable/resume and owner deletion behave correctly without backlog bursts or hidden progress changes. Course-scoped due/cancellation contracts for epic 5 enrollment revocation and reports are delivered and exercised by synthetic consumer tests (R4, R7).
4. With a controlled-clock integrated test and an actual return smoke check, verify integrated learning → review behavior in the authorized production deployment; every entry has passing evidence. The real seven-day pilot remains a later initiative closure check, not fabricated elapsed time.

## Boundaries

- Owns review scheduling, due states and in-app notification preferences/aggregation; consumes epic 1 user/timezone/deletion controls and epic 3 completion/mark/unaided-evidence contracts.
- Owns controlled-clock fixtures for scheduling; epic 5 integrates real enrollment-removal cancellation and course-scoped reporting before instructor use.
- Does not recalculate completion from review outcomes, treat confidence as demonstrated recall, select an external notification provider or claim the initial interval heuristic is scientifically optimal.

## References

- parent — [initiative requirements](../../initiative-ai-learning-platform.md), R15; Constraints C1–C7 and G1/G2.
- policy companion — [product policies](../../product-policies.md), D6 in full; D3/D5/D7/D8 where cited above.
- architecture companion — [shared technical architecture](../../architecture-shared-technical/architecture-shared-technical.md), all AD-1–AD-18; especially AD-3/AD-4, AD-7–AD-9, AD-13/AD-14 and AD-17 for scoped review verdicts, clock/reminders and restore safety.
- PRD companion (adopted) — [consolidated PRD](../../prd-ai-learning-platform/prd-ai-learning-platform.md), §4.4 FR-15 and its consequences, §8 guardrails (in-app-only reminders) and SM-1/SM-C3.
- UX companions (adopted) — [experience spine](../../ux-ai-learning-platform/EXPERIENCE.md), review-inbox row, reminder/paused/overdue/empty state patterns and interaction/accessibility floor; [visual identity](../../ux-ai-learning-platform/DESIGN.md), Fieldnotes tokens.
- delivery breakdown — [review prerequisite and consumer contracts](../tickets.toml), epic 4 and its epics 1/3 dependencies.
- story breakdown — [ordered entries](tickets/tickets.toml), local R1–R7 coverage, dependencies, human steps and start-blocking unknowns.

## Notes

- Decision: 2026-10-21 — review is an early-usable return journey after completion, not merely a background scheduler task.
- Waits on epic-private-study-setup because: preferences, owner controls and deletion must cancel future use/reminders.
- Waits on epic-assessment-and-progress because: review needs versioned completion and separate unaided performance without modifying earned progress.
- Decision: 2026-10-21 — adopt shared review-policy snapshot, calendar/DST, idempotency and reminder upper-bound contracts; keep whole-epic prerequisites and unrefined state.
- Open question: 2026-10-21 — refine corresponding UI states and controlled-clock tests under AD-13; actual scheduler/restore/performance evidence remains required before acceptance, not inferred from architecture finalization. The planning half is settled by this refinement (UX spine adopted; controlled-clock fixtures owned below); the evidence half stays open until the entries run.
- Decision: 2026-10-24 — refined and sliced under the user's standing delegation to finish the remaining epics. This relaxes only the refine-after-predecessor planning order; the 2026-10-21 whole-epic execution gates stand, and starting any entry needs its own authorization.
- Decision: 2026-10-24 — tracer bullet is entry 1 "Completed-course-to-first-review tracer": the thinnest full path from epic 3's completion evidence through a one-day first review schedule to a due row in the in-app inbox, crossing web UI, contracts, module, worker job, adapters and one migration with an injectable clock. It proves the completion→schedule→due-list spine before verdicts, reminders, controls or lifecycle work.
- Decision: 2026-10-24 — nine entries in one ordered lane (a smaller epic; no padding): adaptive review session after the tracer, then calendar/DST semantics, reminder aggregation, controls, scoped contracts, lifecycle integration, Refactor sweep and the closing integrated suite. Shared schedule/clock/control surfaces make one lane safer than parallel lanes; the scoped-contract story precedes lifecycle integration so epic 5's consumers get a stable surface.
- Assumption: epic 3's provider references stayed at the whole-epic string "epic-assessment-and-progress" while that epic was refined in parallel; no entry ids were invented here. Repointed 2026-10-24 (same day, after parallel refinement) to 3.4 (completion award) on entry 1, 3.3 + 3.8 (snapshotted scoring/pass-mark and the shared-evaluator handoff surface) on entry 2, and the roadmap indicator on entry 6 staying with the roadmap surface it consumes.
- Assumption: in-app badge + due list are the only reminder surfaces (D6); no external notification provider is evaluated, selected or required by any story.
- Assumption: Easy/Unsure/Hard self-report is captured in the review session through the shared typed evidence contract; Hard only brings review forward, and self-report never postpones a due review or awards credit (D2/D6).
- Assumption: enrollment-removal cancellation is delivered as a contract plus synthetic fixture here; real enrollment records and their revocation integration belong to epic 5, which calls the hook before instructor use.
- Assumption: epic 1's built retention scheduler (lifecycle-platform) and timezone preference are extended, not duplicated; this epic adds the Review module and its fixtures against the same jobs/clock conventions.
- Open question: deployment/return-smoke authorization — actual provisioning/deployment scope, region/plan/budget and operator responsibilities for the closing suite need separate approval and verification (the same family as epic 1 S12's F6); recorded as the closing entry's `unknown`. No other entry carries a start-blocking unknown: review needs no live AI and no new external service.
