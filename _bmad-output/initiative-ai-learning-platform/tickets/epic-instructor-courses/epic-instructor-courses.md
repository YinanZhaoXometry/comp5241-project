---
type: epic
title: Instructors publish approved courses to enrolled learners
parent: initiative-ai-learning-platform
covers: [R3, R4, R5, R16]
sources: [_bmad-output/initiative-ai-learning-platform/initiative-ai-learning-platform.md]
companions: [_bmad-output/initiative-ai-learning-platform/product-policies.md, _bmad-output/initiative-ai-learning-platform/architecture-shared-technical/architecture-shared-technical.md]
after: [epic-private-study-setup, epic-grounded-mini-courses, epic-assessment-and-progress, epic-spaced-review]
refined: false
risk: high
---

# Instructors publish approved courses to enrolled learners

## Description

Deliver instructor-managed learning as one integrated boundary: author/edit manually or with AI, personally approve exact versions, import/manage verified enrollment and inspect scoped participation. Apply the existing learning, assessment, review and lifecycle contracts without weakening private-study boundaries.

## Outcome

An instructor can provide and oversee an approved mini-course for their enrolled students; students cannot use unseen AI variants, and instructors cannot browse personal uploads.

## Done when

1. Instructor upload/topic/requirements → manual or AI creation/edit → personal version approval → enrolled student study works. Published versions and attempt/rubric/mark snapshots remain stable; required outcomes remain instructor-controlled.
2. Name/email CSV preview, row errors, deduplication, verified invitation and enrollment removal are demonstrable. Non-enrolled/cross-course accounts are denied; removal ends future access and course reminders while permitted learner history export does not expose restricted content.
3. Exact-version AI lessons/sources/question-answer-rubric-feedback bundles and deeper why variants require actual approval; approved-bank retests work and fresh variants wait. Edited dependencies and withdrawn errors follow D4/D3 without unseen-output permission or retroactive loss of earned progress; subjective AI grades remain provisional until instructor confirmation.
4. Scoped progress/participation/pass/recovery/review reports, instructor-record archive notice/export/deletion, private-upload denial and role audit controls work together. Labels distinguish activity/estimated time from mastery and private study from instructor evidence.
5. Deploy the complete authorized instructor route to production only after the earlier privacy/version/review integrations pass; run enrolled, revoked, unapproved, cross-owner and cross-course end-to-end checks with role test accounts. Test accounts are not additional pilot participants or real instructor-usability evidence.

## Boundaries

- Owns instructor authoring/publication/approval, CSV enrollment and scoped reporting, plus integration of course lifecycle and review cancellation. These are coupled into one safe instructor-mode release; do not expose a partially protected authoring/student route.
- Consumes epic 1 authenticated roles/consent/ownership/retention, epic 2 versioned source-linked teaching, epic 3 assessment/evidence/provisional-grade contracts and epic 4 due/reminder cancellation contracts.
- Supplies the restricted instructor authoring/approval shell to epic 6 required-subject/activity demonstrations. Personal-study generation does not inherit enrollment/approval requirements.
- No public course directory, self-promotion to instructor, bypass for generated retests/why/feedback, roster exposure to learners/AI providers, or instructor access to private learner materials.

## References

- parent — [initiative requirements](../../initiative-ai-learning-platform.md), R3/R4/R5/R16; integration duties under R2/R6/R8/R13–R15/R22; Constraints C1–C7 and G1/G2. Integration references do not duplicate requirement ownership.
- policy companion — [product policies](../../product-policies.md), D1–D7, especially D3 provisional grades, D4 exact-version approval, D5 enrollment/retention and D6 reporting.
- architecture companion — [shared technical architecture](../../architecture-shared-technical/architecture-shared-technical.md), all AD-1–AD-18; especially AD-3–AD-8, AD-13/AD-14 and AD-17 for subject/action authorization, exact approvals and retained-history/restore rules.
- delivery breakdown — [instructor prerequisite and consumer contracts](../tickets.toml), epic 5 and epics 1–4 dependencies.

## Notes

- Decision: 2026-10-21 — enrollment and approval/reporting ship with authoring because publishing without those controls would violate the agreed scope.
- Waits on epic-private-study-setup because: course ownership/roles/consent/export/archive must extend rather than bypass personal-data controls.
- Waits on epic-grounded-mini-courses because: drafts/publications need source-linked versioned lessons and explanations.
- Waits on epic-assessment-and-progress because: instructor grades, pass marks, retests and reports require stable attempts/evidence/completion semantics.
- Waits on epic-spaced-review because: reports and immediate enrollment revocation require course-scoped due/cancellation behavior.
- Decision: 2026-10-21 — adopt shared role/enrollment/subject, publication/approval and report/lifecycle contracts; keep whole-epic prerequisites and unrefined state.
- Open question: refine relevant UX and prove institution/provider retention compatibility plus denied/revoked/unapproved paths before real student data. Shared architecture is not permission to activate a partially protected instructor route.