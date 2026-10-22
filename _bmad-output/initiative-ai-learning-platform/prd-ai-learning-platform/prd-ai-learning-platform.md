---
title: AI Learning Platform
status: draft
created: 2026-10-21
updated: 2026-10-21
---

# PRD: AI Learning Platform
*Working title — confirm. [ASSUMPTION: "AI Learning Platform" is the descriptive working title carried from the initiative; no branding decision has been made.]*

## 0. Document Purpose

This PRD is the product document for the COMP5241 (PolyU software engineering) GenAI-powered learning platform. It is written for the course team, the instructor/stakeholders reading the final deliverables, and downstream workflow owners (UX, architecture, epic refinement). It consolidates — and does not re-decide — the already-settled product baseline:

- **Initiative requirements R1–R22** ([initiative file](../initiative-ai-learning-platform.md)) — settled; each FR in §4 cites its source R-ID verbatim-numbered (FR-N ↔ R-N, one-to-one).
- **Product policies D1–D8** ([product-policies.md](../product-policies.md)) — delegated defaults selected 2026-10-21 under the user's standing delegation; operative numbers (pass mark, intervals, limits, retention windows) come from there, with a few lifecycle mechanics (e.g. 24-hour export expiry, AD-4) noted inline from adopted architecture decisions.
- **Architecture spine AD-1–AD-18** ([architecture companion](../architecture-shared-technical/architecture-shared-technical.md)) — planning-level technical contract; summarized in the [addendum](addendum.md), not duplicated here.
- **Approved product brief** (2026-10-20) and **epic breakdown** ([tickets.toml](../tickets/tickets.toml)).
- **Constraints C1–C7** (initiative file) — settled; C1–C6 one-liners in §8.3, C7 (delivery/release gates) in §11.

This PRD authorizes nothing: implementation, external accounts, real-data processing, deployment and pilot execution remain separately gated (see §11).

## 1. Vision

The AI Learning Platform turns learner or instructor material into personalized mini-courses, then stays with the learner through the whole arc that courseware normally abandons: identifying what actually needs attention, teaching it at the right depth for the learner's background, testing honest recall, recovering only what was failed, and scheduling the return visits that make knowledge stick. A learner uploads a unit-testing chapter or a topic request, confirms a short plan, studies source-backed lessons, and — when they fail — gets a fresh targeted retest instead of a repeat of everything. An instructor keeps authority over everything students see: AI-generated lessons, tests, answers, rubrics and feedback reach students only after the instructor personally approves the exact version.

It matters because the pieces exist separately across current tools — upload-to-course generators have no governed instructor approval; tutors have no course-completion structure; flashcard apps schedule review but never see course progress; LMSs track cohorts but don't generate personalized content — and the 2026-10 landscape scan found no comparable that combines them (addendum §A; per C5 this establishes no unique-feature advantage). The platform's bet is that the combined loop — confirmed plan → grounded study → honest assessment → targeted recovery → spaced return, under instructor exact-version approval — is the product, not any single feature.

The claim is deliberately bounded. This is formative learning support, not certified assessment; evidence of learning at a moment, not proof of permanent retention; a heuristic review schedule, not an optimality claim. The first validation is a one-participant pilot that can reveal workflow and content problems — nothing more (C5, §8.3).

## 2. Target User

### 2.1 Jobs To Be Done

- **Turn material I have into study that fits me** — "I have this PDF/chapter/topic; make me a course that respects my goal and background, and let me fix the plan before you build it." (functional + emotional: relief from repeated full-course rereading)
- **Know what to study next and why** — an explainable priority list grounded in my actual responses, not a generic syllabus.
- **Understand deeply, at my depth** — plain language and familiar examples for a non-CS learner; scenario-based depth for a CS graduate — without bending factual correctness or instructor-set outcomes.
- **Recover from failure without redoing success** — re-study and re-test only the failed knowledge areas; keep my passed sections.
- **Come back on schedule without nagging** — spaced reviews with at most one consolidated in-app reminder per day; pause or snooze without losing evidence.
- **Keep personal study private** — my uploads are mine alone; instructors and other learners never see them.
- **Instructor: teach with AI under my authority** — generate/adapt courses, import my students, approve exactly what they will see, track participation without surveillance of private study.
- **Learn anything, not just software** — generate mini-courses for other domains and my own self-learning path.

### 2.2 Non-Users (v1)

