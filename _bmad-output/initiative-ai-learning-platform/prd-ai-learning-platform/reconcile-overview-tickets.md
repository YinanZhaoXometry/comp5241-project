---
title: Reconciliation — project-overview + tickets.toml + setup-experience vs PRD/addendum
created: 2026-10-21
inputs:
  - ../../project-overview.md (well, project root project-overview.md)
  - ../tickets/tickets.toml
  - ../tickets/epic-private-study-setup/setup-experience.md
  - prd-ai-learning-platform.md and addendum.md (checked documents)
  - ../tickets/epic-private-study-setup/delivery-checks.md (consulted only to confirm the S1–S13 binding exists)
---

# Reconciliation: source extraction vs drafted PRD + addendum

Method: re-read the three source files in full (unchanged since the 2026-10-21 extraction), then checked the PRD and addendum line-by-line against the four requested axes. Verdicts are per item; "no error" means the PRD/addendum matches the source, not that the source is endorsed.

## 1. Course objectives (project-overview.md → PRD)

| Overview obligation (verbatim key phrase) | PRD location | Verdict |
|---|---|---|
| "develop a GenAI-powered learning platform with learning contents and activities" | §1 Vision | Covered |
| Mini-courses "with interactive learning contents and activities", software dev/eng "more interactive, engaging and fun" | §1; FR-17 (interactive formats); FR-1 (generation) | Covered. "Engaging/fun" appears only as interactivity; PRD Non-Goals (no XP/rewards/streaks) is a policy narrowing, not a contradiction — the overview does not require gamified rewards. |
| Topics: "Fundamentals of software engineering and development, effective use of AI coding agents in software development, soft and product skills in software development, etc." | FR-9 (all three named areas); SM-3 (3/3 areas) | Covered. The overview's "etc." is open-ended; PRD fixes the three named areas as the required set — a reasonable reading, noted for transparency. |
| Formats: "text and images, interactive simulations, interactive role play or mock interviews, games/mini-games, AI-narrated animations and slides, online coding" | FR-17 lists all six families verbatim-in-substance; glossary "Activity"; SM-3 (6/6 families) | Covered, no format dropped |
| Personalization: "personalized learning and tailored learning content"; accessible to "non-Computer Science majors"; "Computer Science graduates preparing for careers … in the age of AI" | FR-8; §2.1 JTBD "Understand deeply, at my depth" (both personas named); UJ-1/UJ-2 | Covered |
| Instructors: "customize (manually or using AI)"; "use AI to develop new mini-courses by inputting their own topics, requirements, and teaching content"; "import their students"; "track students' participation and engagement" | FR-3 (all authoring verbs incl. refine); FR-4 (CSV import); FR-16 (participation incl. engagement-as-estimate); UJ-4 | Covered |
| Open domain: "generate mini-courses for other subjects/domains"; "learners generate their own topics and path for self-learning" | FR-18 (both clauses); UJ-5; glossary "Learning path" | Covered |

**Result: no uncovered or mis-covered course objective.** All five objective bullets and the overall objective map to FRs, UJs, SMs or Non-Goals in the PRD.

## 2. Epic → FR mapping (tickets.toml vs addendum §D and PRD §6.1)

FR-N ↔ R-N one-to-one holds: all 22 FRs exist in PRD §4 (count: 5+4+4+1+4+4), each cites its source R-N.

| Epic (tickets.toml `covers`) | Addendum §D FRs | PRD §6.1 | After (tickets.toml) | Addendum §D After | Match |
|---|---|---|---|---|---|
| 1 private-study-setup — R2,R7,R21,R22 | FR-2,7,21,22 | FR-2/7/21/22 | — | — | ✓ |
| 2 grounded-mini-courses — R1,R6,R8,R11,R12 | FR-1,6,8,11,12 | FR-1/6/8/11/12 | 1 | 1 | ✓ |
| 3 assessment-and-progress — R10,R13,R14,R20 | FR-10,13,14,20 | FR-10/13/14/20 | 1,2 | 1,2 | ✓ |
| 4 spaced-review — R15 | FR-15 | FR-15 | 1,3 | 1,3 | ✓ |
| 5 instructor-courses — R3,R4,R5,R16 | FR-3,4,5,16 | FR-3/4/5/16 | 1,2,3,4 | 1–4 | ✓ |
| 6 subject-and-activity-breadth — R9,R17,R18,R19 | FR-9,17,18,19 | FR-9/17/18/19 | 2,3,5 | 2,3,5 | ✓ |

Supporting facts also match: all 22 requirements covered exactly once; epic 1 "thirteen planned child entries, other epics unrefined" ↔ addendum §D "thirteen entries + UX contract + delivery checks" and PRD OQ-5 "five of six epics remain unrefined"; retired draft id 7 / "final pilot/initiative closure remains outside the epic" is respected — the PRD sequences the D8 pilot as milestone 4 without assigning it to an epic; FR-19 (4D presentation) stays inside epic 6 per the epic description.

Cosmetic observation (not an error): PRD §4.1 "Private Study Setup, Consent and Lifecycle" presents FR-1 under the setup theme even though epic 2 owns FR-1; the authoritative tables (§6.1, addendum §D) are consistent with tickets.toml.

**Result: zero epic→FR mapping or prerequisite errors.**

