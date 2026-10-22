---
title: Brief ↔ PRD Reconciliation
status: draft
created: 2026-10-21
---

# Reconciliation: approved brief + discovery addendum vs drafted PRD

**Inputs reconciled:**

- `../brief-adaptive-learning/brief-adaptive-learning.md` — frontmatter `status: approved`, `approved: 2026-10-20`; "approval does not authorize implementation or establish product–market fit."
- `../brief-adaptive-learning/addendum.md` — frontmatter `status: draft`; separates user decisions from coach proposals; "not an approved implementation specification."
- `prd-ai-learning-platform.md` (status: draft, 2026-10-21) + `addendum.md` (same folder).

**Framing:** the PRD explicitly consolidates later-settled sources (initiative R1–R22, product-policies D1–D8 "delegated defaults selected 2026-10-21 under the user's standing delegation", architecture AD-1–AD-18). Items the brief left open and the PRD fixes **via a cited D-policy** are therefore classified here as *resolved by delegation* (provenance to verify in the policies run), not as misrepresentation — except where the PRD converts a brief "not yet approved" into a *permanent exclusion* or asserts something the brief explicitly forbade claiming. Companion files referenced by the PRD (`initiative-ai-learning-platform.md`, `product-policies.md`, `architecture-shared-technical/`, `tickets/`) exist.

---

## 1. Qualitative ideas the FR structure silently drops

1. **The game-skill-tree / knowledge-map visual metaphor is gone.** Brief (user proposal): "show current status and unfinished learning nodes through a roadmap **resembling a game skill tree**"; brief-addendum audience table promises "a **visible knowledge map**" for course-study. The PRD's FR-20 / glossary reduce this to "the whole-mini-course status marker: Not started / In progress / Completed, with separate 'Needs practice' and 'Review due' indicators." Functionally equivalent evidence, but the intended *feel* — a visual, exploratory, game-like map of unfinished nodes — never appears in the PRD (no occurrence of "skill tree" or "knowledge map"). Downstream UX work has no anchor for the metaphor the user actually proposed.
2. **"Best course" as testable quality criteria is dropped.** Brief-addendum: "'Best course' should become testable criteria rather than a guarantee: alignment to the learner's goal, factual/source reliability, suitable prerequisites and effort, and evidence of later recall/application." (Coach proposal, pending.) The PRD keeps only the negative half (no efficacy claims, C5/C6) and never defines course-quality criteria; SM-1–SM-4 are workflow/boundary metrics, not course-quality acceptance. The positive quality bar a PRD could hand to UX/content design is lost.
3. **Plan-preview rationale element dropped.** Brief-addendum step 4 requires the proposed plan to show "**why this route fits the stated goal**" alongside outcomes/prerequisites/lessons/practice/effort/source coverage. PRD FR-21 and the "Confirmed plan" glossary entry list every element *except* the why-this-fits-your-goal rationale. The explainability tone of the plan moment is thinned.
4. **"Offer"-tone of recovery partially hardened.** Brief-addendum: "The wording establishes **offers** of review and reassessment, not mandatory participation." FR-14 preserves learner-initiated flow but UJ-2/SM framing reads as an automatic pipeline; the softer coaching tone survives only implicitly. (Minor; mechanism is intact.)

## 2. Brief requirements / user decisions not represented, or represented differently

**Verified fully represented** (no action): private-upload visibility (FR-2); enrolled-only instructor courses + personal approval before student use (FR-4/FR-5); supplementation with clearly identified external sources, never silent replacement (FR-6); selection-first setup, no long written descriptions, "Other" escape hatch (FR-7/C2); editable/confirmable plan before full generation and topic confirmation (FR-21); active recall before answers (FR-12); completion = all content + all tests passed, both necessary (FR-13); four-step targeted recovery with fresh questions testing understanding not memorized answers (FR-14); evidence separation, Unknown ≠ Weak, no certain-cause diagnosis (FR-10/D2); "why?" grounded in purpose/assumptions/trade-offs, admit uncertainty, no invented ultimate root (FR-11); web-first (C1); three subject areas, six format families, other-domain/self-directed generation, 4D presentation with "product-level 4D assessment is not an additional mandate" (FR-9/17/18/19 + Non-Goals); no PMF/efficacy claims from one participant (C5, §7 counter-metrics); no pricing/buyer (Non-Goals); "every lesson need not use every format" (FR-17); TCP example not the pilot (addendum §F); "best course is an aspiration, not a guarantee" survives as §1's bounded-claim paragraph.

**Represented differently — flagged:**

