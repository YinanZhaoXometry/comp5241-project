---
title: Policy ↔ PRD Reconciliation (D1–D8)
created: 2026-10-21
inputs:
  - product-policies.md (D1–D8 baseline, 2026-10-21)
  - prd-ai-learning-platform/prd-ai-learning-platform.md (draft)
  - prd-ai-learning-platform/addendum.md
---

# Reconciliation: product-policies.md vs drafted PRD

Method: every operative number, format, interval, retention window, reminder cap, CSV rule and behavioral rule in D1–D8 was located in the PRD (and addendum where the PRD delegates) and compared verbatim. Findings are grouped: (1) numeric verification, (2) material absences, (3) over/understatement, (4) low-severity wording drift. Architecture-companion policies (AD-1–AD-18 mechanics, G-gate execution detail) were excluded per the reconciliation brief.

## 1. Operative-number verification — no contradictions found

| Policy value | Source | PRD location | Status |
|---|---|---|---|
| Pass mark 80% default, instructor-configurable | D3 | FR-13, Glossary "Pass mark", SM-C2 | Match |
| Unrounded comparison; one-decimal display; 79.96% ≠ pass at 80% | D3 | FR-13 ("79.96% does not pass an 80% mark even if display rounds to 80.0%") | Match |
| Partial credit only under disclosed rubric; no negative marking | D3 | FR-13 | Match |
| Attempt-start snapshot of content/test/rubric/pass-mark versions; no retroactive revocation | D3 | Glossary "Test/Attempt", FR-13, §9 | Match |
| No pedagogical attempt limit; quota delays save work, never record a failed attempt | D3 | FR-14 ("Unlimited pedagogical retries; resource/quota delays are honest…") | Match (qualifier kept) |
| Diagnostic: 3–5 questions, skippable, no exemption; unassessed = "Unknown," not "Weak" | D2 | FR-21, Glossary "Starting check" | Match |
| Goal set: Exam preparation / Understand a topic / Apply a skill / Other; exam date conditional | D2 | FR-7, UJ-1 | Match |
| Inputs: text-based PDF, DOCX, TXT, Markdown; ≤ 20 MiB/file; ≤ 10 files/generation; no OCR/archive unpacking/remote-URL import | D5 | FR-1, §5 Non-Goals | Match |
| Honest extraction: reject unreadable/password-protected/unsupported; preview text + warnings before use | D5 | FR-1, UJ-1 edge | Match |
| CSV import: UTF-8, name + email, previewed rows/errors/duplicates before confirmation; no imported passwords/grades; roster never exposed to learners or providers | D5 | FR-4 | Match |
| Review intervals: first review 1 day after completion; then 3/7/14/30, repeating 30-day; intervals run from each actual successful review, not completion date | D6 | FR-15, Glossary "Review", UJ-3 | Match (see §4 glossary compression) |
| Failed/assisted review → targeted support + next-day review, sequence restarts after next unaided success | D6 | FR-15 | Match |
| Hard self-report may bring review forward to next day; self-report never postpones, awards credit or extends interval | D6 | FR-15, UJ-3 edge | Match |
| At most one consolidated reminder per local calendar day; no email/SMS/push | D6 | FR-15, §5 Non-Goals, SM-C3 | Match |
| Snooze until tomorrow or three days later; timing-only, never evidence | D6 | FR-15 ("tomorrow or +3 days") | Match |
| Timezone detected and changeable; predictable due-date updates | D6 | FR-15 ("DST-safe") | Match |
| Deletion: immediate access/reminder revocation; active copies purged within seven days incl. provider copies; backups expire within thirty days with deletion reapplied before restore; content-free operational/security metadata expires after thirty days | D5 | FR-22, Glossary "Export/Deletion", §8.1 | Match |
| Instructor-course records: deletion ninety days after archive with notice/export; institutional deviation needs explicit policy change | D5 | FR-22, §8.1, OQ-6 | Match |
| Consent: provider/purpose/data categories/retention disclosed before external processing; refusal sends nothing externally; no training reuse; provider verification is a release gate, not an assumed capability | D5 | FR-22, §5, §8.1, OQ-1 | Match |
| 120-second rule: complete or retryable failure/pending with saved input; timeout never success; retries never double-count | D7 | FR-1, §9, SM-4 | Match |
| Usability bar: keyboard, named controls, visible focus, readable contrast, error/status feedback at 360-pixel and desktop widths, no horizontal overflow; WCAG 2.2 AA target not certification | D7 | §8.2 | Match (two sub-rules absent, §2 below) |
| Pilot: three fresh unaided baseline recall/application items; one mini-course + required test; natural recovery else labeled scripted case; thirty-minute first session = usability target not exclusion rule; seven-day delayed fresh-item check before viewing review/answers | D8 | SM-1 ("baseline… ≤ 30-min usability target… seven-day delayed check"), addendum §F | Match in addendum; "three items" number not in PRD body (§4) |
| Pilot scope: unit vs integration tests; Arrange–Act–Assert on a small pure function; rights-verified fixture before execution; TCP illustrative only; reference rubric independent of the generating model; descriptive reporting only, no efficacy/superiority/PMF claims | D8 | §1, §7 SM-1, §5, addendum §F | Match |