## 3. UX contract U0–U8 and the S1–S13 binding (setup-experience.md vs PRD/addendum)

U0–U8 enumeration: addendum §E lists all nine groups with accurate one-line summaries (access boundary; library/resumable setup; materials/extraction/preview; processing disclosure/controls; topic+goal; plan preview/edit/confirm; optional starting check; owner export; deletion/retention receipt) — matches U0–U8 titles verbatim-in-substance. PRD §4.1 cites "UX states U0–U8" without redefining them (correct deferral). Addendum §E correctly discloses "No UJ-* IDs pre-exist; the PRD's UJ-1…UJ-5 are new and this PRD is their home" — no fabricated provenance.

Load-bearing UX-contract numbers check out in the PRD: 20 MiB/file and 10 files/generation (FR-1 ↔ U2); "no remote URL/OCR/archive option" ↔ "No OCR, archive unpacking or remote-URL import"; 120-second honest-pending rule (FR-1/§9 ↔ U2); goal set Exam preparation / Understand a topic / Apply a skill / Other with conditional-only follow-ups and no forced diagnostic/background essay (FR-7 ↔ U4); immutable confirmed revision with generation pinning the exact confirmed revision, never latest draft (FR-21 ↔ U5); 3–5-question skippable starting check granting no completion/scored credit (FR-21 ↔ U6); export 24-hour expiry, snapshot boundary, deletion invalidates lineage exports (FR-22 ↔ U7/U8); 7-day active-copy purge, 30-day backup expiry with pre-restore deletion replay (FR-22 ↔ U8); processor eligibility as a separate axis from consent, fail-closed withdrawal (FR-22 ↔ U3).

**Gaps found:**

1. **S1–S13 binding dropped (main gap).** setup-experience.md Evidence section: "every visible branch belongs to [S1–S13](delivery-checks.md). Test both allowed and denied paths; screenshots or a polished screen do not establish backend authorization, processor compliance or correct deletion." delivery-checks.md does define S1–S13 (thirteen entries, S1–S13). Neither the PRD nor the addendum carries the S1–S13 identifier or this binding: addendum §D says only "delivery checks" generically; PRD §11 mentions independent review but not the S-IDs. Downstream readers lose the UX-state→delivery-check traceability. Recommend adding to addendum §E one line: every U0–U8 visible branch maps to S1–S13 in delivery-checks.md.
2. **U8's two distinct deletion scopes collapsed.** setup-experience.md U8: "separate Delete this material and dependent study data from Delete all my personal study data." PRD FR-22 says "owners can export and delete personal material and derivatives" — mechanically consistent (lineage rules, 7d/30d windows all match) but the material-scoped vs delete-all distinction is not stated anywhere in the PRD. Minor omission, not a misrepresentation; the PRD defers detail to the UX contract.

## 4. AI Fluency 4D obligation exact wording (project-overview.md vs PRD FR-19)

Source (verbatim): "each team should study the AI Fluency framework, explain how it can be applied to your project and share these reflections in your final presentation," with the four competencies defined: "Delegation (deciding what to hand to AI), Description (clearly specifying goals, constraints, and process), Discernment (critically evaluating AI outputs and reasoning), and Diligence (verifying, documenting, and taking accountability for results)," and AI Fluency defined as "the ability to collaborate with AI systems effectively, efficiently, and responsibly" (Anthropic's framework).

PRD FR-19: "The final presentation explains how Delegation, Description, Discernment and Diligence apply to this project, with project-specific examples for all four," consequences mapping to "(delegation decisions, prompts/specifications, output evaluation, verification and accountability)."

Verdict: substance preserved (final presentation, all four competencies, project-specific application), but **the exact wording is not preserved anywhere in the PRD or addendum**: (a) the four parenthetical definitions are paraphrased, not quoted; (b) the "study the AI Fluency framework … share these reflections" phrasing is reduced to "explains how … apply"; (c) the AI Fluency definition sentence and its Anthropic attribution appear in neither document. The glossary (§3), which is where verbatim term definitions live, has no AI Fluency entry. Recommend quoting the source sentence and the four parentheticals in FR-19 (or addendum) since the course presentation will be graded against the overview's wording.

## 5. Verified non-issues

- FR-17 format families and FR-9 subject areas match the overview lists item-for-item.
- Addendum §D "After" column equals tickets.toml `after` lists for all six epics; delivery-order framing ("delivery order, not an execution instruction") is preserved by PRD §6.1's sequencing language.
- UJ-1…UJ-5 are disclosed as PRD-invented (§2.3 assumption, addendum §E) rather than passed off as pre-existing IDs.
- Pilot (D8) and initiative closure remain outside the epics, matching epic 6's description.

## Gap list (most important first)

1. S1–S13 delivery-checks binding from setup-experience.md absent from PRD and addendum (addendum §E is the natural home).
2. AI Fluency 4D exact wording (four parenthetical definitions, "study … share these reflections," Anthropic attribution, AI Fluency definition) not preserved verbatim in FR-19 or anywhere else.
3. U8's two deletion scopes (material+dependents vs all personal study data) collapsed to a generic delete in FR-22.
4. Cosmetic only: FR-1 sits in PRD §4.1's setup section while epic 2 owns it (authoritative tables are correct).