1. **Goal taxonomy fixed against an explicit "not fixed" caveat.** Brief: goal choices (exam preparation, personal interest, gaining a grasp of related topics) are "examples, not a finalized or necessarily exclusive taxonomy." FR-7 fixes "Exam preparation, Understand a topic, Apply a skill or Other." The brief's three examples don't map cleanly ("personal interest" and "gaining a grasp of related topics" reworded; "Apply a skill" appears nowhere in the brief). Resolved by delegation (D2), but the PRD nowhere notes that the brief's examples were non-final — worth one provenance line.
2. **"Not yet approved" game mechanics converted to permanent non-goals.** Brief-addendum: hard prerequisite locks, XP, rewards, cross-course aggregation, mastery thresholds "are **not approved features**. The skill-tree analogy does not require them" — i.e., unapproved *now*, not forbidden. PRD §5 makes them explicit exclusions ("No XP, rewards, streaks, hard prerequisite locks or cross-course mastery aggregation") and D1 is cited as governing. If the delegation covered this, fine; but the PRD states exclusion as settled product identity rather than deferred-approval.
3. **Unlimited retries mandated.** Brief-addendum: the recovery wording does not require "unlimited retries"; "attempt limits … remain undecided." PRD FR-14 consequence: "Unlimited pedagogical retries." Resolved via D3; direction is learner-favorable, but it is a decision the brief had explicitly left open, presented in the PRD without an open-question trace.
4. **Reminder channel decided as in-app-only.** Brief: channels/cadence "remain undecided"; brief-addendum: "email, browser notifications and SMS are **not implicitly approved**." PRD FR-15/D6: in-app due list, one consolidated reminder per local day, no email/SMS/push. This resolves the undecided item conservatively (consistent with "not implicitly approved") via D6 — acceptable, listed for trace.
5. **Self-reported retention influence, starting-check inclusion/optionality, instructor-outcome authority boundary, node-to-completion mapping, pass thresholds** — all open in the brief, all fixed in the PRD (Hard self-report can advance but never postpone/credit; optional skippable 3–5-question check; instructor-required outcomes preserved under personalization; one node = one mini-course; 80% default). Each carries a D-policy citation, so these read as legitimate delegated resolutions; no misrepresentation found, but the PRD never surfaces which of its numbers were *user-settled* vs *delegated defaults* — a single index would prevent downstream readers from treating D-defaults as user decisions.

**Not represented:** none found at requirement level. Every brief bullet and brief-addendum user decision maps to an FR, constraint, non-goal or glossary entry.

## 3. Claims the PRD makes that the brief does not support

1. **§1 uniqueness-of-combination assertion.** PRD: "the pieces exist separately and **nowhere together**" (echoed in addendum §A "no comparable combines (a)–(d)"). The brief's scan explicitly concluded: "The light alternatives scan establishes **no unique feature advantage**" and "Maps, tutoring, adaptive practice and reassessment **should not be claimed as unique**." The PRD addendum re-researched (2026-10-21) and carries C5 hedges ("establishes no unique-feature advantage and is not a requirements source"), but the Vision sentence itself asserts the gap flatly, without the hedge. Recommend moving the hedge into §1 or softening to "no comparable we reviewed combines…".
2. **§8.4 "Why Now" evidence.** "LLM tutoring now has randomized-trial-level learning-gain evidence (Harvard physics RCT, 2025)…" is entirely new research absent from the brief, correctly flagged `[ASSUMPTION: positioning synthesis…]`. Acceptable as flagged context; do not let downstream epics cite it as a requirements rationale.
3. **Alternatives discovery performed despite deferral.** Brief: "Broader audience/problem and current-alternative discovery is **deferred to a later iteration**." PRD addendum §A is a comparables scan (hedged as context-only, C5-noted). Not a violation — it is positioning context, not audience discovery — but the tension with the brief's deferral should be stated where §A is introduced.
4. **Invented personas, non-user list, MVP mapping, SM target shapes** — all properly flagged `[ASSUMPTION]` in §12; no unsupported claim carried as settled. UJ scenarios faithfully synthesize settled rules (79.9% vs 80%, retest-from-approved-bundles, one-reminder-per-day) rather than inventing behavior.

## 4. Suggested follow-ups (for the PRD author, not new requirements)

- Add the skill-tree/knowledge-map visual intention to FR-20's description or the epic-1/6 UX contract so the user's proposed metaphor survives into UX design (it was the user's own proposal, not a coach idea).
- Add a one-column "provenance" note (user decision / delegated D-default / PRD assumption) for operative numbers — the PRD already separates these in §12 for assumptions; D-defaults deserve the same visibility.
- Hedge or localize the §1 differentiation sentence per C5.
- Consider carrying the brief-addendum's "best course → testable criteria" proposal into an open question or quality-acceptance section rather than dropping it.

**Overall verdict:** the PRD represents every brief requirement and user decision; its deltas are (a) delegated-policy resolutions of brief-open items, transparently cited, (b) a small number of qualitative losses (skill-tree metaphor, plan rationale, course-quality criteria), and (c) one unhedged differentiation claim in the Vision that the brief's evidence limits forbid.
