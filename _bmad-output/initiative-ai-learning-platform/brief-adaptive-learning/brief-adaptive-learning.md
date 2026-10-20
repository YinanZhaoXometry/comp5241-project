---
title: Adaptive Learning Platform — Product Brief
status: approved
created: 2026-10-19
updated: 2026-10-20
approved: 2026-10-20
---

# Product Brief: Adaptive Learning Platform

> Approved by the user on 2026-10-20 as the basis for requirements planning. The title is descriptive, not approved branding. Explicitly unapproved proposals and open decisions remain unresolved; approval does not authorize implementation or establish product–market fit.

## Product and intended value

A **web-first, GenAI-powered learning platform** that creates mini-courses suited to a learner's goal and background, identifies knowledge needing attention, and supports deeper understanding and retention. It should help learners decide what to study next and why—not merely summarize uploaded files.

The learning core combines targeted practice, successive “why?” explanations, **active recall** (attempting an answer before seeing it), and **spaced repetition with reminders**. These are intended mechanisms, not measured product outcomes. A “best course” is an aspiration, not a guarantee.

Software development and engineering are the main domain, with other-domain generation and self-learning paths retained. Learners include non-CS beginners and CS graduates; adaptation changes explanations and support, not factual correctness. Studying a course and preparing for an exam are use situations, not settled market segments.

## Content, access and instructor control

- **Personal study:** learners upload materials to study from them. Those uploads are visible only to the uploading learner, not instructors or other learners.
- **Instructor courses:** instructors upload or edit materials, create and customize mini-courses manually or with AI, import students, and track participation/engagement. Courses are accessible only to students enrolled in that instructor's course.
- **Approval:** instructors personally approve AI-generated lessons, tests and supplementary sources before students use them.
- **Missing explanations:** if uploaded materials do not explain a necessary concept, the platform should supplement them with clearly identified external sources. Instructor-course additions remain subject to instructor approval.

## Learning experience and progress

The user has specified the following direction; the roadmap and retention-feedback features remain user proposals:

1. **Keep setup short:** after upload, offer goal choices such as exam preparation, personal interest, or gaining a grasp of related topics. Ask only critical follow-ups; do not require long written descriptions unless necessary. The final options are not fixed.
2. **Make the path visible:** after goal selection, show current status and unfinished learning nodes through a roadmap resembling a game skill tree. Node size and navigation restrictions remain open.
3. **Teach for understanding:** tailor mini-lessons and activities to the learner, identify gaps, and support deeper “why?” exploration. Learners may report perceived retention; its influence on the plan is undecided.
4. **Require learning and tests for completion:** a course is completed only after its content is finished and all related tests are passed. Reading alone is insufficient; pass thresholds and mapping this rule to smaller nodes remain open.
5. **Recover from failed tests:** examine failed questions, identify knowledge needing support, offer focused review, then offer a new test tailored to that knowledge. Retry policies and how targeted reassessment satisfies the original test remain open.
6. **Return for review:** schedule spaced review with reminders. Channels, cadence, controls and adaptation rules remain undecided.

## Design proposals—not yet approved

- Suggest topics from uploads for confirmation and offer an editable course plan. A short starting check, including whether it is optional, is still a coach recommendation.
- Use evidence to explain priorities and adapt practice/review. Keep self-reported confidence separate from demonstrated performance; unassessed concepts are not automatically weak. Wrong answers do not establish an exact cause, and course completion does not prove lasting retention.
- Ground deeper explanations in sources, assumptions and trade-offs, acknowledging uncertainty rather than inventing one ultimate “root.” Fresh reassessment questions should test understanding rather than memorized answers.

## Initial validation and evidence limits

The user will be the sole initial participant. Broader audience/problem and current-alternative discovery is deferred to a later iteration. **No learning material is needed to approve this brief:** choose the pilot material, goal and journey before validation, not now.

**Proposed pilot:** record a brief baseline, try a bounded learning unit and its recovery flow, then check fresh recall/application after a delay and test the reminder. Track usability friction, source/content errors and assessment quality. The [detailed plan](addendum.md#one-user-validation--confirmed-scope-and-proposed-plan) is unapproved and unexecuted; baseline testing is not mandatory product onboarding. One self-test cannot establish causal effectiveness or product–market fit. The light alternatives scan establishes no unique feature advantage.

## Course obligations and decisions for later

The [authoritative project overview](../../../project-overview.md) retains software-engineering fundamentals, effective AI coding-agent use, and soft/product skills; text/images, simulations, role play/mock interviews, mini-games, AI-narrated animations/slides, and online coding. A focused pilot does not remove these obligations. The final presentation must explain Delegation, Description, Discernment and Diligence; product-level 4D assessment is not an additional mandate.

Downstream requirements must settle source verification/conflicts, data processing/retention/deletion, approval versioning and roles, upload formats, assessment rules, reminder behavior and roadmap details. No stack, pricing or buyer is selected. These open decisions do not require another discovery interview before reviewing this brief.

**Supporting material:** the [addendum](addendum.md) preserves audience contexts, proposals, alternatives and the sourced TCP example; the [discovery log](.memlog.md) records decisions. Earlier mission-centered [brainstorming](../brainstorm-product-market-fit/.memlog.md) remains exploratory, not the approved product center.