One provenance note: FR-22's "Export requests expire within 24 hours" is not a D1–D8 number — it comes from the architecture spine (AD-4, per addendum §B). It does not contradict D5, but §0 claims "operative numbers … come from [D1–D8]"; the 24 h figure should be attributed to AD-4 (or §0's sourcing sentence widened) to keep that claim true.

## 2. Material policy rules absent from the PRD

Ordered by product impact.

1. **D4 personal-study labeling (should appear in §4.2 / glossary).** D4: personal study has "no instructor gate … but identify AI-generated/unreviewed material and retain source/error-report visibility. This is not a correctness guarantee." The PRD labels personal-study *AI grading* ("labeled and challengeable", FR-13) but never requires that personal-study *lessons/explanations/supplements* be identifiable as AI-generated/unreviewed, nor keeps source/error-report visibility as a personal-study capability. This is the learner-facing counterpart to FR-5 and is currently missing.
2. **D5 role model and admin constraints (should appear in §4.5 or §8.1).** D5 defines the third role: admin assigns instructor capability and manages account/system metadata only — "not ordinary access to personal-upload contents," "No self-service privilege escalation or content-browsing admin feature," privileged operations logged without private document/answer text, exceptional infrastructure access only via a separate audited process before real-data deployment. The PRD never mentions admin at all, so it never states how a user becomes an instructor (a prerequisite for FR-3/FR-4/FR-5/FR-16 to function) nor the no-browsing/no-escalation constraints.
3. **D5 consent withdrawal (should appear in FR-22).** FR-22 covers *declined* consent ("nothing sent externally… fail closed"). D5 additionally requires that **withdrawal** of previously given consent stops future external processing and offers deletion of existing personal data, while it "cannot undo earlier disclosed processing." The post-consent withdrawal path is absent.
4. **D1 version pinning for learners (should appear in FR-13 or Glossary "Completion").** D1: "Learners remain on their published version until explicitly choosing a new version; changed required work is shown before switching." The PRD keeps only the negative half ("version changes do not retroactively revoke earned progress"). The positive behavioral rule — explicit opt-in to a new version after being shown changed required work — is missing.
5. **D3 assessment-disclosure and dispute-integrity cluster (should appear in FR-13/FR-14).** Three operative rules: (a) "Show threshold, available points and scoring criteria before starting" — absent; (b) "Show previous attempts rather than silently overwriting them" — attempts are declared immutable but no rule requires surfacing prior attempts to the learner; (c) the appeal bound: personal-study disputes "offer a documented corrected replacement rather than letting an unchecked AI appeal award a pass" — the PRD's "challengeable" lacks this limit on what a challenge can award.

### Lesser absences (verbatim rules with a home in the PRD but currently missing)