[ASSUMPTION: this v1 boundary list is this PRD's synthesis, not a settled decision.]

- Learners needing **certified, accredited or proctored assessment** — the platform is explicitly formative (C6).
- Institutions requiring **SSO/LMS integration or district-scale administration** — not selected, not implied.
- **Mobile-native-only** users — delivery is web-first (C1); no native app is implied.
- Browsers of a **public course catalog/marketplace** — instructor courses are enrollment-gated, not public.

### 2.3 Key User Journeys

*Protagonists are illustrative composites of the brief's audience contexts; scenarios are synthesized from settled requirements, not validated user research. Glossary terms (§3) are used verbatim in these journeys. [ASSUMPTION: journey protagonists and their specifics are invented for this PRD.]*

- **UJ-1. Wei confirms a plan before the platform builds her course.**
  - **Persona + context:** Wei, a final-year marketing major taking a required software engineering course, studies best from short structured material.
  - **Entry state:** Signed in on the web app; empty study library.
  - **Path:** Uploads a 12-page unit-testing PDF → previews the extracted text and warnings, acknowledges the material as the source → picks goal "Exam preparation" (one conditional follow-up: exam date) → reviews the inferred plan — outcomes, mini-courses, practice, estimated effort, source coverage, flagged missing explanations → edits two outcome titles → confirms → skips the optional 3–5-question starting check ("Skip for now" equally visible).
  - **Climax:** The plan locks as an immutable confirmed revision and generation starts only now — she knew what she would get before it was built.
  - **Resolution:** Her library shows the confirmed plan with generation progress; her upload is visible to no one but her.
  - **Edge case:** A password-protected PDF is rejected with an honest failure message — never a silent "extraction succeeded."

- **UJ-2. Aditi fails at 79.9% and recovers only what she failed.**
  - **Persona + context:** Aditi, a CS graduate using "Apply a skill," wants deeper application scenarios, not basics restated.
  - **Entry state:** Signed in; required test submitted in a generated mini-course.
  - **Path:** Sees "Not passed — 79.9% (mark 80%)" computed on unrounded points → inspects the failed questions → takes the offered focused review for the two failed knowledge areas → takes the fresh targeted retest (same objective and cognitive demand, new questions, comparable rubric) → passes one area, not the other.
  - **Climax:** The passed area is cleared toward the original failed-test requirement; her earlier passed sections are retained — visible separately from the original result, with no invented higher original score.
  - **Resolution:** The still-failed area keeps her from completing the mini-course; she retries after more study with no pedagogical attempt limit.
  - **Edge case:** She flags a question as unclear; it goes "Under review" — her earned passes are never revoked while the dispute is resolved.

- **UJ-3. Lars returns seven days later because the app asked once.**
  - **Persona + context:** Lars completed a mini-course last week; his due list has been quietly accruing.
  - **Entry state:** Signed in after a week away; one consolidated reminder in-app (not per-item spam).
  - **Path:** Opens the due-review list → attempts the review unaided → meets the applicable pass mark → next review scheduled in 3 days per the 1/3/7/14/30-day sequence, running from this successful review.
  - **Climax:** Completion of the mini-course is untouched by review success or failure — review failure never revokes what he earned.
  - **Resolution:** A clean due list and a predictable next date in his own timezone (DST-safe).
  - **Edge case:** Had he needed assistance, the next review would come tomorrow and the sequence would restart after his next unaided success; "Hard" self-report can bring a review forward, but never postpone one or award credit.

- **UJ-4. Prof. Chen approves exactly what students will see.**
  - **Persona + context:** Prof. Chen teaches software engineering to 32 enrolled students and wants AI-authored material under his personal authority.
  - **Entry state:** Signed in as instructor with an existing mini-course.
  - **Path:** Generates a draft mini-course from his topic and teaching content → edits sections manually and with AI → imports students via CSV (name + email, previewed rows, duplicates flagged, confirmed) → inspects and approves the exact versions of lessons, test bundles (questions, answers, rubric, generated feedback) and supplementary sources → watches the participation report: last activity, required-item progress, attempt/pass/recovery status, due/overdue reviews.
  - **Climax:** A student-tailored retest is assembled only from already-approved bundles; newly generated questions land in a pending queue — students see approved material or an honest "Pending instructor approval," never unseen output.
  - **Resolution:** When he edits a rubric, affected drafts' approvals are invalidated; his published version and students' pinned attempts are not silently rewritten.
  - **Edge case:** Removing an enrolled student immediately revokes access and reminders; the student retains only a distinct self-history export.

- **UJ-5. Yusuf learns something outside the domain.**
  - **Persona + context:** Yusuf, curious learner, wants a photography-composition mini-course — nothing to do with software.
  - **Entry state:** Signed in; uses open-domain generation.
  - **Path:** Enters his own topic → confirms a plan (same confirmable setup as material-based study) → studies and is tested under the same completion and review rules.
  - **Climax:** The platform generates for other domains without making his or anyone's instructor courses public.
  - **Resolution:** His self-learning path can string several mini-courses together; personal other-domain study never inherits instructor enrollment/approval requirements.

## 3. Glossary

*Terms are used verbatim across FRs, UJs and SMs; synonyms are discipline violations. Deep definitions live in D1–D8; these are the PRD-working definitions.*

- **Learning path** — a personal grouping of mini-courses (learner-owned); completes when all its required mini-courses complete. D1.
- **Instructor course** — an instructor-owned grouping of mini-courses with enrollment and exact-version approval; never public. D1/D5.
- **Mini-course** — the atomic study unit: lessons, content items, activities and related tests. One roadmap node = one entire mini-course. D1.
- **Lesson / Content item / Activity** — teaching units within a mini-course; an activity is interactive (simulation, role play/mock interview, mini-game, narrated animation/slides, online coding, etc.). Required content items are explicitly marked done; required non-test activities are submitted. D1.
- **Test / Attempt** — a scored assessment; every attempt snapshots the content, test, rubric and pass-mark versions at attempt start. Attempts are immutable; earned passes are never revoked. D3.
- **Pass mark** — the unrounded earned-points percentage threshold an attempt must meet or exceed; **80% default, instructor-configurable for their courses**. Display rounds to one decimal but never rounds a pass into existence. D3.
- **Targeted retest** — a fresh same-objective/same-demand retest covering only still-failed knowledge areas; passing a group clears that failed area toward the original failed-test requirement. Original and recovery results stay separate. D3.
- **Completion** — a mini-course is Completed when all required content items and activities are done AND all required tests pass (directly or via targeted retest). Review failure never revokes it. D1/D3.
- **Roadmap node** — the whole-mini-course status marker: Not started / In progress / Completed, with separate "Needs practice" and "Review due" indicators. Recommended order without hard locks, XP or rewards. D1.
- **Confirmed plan** — the learner-edited, immutable plan revision that must exist before full generation; preview shows outcomes, mini-courses/lessons, practice, estimated effort, source coverage and missing explanations. D2.
- **Starting check** — the optional, skippable 3–5-question diagnostic; skipping or passing grants no exemption; unassessed objectives stay "Unknown," never "Weak." D2.
- **Evidence** — typed learning signals kept strictly separate: unaided submitted performance, assisted practice, activity/completion, and Easy/Unsure/Hard self-report. Self-report never awards a pass; only unaided evidence can. D2/D3.
- **Needs practice** — observed-difficulty label tied to a specific response/objective, asserting no cause; distinct from Unknown. D2.
- **Review** — a scheduled unaided retrieval session; the first is due one day after completion, subsequent intervals 3/7/14/30 days (then 30-day repeats), each running from the last successful review; a stated heuristic, not an optimality claim. D6.
- **Due list / Reminder** — the in-app review inbox; at most one consolidated reminder per local calendar day; no email/SMS/push. D6.
- **Personal study** — learner-owned material and generated courses; invisible to instructors and other learners. R2.
- **Enrollment** — verified-account association with an instructor course via previewed/confirmed name-and-email CSV import; removable with immediate access and reminder revocation. D5.
- **Exact-version approval** — the instructor's personal approval of a specific revision of any learner-facing AI artifact (lesson, explanation, source, test bundle incl. answers/rubric/feedback), recorded with approver and time; unapproved content is inaccessible ("Pending instructor approval"), including fresh retests and why-responses. D4.
- **Supplementary source** — an identified external source used when uploads lack a necessary explanation; uploads first, supplements second, conflicts displayed, never silently rewritten. D4.
- **Provider processing** — any external AI processing, gated behind an informed opt-in disclosure (provider, purpose, data categories, retention); refusal sends nothing externally. D5.
- **Export / Deletion** — authenticated owner controls over personal material and its derivatives; deletion revokes access/use/reminders immediately, purges active copies within seven days, expires backups within thirty days (deletion reapplied before restore), and defaults instructor-course records to deletion ninety days after archive with notice/export. D5.

## 4. Features

*Each FR cites its settled source requirement (FR-N ↔ R-N) and the D-policies its numbers come from. Consequences are testable checks drawn from the initiative's verification clauses.*

### 4.1 Private Study Setup, Consent and Lifecycle

**Description:** The learner's front door: private material upload with honest extraction preview, selection-first goal setup, a confirmed plan before generation, an optional starting check, and the processing-consent/data-lifecycle controls that govern everything downstream. Realizes UJ-1, UJ-5. — UX states U0–U8 in the [epic-1 UX contract](../tickets/epic-private-study-setup/setup-experience.md).

**Functional Requirements:**

#### FR-1: Personal-material mini-course generation *(source R1)*

A learner can upload text-based PDF, DOCX, TXT or Markdown (≤ 20 MiB/file, ≤ 10 files/generation), preview extracted text and warnings, acknowledge it, and obtain a mini-course only after confirmed setup per FR-21. Realizes UJ-1.

**Consequences (testable):**
- Personal upload → preview → confirm → generated mini-course path works end-to-end.
- Unreadable, password-protected, unsupported or oversized files are rejected with an explicit failure — never a claimed successful extraction; no automatic OCR, archive unpacking or remote-URL import.
- Generation completes or presents a retryable failure/pending outcome with saved input by 120 seconds; timeout never means success.

**Out of Scope:** image-heavy scanned material (no OCR).

#### FR-2: Private uploads *(source R2)*

Personal uploads and their derivatives are visible only to their uploading learner.

**Consequences (testable):**
- Owner access works; other learner and instructor accounts are denied, including direct URL/API attempts.

#### FR-7: Selection-first goal setup *(source R7; C2; delegated D2 taxonomy)*

After upload, the learner selects Exam preparation, Understand a topic, Apply a skill or Other, and answers only critical conditional follow-ups (e.g. exam date only for exam preparation).

**Consequences (testable):**
- Setup completes via short choices; "Other" route is short; no universal essay/date requirement; no forced diagnostic or background essay.

#### FR-21: Confirmable generation setup *(source R21)*

The learner confirms/corrects the inferred topic and goal, edits the personal course plan before full generation, and may take or skip a 3–5-question starting check.

**Consequences (testable):**
- Corrected-plan and skipped-check paths both work; skipping grants no completion exemption; plan revision is immutable once confirmed; generation commands pin that revision.
- Starting check never creates completion awards, scored-course attempts or recovery credit.

**Notes:** `[NOTE FOR PM: the brief's discovery addendum proposed showing why the proposed route fits the stated goal (plan rationale) in the plan preview; neither R21 nor D2 adopts it explicitly — confirm whether to include. See addendum §G.]`

#### FR-22: Processing disclosure and data lifecycle *(source R22; D5)*

Before any external processing, the platform discloses provider, purpose, data categories and retention and obtains opt-in; owners can export and delete personal material and derivatives.

**Consequences (testable):**
- Declined consent → nothing sent externally and personal-study features degrade honestly (fail closed).
- Owner-only export/delete; deletion revokes access/use/reminders immediately, purges active copies within 7 days (including provider copies), expires backups within 30 days with deletion reapplied before restore, and deletes instructor-course records 90 days after archive with notice/export.
- No training reuse of learner data; provider must meet non-training + bounded/deletable-retention terms before any real data (a release gate, not an assumed fact).
- Export requests expire within 24 hours (AD-4); deletion invalidates derived-artifact exports.
- Withdrawal of processing consent stops future external processing and offers deletion; it cannot undo already-disclosed processing.
- Two explicit deletion scopes, distinct in UI and effect: "Delete this material and dependent study data" vs "Delete all my personal study data" (epic-1 UX contract, state group U8).

**Out of Scope:** any claim of present compliance — these are targets to verify (G2/G5).

### 4.2 Grounded Personalized Mini-Courses

**Description:** Study itself: source-backed lessons personalized to background and goal, gap-supplementation from identified external sources, successively deeper "why" exploration, and active recall before answers. Realizes UJ-1, UJ-2, UJ-5.

**Functional Requirements:**

#### FR-8: Background and goal adaptation *(source R8)*

Explanations and support are tailored to the learner's background/goal while preserving factual correctness and instructor-required outcomes.

**Consequences (testable):**
- "Suitable treatment" is verified by side-by-side generation for the same objective: plain language, familiar examples and explicit prerequisites on the non-CS beginner track; application scenarios and depth on the CS-graduate track.
- Learner personalization never weakens published course requirements.
- Personal-study generated lessons/explanations are labeled AI-generated/unreviewed, with visible sources and an error-report path (D4).

#### FR-6: Supplement missing explanations *(source R6; D4)*

Where uploads lack a necessary explanation, the platform supplements with identified, claim-supporting external sources.

**Consequences (testable):**
- Source identity and location visible; uploads vs supplements distinguishable; conflicting claims displayed with sources, never silently rewritten; unsupported answers stop short of an authoritative answer and generate no scored item; in instructor courses FR-5 approval applies. An AI-generated citation is not verification.

#### FR-11: Deeper why exploration *(source R11; D4)*

Learners can successively request deeper explanations and stop at any depth.

**Consequences (testable):**
- Deeper levels address purpose, assumptions or trade-offs beyond restatement; sources visible; honest stopping when evidence is exhausted; in instructor courses each fresh response passes the pending-approval queue.

#### FR-12: Active recall *(source R12)*

Practice tasks require the learner to attempt retrieval before the answer is shown, followed by feedback.

**Consequences (testable):**
- Attempt-before-answer behavior enforced; answers withheld until submission on scored attempts.

### 4.3 Assessment, Completion and Progress

**Description:** The evidence engine: tests with attempt-scoped policies, the 80%-default pass mark, completion across required items/activities/tests, targeted recovery, gap guidance and the whole-mini-course roadmap. Realizes UJ-2, UJ-3.

**Functional Requirements:**

#### FR-13: Course completion and pass marks *(source R13; D1/D3)*

A mini-course completes when required content items and activities are done and all required tests pass (directly or via FR-14); a parent path/course completes when every required mini-course completes.

**Consequences (testable):**
- Default pass mark 80% (instructor-configurable for their courses), compared on unrounded earned-points percentage against attempt-snapshotted policy; 79.96% does not pass an 80% mark even if display rounds to 80.0%.
- Required-item/activity gaps, failed/unattempted tests correctly block completion; passing with some wrong answers works; version changes do not retroactively revoke earned progress, and learners stay on their enrolled/published version until explicitly choosing a new one, with changed required work shown before switching (D1/AD-5).
- Partial credit only under a disclosed rubric; no negative marking; provisional AI grading in instructor courses cannot award completion until confirmed; personal-study AI grading is labeled and challengeable; threshold, available points and scoring criteria are shown before starting; previous attempts are visible; an unchecked AI appeal can never award a pass (D3).
- Learners cannot post scores or credit from outside the system (AD-8).
- Content-item completion requires explicit marking (no dwell/scroll/full-playback tracking); optional enrichment is labeled and non-blocking.

#### FR-14: Targeted recovery and reassessment *(source R14; D3)*

After a failed test, the learner can inspect failed questions, take focused review, then a fresh targeted retest of the still-failed objective groups.

**Consequences (testable):**
- Passed sections retained and never repeated; retest questions fresh at the same intended cognitive demand with comparable rubric/points; each reassessed group must reach the pass mark; original and recovery results shown separately — no invented original score.
- Unlimited pedagogical retries; resource/quota delays are honest and save work without recording a failed attempt; disputed items go "Under review" and never revoke earned passes.

#### FR-10: Gaps and next-study guidance *(source R10; D2)*

The platform identifies knowledge needing attention and explains what to study next, grounded in response/objective evidence.

**Consequences (testable):**
- Recommendations cite the relevant response/objective and explain uncertainty; unknown vs observed-difficulty ("Needs practice") distinctions hold; assisted practice, unaided performance, self-report and engagement remain separate; no certain-diagnosis claims.

#### FR-20: Mini-course roadmap nodes *(source R20; D1)*

After goal selection, whole-mini-course nodes appear on a visible map of the path/course (the user-contributed skill-tree metaphor; layout, node sizing and navigation remain open design), showing Not started / In progress / Completed with separate "Needs practice" / "Review due" indicators.

**Consequences (testable):**
- Status maps to FR-13 rules; recommended prerequisite order with free browsing of authorized nodes; no hard locks, XP or rewards; review becoming due never removes completion.

### 4.4 Spaced Review and Reminders

**Description:** The return loop after completion. Realizes UJ-3.

**Functional Requirements:**

#### FR-15: Spaced review and reminders *(source R15; D6)*

The first review is due one day after mini-course completion; subsequent reviews follow 3/7/14/30-day intervals (then repeating 30-day), each running from the last successful unaided review, with an in-app due list and at most one consolidated reminder per local calendar day.

**Consequences (testable):**
- Failure or assisted review → targeted support and a next-day review, the sequence restarting after the next unaided success; Hard self-report can bring a review forward, never postpone one or award credit.
- Timezone detected and changeable with predictable due-date updates (DST-safe); pause / snooze (tomorrow or +3 days) / disable change notification timing only — never evidence or due dates; overdue items aggregate into the one daily reminder.
- Review uses the applicable pass mark but never revokes completion; deletion stops that course's reminders.

### 4.5 Instructor Courses

**Description:** Instructor authority end-to-end: authoring, AI-assisted generation, enrollment, exact-version approval of everything students see, and participation tracking. Realizes UJ-4.

**Functional Requirements:**

#### FR-3: Instructor authoring *(source R3; D2/D4)*

Instructors can upload/edit teaching material, customize existing content/activities manually or with AI, and generate/refine new mini-courses from topics, requirements and teaching content.

**Consequences (testable):**
- Creation and iterative editing work with instructor-controlled outcomes, versioned drafts, and affected re-approval (not silent published-content replacement).

#### FR-4: Student import and enrollment access *(source R4; D5)*

Course owners import students via UTF-8 CSV (name + email) with previewed rows/errors/duplicates and confirmation, and manage enrollment.

**Consequences (testable):**
- Only verified invited/enrolled students gain access; duplicates and row errors surfaced pre-confirmation; non-enrolled access denied; removal revokes access and reminders immediately, leaving only a distinct self-history export.
- No imported passwords or grades; the roster is never exposed to learners or generation providers; restricted history export under D5.

#### FR-5: Instructor approval before student use *(source R5; D4/AD-6)*

The instructor personally approves exact versions of all learner-visible AI lessons/explanations, test bundles (questions, answers, rubric, generated feedback) and supplementary sources before student use.

**Consequences (testable):**
- Unapproved or stale-draft content is inaccessible — including fresh tailored retests and why-responses; students see approved content or an honest "Pending instructor approval," never partial/unseen output.
- Approver, time and approved versions recorded; dependency edits invalidate affected approvals; withdrawal of an erroneous item blocks new use without rewriting past attempts; batch approval only after inspecting the listed versions.

#### FR-16: Instructor participation tracking *(source R16; D6)*

Instructors see, for their course's enrolled learners: last activity, required-item progress, attempt/pass/recovery status, and due/overdue reviews.

**Consequences (testable):**
- Reports are course-scoped: no access to private-study evidence or other instructors' rosters; estimated active time, if shown, is labeled an estimate from active sessions — not background dwell, not proof of learning.

### 4.6 Subject Breadth, Activity Formats and Open Domain

**Description:** The assignment's required breadth: three subject areas, six interactive format families, other-domain generation and the AI Fluency 4D presentation deliverable. Realizes UJ-5.

**Functional Requirements:**

#### FR-9: Required subject coverage *(source R9)*

Mini-courses are supported across software-engineering/development fundamentals, effective use of AI coding agents, and soft/product skills.

**Consequences (testable):**
- Representative learning content and activities exist in all three areas, not only the pilot topic.

#### FR-17: Interactive format coverage *(source R17; AD-12)*

The platform supports text/images, interactive simulations, role play/mock interviews, games/mini-games, AI-narrated animations/slides and online coding.

**Consequences (testable):**
- Functioning representative activities in every format family — no inert placeholders; a disabled placeholder does not satisfy this FR; online coding runs only in an isolated, resource-bounded environment (a feasibility gate precedes activation); every lesson need not use every format; narration has text equivalents.

#### FR-18: Other-domain and self-directed learning *(source R18)*

Users can generate mini-courses outside the main domain; learners can generate their own topics and self-learning paths.

**Consequences (testable):**
- A topic from another domain and a learner-directed path both work; instructor courses are never made public; personal other-domain study does not inherit instructor enrollment/approval requirements.

#### FR-19: AI Fluency presentation deliverable *(source R19)*

The final presentation explains how Anthropic's AI Fluency 4D framework applies to this project, with project-specific examples for all four competencies — Delegation (deciding what to hand to AI), Description (clearly specifying goals, constraints, and process), Discernment (critically evaluating AI outputs and reasoning), and Diligence (verifying, documenting, and taking accountability for results).

**Consequences (testable):**
- All four competencies explained using real project examples (delegation decisions, prompts/specifications, output evaluation, verification and accountability). Not a mandatory in-product 4D assessment feature.

## 5. Non-Goals (Explicit)

- **No native mobile delivery** — web-first only (C1); nothing implies an app store presence.
- **No public course catalog/marketplace** — instructor courses are enrollment-gated; no platform-wide public instructor courses.
- **No XP, rewards, streaks, hard prerequisite locks or cross-course mastery aggregation** — recommended order only (D1).
- **No certified, proctored or high-stakes assessment** — formative only; no credentialing claims (C6).
- **No email/SMS/push notifications** — in-app reminders only, capped at one consolidated reminder per local day (D6).
- **No OCR, archive unpacking or remote-URL import** — text-based PDF/DOCX/TXT/Markdown only (D5).
- **No real-data external processing before gates pass** — provider non-training + bounded/deletable-retention terms must be verified first (G2); standard API terms do not suffice.
- **No efficacy, retention, superiority or product–market-fit claims** — from the pilot or any planning artifact (C5/C6, AD-18).
- **No monetization, pricing or buyer decisions** — none selected; not this PRD's call.
- **No mandatory in-product 4D assessment** — FR-19 is a presentation deliverable.

## 6. MVP Scope

[ASSUMPTION: "MVP" is mapped to D7's first milestone under the initiative's delivery order; the full 22-FRD scope is retained per C3 and merely sequenced.]

### 6.1 In Scope

**Product (all of it, across six ordered epics — [tickets.toml](../tickets/tickets.toml)):** all FRs in §4; every FR has exactly one accountable epic: private setup (FR-2/7/21/22) → grounded mini-courses (FR-1/6/8/11/12) → assessment/progress (FR-10/13/14/20) → spaced review (FR-15) → instructor courses (FR-3/4/5/16) → breadth + 4D (FR-9/17/18/19).

**First delivery slice (MVP proper — D7 milestone 1):** the personal-material learning loop end-to-end: private upload → extraction preview → goal setup → confirmed plan → optional starting check → generated mini-course study → required tests → completion or targeted recovery, with consent/lifecycle controls. Instructor workflows, assignment breadth and integrated validation follow in D7 milestones 2–4 without being cancelled (C3).

### 6.2 Out of Scope for MVP

- Instructor authoring/enrollment/approval/reporting (FR-3/4/5/16) — milestone 2. *Deferred, not dropped (C3).*
- Full subject-area and format-family breadth including narration and isolated online coding (FR-9/17) — milestone 3; runner/narration feasibility (G4) precedes activation.
- Other-domain/self-directed generation beyond personal-study mechanics (FR-18) — milestone 3.
- Integrated validation pilot + 4D presentation (FR-19, D8) — milestone 4, only after D7 quality gates.
- Public/institutional deployment, multi-institution tenancy — not authorized at any milestone in this PRD.

## 7. Success Metrics

*Calibrated to C5/C6: one-participant validation can reveal workflow/content problems, not effectiveness or demand. [ASSUMPTION: the metrics below are this PRD's functional-verification proposals, not settled policy.]*

**Primary**
- **SM-1**: Pilot executed — the D8 one-participant pilot (unit-testing fundamentals, personal-upload journey) completes its three phases (baseline, first session against the ≤ 30-minute usability target, seven-day delayed check) with observations, friction and limitations recorded. Validates FR-1, FR-7, FR-8, FR-10, FR-11, FR-12, FR-13, FR-14, FR-15 (seven-day delayed check), FR-20, FR-21.
- **SM-2**: Boundaries hold — 100% of the integrated access/approval/lifecycle scenario suite passes: cross-learner upload isolation, enrolled-only access, unapproved-content unavailability (including fresh retests), consent-refusal, export/deletion and retention windows. Validates FR-2, FR-4, FR-5, FR-22.

**Secondary**
- **SM-3**: Breadth and grounding demonstrated — 3/3 subject areas and 6/6 activity format families show functioning representative activities (no placeholders), and at least one demonstrated supplementation case (identified external source, visible upload/reference conflict handling). Validates FR-6, FR-9, FR-17, FR-18.
- **SM-4**: Honest async behavior — zero instances in integrated checks of timeout-counts-as-success, double-counted retries, or retroactively revoked earned progress; every generation/extraction path completes or reports retryable failure with saved input by 120 seconds. Validates FR-1, FR-13, FR-14, FR-21.
- **SM-5**: Instructor arc + 4D deliverable — milestone-2 integrated checks demonstrate author → CSV import/enroll → exact-version approve → participation report end-to-end, and the final presentation explains all four AI Fluency competencies with project-specific examples. Validates FR-3, FR-4, FR-16, FR-19.

**Counter-metrics (do not optimize)**
- **SM-C1**: Session length / engagement time — must never be reported or treated as learning evidence; counterbalances SM-1's temptation to read activity as effect.
- **SM-C2**: Completion rate — must not be lifted by easing pass marks, rounding passes into existence, or auto-marking content complete; the 80% default and explicit-completion rules are fixed policy. Counterbalances SM-2/SM-4.
- **SM-C3**: Reminder volume — do not add channels or frequency to drive returns; the one-consolidated-reminder-per-day cap is a product promise, not an under-performing lever.

## 8. Constraints and Guardrails

### 8.1 Privacy, Data Governance and Trust Boundary *(D5; AD-3/AD-4/AD-10)*

- Identity is not authorization: every access is scope-checked server-side per operation; revocation (unenrollment, deletion) stops future reads immediately.
- Uploaded/retrieved/generated content can never authorize role changes, expose another person's data, or execute code outside the isolated activity environment.
- Data minimization: excerpts not whole libraries to providers; identifiers/rosters excluded where unnecessary; no training reuse.
- Retention: 7-day active-copy purge (including provider copies), 30-day backup expiry with pre-restore deletion replay, 30-day content-free operational-metadata expiry, 90-day post-archive instructor-course deletion with notice/export. Institutional deviations require explicit policy change. All are verification targets, not present compliance.
- Instructor accounts are provisioned, not self-serve: no self-enrollment or self-escalation to instructor/admin roles; administrative roles cannot browse course content; privileged operations are logged (D5).
- Account deletion does not silently delete legitimate instructor-course records; owner deletion propagates through the derivative registry with lineage fences (AD-4).

### 8.2 Safety and Content Integrity *(D4/D7; C4/C6)*

- Approval-before-exposure has no bypass: no generation-on-demand streaming to students, no unseen-output exemptions, no partial approval.
- Every cited factual claim, answer and rubric line in pilot/demo material is manually checked against its source; unsupported scored items cannot ship.
- Accessibility bar (D7): keyboard operable, named controls, visible focus, readable contrast, error/status feedback at 360-pixel and desktop widths without horizontal overflow; narration carries text equivalents; WCAG 2.2 AA is the target, not a certification claim.

### 8.3 Course and Evidence-Integrity Constraints *(C1–C6)*

- C1 web-first; C2 low-writing setup; C3 no silent scope-shedding of required subjects/formats/workflows; C4 no access/approval shortcuts during personalization/supplementation/tailored reassessment; C5 one-participant validation limits (no effectiveness/PMF inference); C6 formative scope, evidence separation, no retroactive revocation of earned passes/completion.

### 8.4 Why Now *(context, not a requirements source)*

LLM tutoring now has randomized-trial-level learning-gain evidence (Harvard physics RCT, 2025), grounded generation over uploaded sources is a mature consumer pattern (NotebookLM-class), and inference costs keep falling — making per-learner mini-course generation plausible at course-project scale. Meanwhile the 2025 landscape shows the failure modes this PRD guards against: consumer AI tutors get discontinued (Quizlet Q-Chat, 2025), engagement-first AI draws trust backlash (Duolingo, 2025), and student-facing hallucination remains documented — which is exactly why instructor exact-version approval (FR-5) and source grounding (FR-6) are non-negotiable. [ASSUMPTION: positioning synthesis from the 2026-10-21 landscape digest (addendum §A); per C5 it establishes no unique-feature advantage.]

## 9. Cross-Cutting NFRs

- **Attempt immutability & monotonic progress:** attempts snapshot policy/content versions at start; earned passes/completion are never revoked by later edits, disputes or review failures (AD-5/AD-8).
- **Honest asynchronous behavior:** every long operation (extraction, generation, import, export) shows progress and by 120 seconds completes or reports retryable failure/pending with saved input; timeout never means success; retries never double-count (AD-9).
- **Scoped authorization:** per-operation server-side scope checks; authorization epochs invalidate stale access (AD-3).
- **Fail-closed integrations:** missing consent, provider-policy, sandboxing or limits evidence blocks the capability rather than degrading to an unsafe fallback (AD-10/AD-11/AD-18).
- **Accessibility:** §8.2 bar applies product-wide (AD-12/AD-18).
- **Performance/cost/load budgets:** deliberately unset — measurable budgets are a G6 implementation-evidence gate, not a planning invention. `[NOTE FOR PM: numbers must come from measured evidence before pilot.]`

## 10. Open Questions

1. **Provider verification (G2):** which AI provider actually meets non-training + bounded/deletable retention on verified terms? Blocks all real-data processing; standard Anthropic/API retention terms do not pass D5.
2. **Runtime security recheck (G1):** Node's pending security release must be rechecked and the lockfile compiled/linted together before broader use (accepted risk for local development only, 2026-10-21).
3. **Narration + isolated coding feasibility (G4):** offline narration engine/voice licensing and quality; isolated runner proof (no egress/secrets, escape/cleanup tests) before FR-17 activation; narration stays offline by default until gated online (AD-12).
4. **Pilot fixture rights (D8):** exact licensed unit-testing fixture and reference rubric must be verified before pilot execution.
5. **Epic refinement (initiative execution-readiness gate):** five of six epics remain unrefined; story-level planning precedes their execution.
6. **Institutional retention deviations:** if any future institution imposes different retention, an explicit policy change is required (D5 default stands until then).
7. **Naming/branding:** working title only.

## 11. Release Gates (not claims)

This PRD's numbers are acceptance targets. D7's quality gates (access/approval, content/assessment manual checks, usability bar) and G1–G6 feasibility gates precede the pilot; independent review of completed stories is part of the workflow. Nothing here reports Story/F1 readiness, closes the accepted runtime-security exception, or authorizes release.

## 12. Assumptions Index

- §Title — "AI Learning Platform" is a descriptive working title; no branding decision.
- §2.2 — Non-user list (v1) is this PRD's synthesis, not a settled decision.
- §2.3 — UJ protagonists (Wei, Aditi, Lars, Prof. Chen, Yusuf) are illustrative composites invented for this PRD.
- §6 — Mapping "MVP" to D7 milestone 1 (personal loop first) is this PRD's framing of the settled delivery order.
- §7 — SM framing, SM-5 and any targets beyond settled policy are proposals; counter-metrics likewise.
- §8.4 — Why-Now positioning synthesized from the 2026-10-21 landscape digest; establishes no advantage claim (C5).