- **D4:** supplements "Prefer relevant official specifications, primary documentation or credible educational references" (source-quality ordering; FR-6 says "identified, claim-supporting" only); deeper-why must not invent "a single 'root cause' or historical origin" (FR-11 has honest stopping but not this prohibition).
- **D5:** "Do not silently substitute a provider with incompatible retention"; "personal study is not deleted merely because an unrelated instructor course archives" (cross-account independence of the 90-day rule); unenrollment "does not silently delete the instructor's legitimate course records" (FR-4 keeps only the learner-export half); export/delete scope includes "search/index representations, conversations, evidence and reminders" (PRD says "derivatives").
- **D6:** "The due list persists even when no new reminder is created"; on resume, "shows the current due list without a backlog burst" (FR-15 has pause/snooze/disable but not the resume behavior).
- **D7:** "generated variants require equivalent checks, not merely fluent text" (§8.2 covers fixture claims but not variant equivalence); "motion is not required to access the teaching content" (§8.2 keeps narration text equivalents only); the access/approval bar's "Zero unresolved critical/high security defects or material completion/grading defects … do not lower the bar by suppressing checks" is referenced only as "D7's quality gates" in §11 without the zero-defect/suppression wording.
- **D8:** "record earlier practice/reviews as confounders" and the delayed check "must not be mislabeled as unpractised retention" (SM-1/addendum §F carry the seven-day check but not the confounder/mislabeling rule); functional checks use "learner/instructor/non-enrolled test accounts … not additional study participants" (SM-2 implies but does not state the account triad or its non-participant status); "Broader demand research remains deferred."
- **D3:** quotas "do not … promise unlimited free generation" (FR-14's "Unlimited pedagogical retries" keeps the qualifier, but the no-free-generation-promise caveat is absent).

## 3. Overstatement / understatement check

- **No target is presented as achieved compliance.** FR-22 "Out of Scope: any claim of present compliance — these are targets to verify (G2/G5)"; §8.1 "All are verification targets, not present compliance"; §11 "Release Gates (not claims)"; §9 keeps performance/cost budgets explicitly unset. WCAG 2.2 AA and the review schedule are both framed as target/heuristic, matching D7/D6. The PRD does not overstate the D-policies.
- **Understatement check: faithful.** Provider verification, runtime recheck, fixture rights, epic refinement and institutional-retention change are all carried as open gates/questions (OQ-1–OQ-6, §11), matching the policies' "Remaining implementation and release gates" section.
- **One tone-level flag (low severity):** §1 Vision — "scheduling the return visits that make knowledge stick" reads as an efficacy claim; C5/C6/D8 forbid causal-effectiveness claims from this project's artifacts. The same paragraph's bounded disclaimer ("evidence of learning at a moment, not proof of permanent retention") contains it, but the phrase itself could be softened to stay strictly inside the no-efficacy-claim constraint.

## 4. Low-severity wording drift (no behavior change intended)

- Glossary "Review" compresses the schedule to "intervals 1/3/7/14/30 days … running from each successful review." Per D6 the 1-day first review runs from **completion**; only subsequent intervals run from the successful review. FR-15 states it correctly; the glossary merge could mislead implementers.
- FR-15 drops "new" from D6's "one **new** consolidated reminder per local calendar day" — immaterial while reminders are daily-capped, but the policy word is "new."
- SM-1 compresses "three fresh unaided baseline recall/application items" to a "baseline" phase; the item count survives only in addendum §F. Since §0 routes operative numbers to D1–D8 this is acceptable, but the PRD body itself no longer carries the "three."
- FR-15 adds "or due dates" to D6's "changes notification timing, not assessment evidence" — a consistent clarification (snooze must not move due dates), not a contradiction; worth keeping explicit in both places.

## 5. Summary

- **Contradictions in operative numbers: none.** Every checked number, format, interval, cap and retention window in the PRD matches D1–D8 (the 24 h export expiry is the only number with non-D provenance — attribute it to AD-4).
- **Material absences: five** (personal-study AI/unreviewed labeling; admin role + no-browsing/no-escalation constraints; consent withdrawal; learner version pinning; the D3 disclosure/attempt-history/appeal-bound cluster), plus a tail of verbatim lesser rules listed in §2.
- **Overstatement: none; understatement: faithful.** One vision-phrase tone flag.
- **Wording drift: four low-severity items**, of which the glossary "Review" interval compression is the one most likely to cause implementation error.
