---
name: Fieldnotes
description: Product-wide experience spine for the AI learning platform — IA across personal study and instructor surfaces, honest-state patterns, interaction and accessibility floor, key journeys.
status: final
created: 2026-10-21
updated: 2026-10-22
sources:
  - ../initiative-ai-learning-platform.md
  - ../tickets/epic-private-study-setup/setup-experience.md
  - ../product-policies.md
  - ../tickets/epic-grounded-mini-courses/epic-grounded-mini-courses.md
  - ../tickets/epic-assessment-and-progress/epic-assessment-and-progress.md
  - ../tickets/epic-spaced-review/epic-spaced-review.md
  - ../tickets/epic-instructor-courses/epic-instructor-courses.md
  - ../tickets/epic-subject-and-activity-breadth/epic-subject-and-activity-breadth.md
---

# Fieldnotes — Experience Spine

## Foundation

Responsive **web-first** product (initiative C1): the same honest surface from a 360px phone to a desktop workspace. No component library is named — the implementation is hand-rolled CSS on a Tailwind base with CSS Modules (decided 2026-10-21; matches current code, revisit only if a library is adopted). `DESIGN.md` (Fieldnotes visual identity) is the visual reference; this spine owns behavior. Three product-wide invariants govern every surface:

- **State identity is honest.** The UI displays server-authoritative operation and revision state. A spinner, elapsed time, completed upload transfer, or accepted request is never shown as successful extraction/generation/confirmation; unsaved edits are never reported saved; timeout never means success (by 120 seconds the state is complete, honest pending, or a retryable failure with saved input — D7).
- **Provenance is visible.** Manual work is labeled Manual; AI-generated or unreviewed material is identified as such; instructor-facing content never reaches learners without exact-version approval (R5/D4); sample/test-mode surfaces keep their badge visible at all times.
- **No engagement theater.** No XP, streaks, locks or celebration (R20/D1). Completion, recovery credit and review are states, not rewards; evidence kinds (unaided, assisted, self-report, engagement) are never conflated (D2).

Accessibility floor and keyboard behavior are product-wide (see Accessibility Floor), inherited from the epic-1 UX contract's shared rules.

## Information Architecture

Two role shells over one platform. Personal study is the primary surface (D7 order); the instructor studio is a separate shell with its own navigation, not a mode toggle. Accounts are operator-provisioned (epic 1 assumption) — no public sign-up surface exists.

| Surface | Reached from | Purpose |
|---|---|---|
| Sign in | App open, expired session | Single entry; no role choice, no public content (U0) |
| Library | Sign in / primary nav | Personal study list: drafts, confirmed plans, processing, deleted receipts; entry to each study (U1) |
| New study — Materials | Library "Start a study plan" | Four-format bounded upload, per-file preview, acknowledgment (U2) |
| New study — Goal & plan | Materials | Four goal routes, corrected topic, editable plan, exact confirmation (U4/U5) |
| Optional starting check | Confirmed plan | 3–5 item diagnostic, equally visible skip (U6) |
| Mini-course player | Roadmap node | Lessons and content items across format families (R9/R17); why-explorer (R11) |
| Practice & recall | Lesson / roadmap | Attempt-before-answer retrieval practice (R12) |
| Test & recovery | Roadmap node / guidance | Scored attempts, threshold shown up front, targeted retest (R13/R14) |
| Roadmap | Library → study | Whole-mini-course nodes: Not started / In progress / Completed + Needs practice / Review due indicators, free browsing, no locks (R20/D1) |
| Review inbox | Primary nav badge | Due/overdue reviews, consolidated daily reminder, controls (R15/D6) |
| Why-explorer | Lesson content | Successive deeper explanations, honest stopping (R11/D4) |
| Privacy & data | Settings | Consent status, timezone & reminder controls, export, deletion (U3/U7/U8, R22) |
| Instructor — Courses | Instructor shell | Course list, authoring (manual + AI), drafts and versions (R3) |
| Instructor — Approvals | Course editor | Exact-version inspection and approval queue; pending generated content (R5/D4) |
| Instructor — Students | Course editor | CSV import preview/confirm, enrollment management, revocation (R4/D5) |
| Instructor — Participation | Course | Scoped report: progress, attempts/recovery, due reviews (R16/D6) |

Admin capability is an operational role without a content-browsing surface (D5); the learner never sees instructor surfaces and vice versa. Navigation mirrors the prototype: tracked-overline nav groups, numbered lesson sequence, sticky sidebar collapsing to a top nav under 850px.

→ Composition reference: `mockups/key-review-inbox.html` (review inbox — canonical, paused, empty), `mockups/key-instructor-approvals.html` (approval inspector + the learner's pending view). Spine wins on conflict.

## Voice and Tone

Microcopy. Brand voice lives in `DESIGN.md.Brand & Style`.

| Do | Don't |
|---|---|
| "Plan confirmed — course not generated." | "Your course is ready! 🎉" |
| "Extraction canceled; original saved." | "Operation aborted." |
| "Needs practice" (observed difficulty, cause unnamed) | "You're weak at this" / "forgotten!" |
| "AI processing is unavailable under the current privacy policy." | "AI is disabled." |
| "79.96% — Not passed (mark is 80%)" | "80.0% (rounded) — nearly there!" |
| "Pending instructor approval" | Showing generated content as final |
| Manual labels on learner-authored plans | Passing manual work off as AI output |
| One consolidated reminder per local day | Streak nudges, "don't break the chain", urgency counters |

Honest uncertainty is the house style: unknown objectives read "Unknown", not "Weak" (D2); conflicting sources are shown side by side, never silently resolved (D4); evidence limits are stated where the evidence runs out. Internal vocabulary stays internal: an operation id appears only in parentheses after a plain sentence ("Still processing — you can return later. Reference 4f2c…"), and the quarantined/extracting state reads "Checking this file safely" to the learner while "Quarantined" remains the internal state name.

## Component Patterns

Behavioral. Visual specs live in `DESIGN.md.Components`.

| Component | Use | Behavioral rules | Visual (DESIGN.md) |
|---|---|---|---|
| Extraction slot row | Materials (U2) | Per-file state machine: awaiting-upload → uploading → queued/extracting → preview \| failed(reason) \| canceled. Remove/replace/retry per slot; the eleventh file is rejected before generation; count/bytes revalidated server-side. | Row in `{components.panel}`; status `{components.pill}`; actions `{components.button-secondary}` |
| Preview panel | Materials | Fetches per-slot extracted text + warnings + locations on demand; acknowledgment checkbox pins the exact extraction revision; partial extraction is never described as complete. | `{components.panel}`; text in `{components.code-block}` typography |
| Plan editor | Goal & plan (U5) | Edits create unconfirmed drafts; confirmation freezes plan + selected source revisions; conflicting revision → actionable conflict with saved input; double-confirm returns one receipt. | `{components.panel}` + form fields; confirm `{components.button-primary}` |
| Roadmap node | Roadmap (R20) | Whole-mini-course status + separate Needs practice / Review due pills; recommended order shown, browsing free, no locks; completion never revoked by a later review failure (D1). | `{components.roadmap-node}` + `{components.pill}` |
| Content-item tracker | Lesson | Explicit mark-done per required item and required activity submission; optional enrichment labeled and never blocking (D1). | `{components.panel}` rows; hairline separators |
| Recall card | Practice (R12) | Withholds answer/rationale until submission; assisted practice is separately labeled from unaided evidence. | `{components.panel}`; answer `{components.answer-option}`; result `{components.feedback}` |
| Test attempt view | Test (R13) | Shows threshold, available points and rubric before start; snapshots versions at attempt start; one decimal display with explicit Pass/Not passed from unrounded comparison (D3). | `{components.answer-option}`; rules `{components.callout}` |
| Recovery path | Failed test (R14) | Lists still-failed objective groups; focused review then fresh same-demand retest per group; original score preserved and shown beside recovery credit — never merged. | `{components.panel}`; guidance `{components.callout}` |
| Review row | Review inbox (R15) | Due date by local calendar day, overdue aggregation; interval heuristic visible (1/3/7/14/30), not presented as settled science (D6). Snooze (until tomorrow / 3 days) is row-scoped and names its target ("Snooze 'Unit testing fundamentals' until tomorrow"); Pause and Disable reminders are inbox-wide controls kept in their own section. Announcement and focus after any control or row change follow Interaction Primitives, focus choreography. → `mockups/key-review-inbox.html` (its shared control block is illustrative; this row-scoped rule wins) | `{components.panel}` rows; due `{components.pill}` |
| Why-stepper | Lesson (R11) | "Go deeper" requests next depth; stop control always visible; states uncertainty when evidence is exhausted. | `{components.callout}`; `{components.button-secondary}` |
| Consent panel | Privacy (U3) | Provider/purpose/categories/retention disclosure revision; Allow / Not now — never preselected; withdrawal stops future processing and explains that prior processing can't be undone. | `{components.panel}`; disclosure `{components.callout}` |
| Approval inspector | Instructor approvals (R5) | Side-by-side exact-version inspection; approver/time/version recorded; fresh generated items enter a pending queue. The inspection gate is explicit: a per-bundle "I have inspected these exact versions" checkbox (keyboard-operable, announced on toggle) enables Approve exact versions, and the covered-versions sentence is programmatically tied to the button; batch approval covers only listed, inspected versions. → `mockups/key-instructor-approvals.html` (its always-enabled Approve is illustrative; the gate rule wins) | `{components.panel}` split columns; approve `{components.button-primary}`; gate checkbox `{components.input}` |
| CSV import preview | Instructor students (R4) | Row errors/duplicates shown before confirmation; invite-then-verify enrollment; removal ends access and reminders immediately. | `{components.panel}`; errors `{components.notice}` |
| Participation row | Instructor report (R16) | Learner, last activity, required-item completion, attempt/pass/recovery status, due reviews; active-time shown only as a labeled estimate; no personal-upload visibility. | `{components.panel}`; `{components.evidence-meter}` |
| Deletion flow | Privacy (U8) | Scope preview by category, cancel-safe confirmation, protective denial immediate, content-free receipt with purge status/deadlines. | Danger zone + `{components.button-danger}`; receipt `{components.panel}` |
| Export flow | Privacy (U7) | Scope preview → queued/running/ready/failed/expired; authenticated download, ≤24h expiry, regenerate after expiry. | `{components.panel}`; status `{components.pill}` |
| Form field | Every form (setup, consent, plan, import) | Label above field, required state in words; validation shows an error summary first, then focuses the first invalid field; saved/unsaved status is text; file picker is keyboard-operable; credential fields accept paste and password-manager autofill. | `{components.input}`; errors `{components.notice}` |
| Feedback block | Practice, test result, review result | Appears only after submission; states correctness, rationale, source and the evidence kind (unaided / assisted); never before the attempt is submitted. | `{components.feedback}` |
| Hero | Library welcome, lesson opener | At most one per view; carries the view's single most important state in words (e.g. what is due, what is confirmed); any focusable inside it uses the lime focus ring. | `{components.hero}` |
| Sample badge | Any sample / test-mode surface | Always visible while the surface shows synthetic or test-mode content; never hidden by scroll or collapse; text reads "Sample content" or "Test mode", not a logo. | `{components.sample-badge}` |
| Lime action | Sample / demo entry points only | `button-lime` is not a product-flow primary; it marks entry into sample or demo material. Product flows use `button-primary`. | `{components.button-lime}` |

Activity-family shells (simulation, role play/mock interview, mini-game, narrated animation/slides, online coding — R17) are lesson content variants inside the player. Their interaction design is deferred to epic 6 refinement (see Decisions and Open Questions); until then each family inherits three rules: the lesson shell and content-item tracker, the honest-unavailable state (a disabled action explains the capability is unavailable in this release, never implying a queued job), and the media floor (no autoplay, visible pause/stop, transcript, adjustable rate).

## State Patterns

Setup states (U0–U8) are specified in the epic-1 UX contract and remain binding; product-wide additions:

| State | Surface | Treatment |
|---|---|---|
| Processing ≥120 s | Any generation/extraction | "Still processing" with operation id, or retryable failure with saved input; never success-by-timeout (D7). |
| Pass-mark boundary | Test result | Unrounded comparison decides; display one decimal + explicit Pass/Not passed; 79.96% does not pass 80% (D3). |
| Provisional grade | Instructor-course AI grading | Labeled Provisional until instructor confirms; cannot award completion while pending (D3). |
| Item under review | Disputed question | Marked Under review; pending/unearned decisions pause, earned passes/completion never revoked (D3). |
| Partial recovery | Test recovery | Per-target-group pass/fail; uncleared targets keep the failed-test requirement unsatisfied; passed sections never repeated (D3/R14). |
| Version superseded | Roadmap / plan | Learner stays on the studied version until explicitly switching; changed required work is shown before switching (D1). |
| AI unavailable / declined | Anywhere AI is offered | Manual path preserved and equally surfaced; no external call; saved work intact (U3). |
| Pending approval | Instructor course learner view | Existing approved material or honest "Pending instructor approval"; no generation-on-demand bypass (D4). |
| Review overdue | Review inbox | Consolidated into the daily reminder; snooze changes timing, not evidence; no backlog burst on resume (D6). |
| Reminders paused | Review inbox | Due list still renders honestly; Resume is the single primary action; snooze controls disabled; resuming creates no backlog burst (D6). |
| No time limits | Any learner task | No learner-facing task is time-limited — no timed tests, no idle countdowns. The 120-second rule is a system honesty deadline, not a user time limit, so no extend/turn-off mechanism is required (2.2.1). |
| Session expiry / role change | Everywhere | Private UI cleared immediately; re-auth reloads only authorized saved data; no previous user's draft. Before a session expires with unsaved in-memory edits, the user is warned and offered the choice to save or continue; where memory-only storage applies, the expiry screen says plainly that unsaved edits could not be kept. |
| Loading / load failed | Every surface | Wait / Retry with safe navigation retained; no stale content from another session rendered while loading. |
| Empty surface | Library, roadmap, review inbox, report, approvals | States the honest truth and one primary action: empty library explains private ownership; "Plan confirmed — course not generated" on an ungenerated roadmap; "No reviews due"; empty course invites the first import; an empty approval queue reads "Nothing pending approval" — an inspected-all state, not an error. No invented progress. |
| Offline / request failed | Everywhere | Honest error with saved input and retry; no optimistic success states; the due list and study pages render last authorized server state without claiming fresh data. |
| Cross-owner / revoked / forbidden access | Any direct access | "This item is unavailable" + safe link; no existence/owner/content leak (U0, R2) — the same treatment for another learner, an instructor, an ordinary admin, a revoked session, or a missing item. |
| Format / capability unavailable | Lesson activity families | Disabled action explains the capability is unavailable in this release; never implies a queued job or coming-so-soon promise (R17). |

## Interaction Primitives

- Keyboard-complete: every flow operable by keyboard, including file selection; visible focus is the olive ring (`DESIGN.md` focus-ring; lime on ink surfaces) on every interactive element. A skip-to-content link is the first focusable element on every screen, visible on focus.
- Focus choreography: after explicit navigation, focus moves to the next stage's heading; dialog cancel returns focus to the opener; post-deletion focus lands on the receipt heading. After a list row is removed or replaced (extraction slot, CSV preview row, export, review), focus moves to the same position in the updated list — the next row's primary control, or the list's primary action/heading when the list is now empty — and the removal is announced politely. Polling and background refresh never steal focus or interrupt typing.
- Dialogs: Esc closes as cancel, never as confirm; Tab and Shift+Tab cycle within the open dialog; opening moves focus to the dialog heading; cancel or backdrop closes and returns focus to the opener; destructive dialogs give initial focus to the cancel-safe action; background content is inert while a dialog is open; dialogs stack one level deep, never two.
- Duplicate-click and reconnect safety: commands carry operation/idempotency keys; one committed result, no double counts (retrying never double-counts scores/progress — D7).
- Minimum targets 44px (64px answer rows); no hover-only affordances below 850px; `prefers-reduced-motion` disables all animation/transition.
- Reminders are in-app only (D6): badge + due list; no email/SMS/push surfaces exist in this product.
- Destructive actions sit in a separated danger zone with explicit confirm; cancel is the safe default; nothing destructive is prechecked.

## Accessibility Floor

Behavioral. Visual contrast lives in `DESIGN.md`.

- WCAG 2.2 AA is the implementation target (D7), not a certification claim; core flows work by keyboard with named controls, visible focus, and error/status feedback at 360px and desktop without page-level horizontal overflow.
- Semantic headings and labels; text-plus-status announcements via live regions; status changes announce (extraction state, save status, review due, snooze/pause results) without focus movement. Meters and progress indicators carry a programmatic accessible name, not just adjacent words.
- Narrated animations and slides never autoplay; each has a visible pause/stop control, an adjustable playback rate, and a text transcript reachable from the same content item; motion is never required to access teaching content (D7). Responsive text scales without truncating controls, and controls and text containers tolerate user text-spacing overrides (1.4.12) without clipping or overlap.
- Sign-in and re-authentication: credential fields accept pasted input and password-manager autofill; no memorization or transcription puzzle is ever required (3.3.8).
- Help is consistent (3.2.6): every screen ends with the same footer in the same order — operator contact for account/recovery and "Report a problem" — so a learner never has to hunt for it.
- Evidence and assessment language is itself an accessibility concern: uncertainty is stated, not hidden behind iconography or color alone.

## Responsive & Platform

| Breakpoint | Behavior |
|---|---|
| ≥1700px | Content cap holds (1400px), extra breathing room above |
| 1100–1699px | Sidebar narrows; two-column article grids compress |
| 850–1099px | Sidebar becomes top navigation; grids stay two-column where ≥1.5fr |
| 600–849px | Single column; nav collapses to a wrapped 4-up row; aside content reflows above/below |
| ≤600px (360px floor) | One column, mobile margins, no horizontal scroll; dense tables re-flow to stacked rows |

The product is responsive web; no native shell is implied (C1).

## Inspiration & Anti-patterns

- **Lifted — the field-journal metaphor (prototype):** observe–note–revisit; quiet paper surfaces; the notebook aside and promise callout as recurring furniture.
- **Lifted — honest state identity (epic-1 UX contract):** server-authoritative states, no false extraction-ready messages; generalized here to every generation, grading and approval surface.
- **Lifted — transparent spaced repetition (Anki-style, via D6):** intervals are visible and editable-feeling (snooze/pause/disable), not a hidden algorithm; the heuristic is stated as a heuristic.
- **Rejected — gamification (Duolingo-pattern):** no XP, streaks, lives or celebration; the initiative bans locks and rewards by design (R20/D1). Progress is informational, not coercive.
- **Rejected — dark consent patterns:** no preselected checkboxes, no bundled consent, no "just this once" nags; refusal keeps full manual capability (U3/D5).
- **Rejected — engagement-pressure reporting:** instructor reports show activity and evidence, never "at-risk" shaming labels; active time is a labeled estimate (D6).
- **Rejected — completion theater:** reading is not passing; assisted is not unaided; self-report awards nothing (D1–D3). The UI never renders a combination the evidence rules forbid.

## Key Flows

### Flow 1 — First study cycle (Wen, marketing year-2, non-CS, evening, phone then laptop)

1. Wen signs in (U0) and sees an empty Library explaining private ownership — no invented progress.
2. She uploads lecture notes (PDF + MD); per-file previews show extracted text and warnings; she acknowledges two of three files after replacing the corrupt one (U2).
3. Goal route "Understand a topic", topic corrected, short plan confirmed (U4/U5); the optional starting check is equally skippable — she skips (U6); objectives stay Unknown.
4. Over the week she completes the mini-course's required items and practice; recall cards withhold answers until she submits (R12); the roadmap node moves Not started → In progress → **Completed** when the last required test passes at 82% (R13/R20).
5. **Climax:** the next evening, one consolidated reminder lists the unit-testing review due today (R15). She completes it unaided; the next interval (3 days) is shown plainly. No confetti — the node simply reads Completed · Review due 3 days. A little more understood.

Failure beats along the way: extraction fails on the corrupt file → honest reason, saved input, replace path (never partial-as-complete); test 68% → Flow 2.

### Flow 2 — Targeted recovery (Kai, CS graduate, preparing for AI-era interviews)

1. Kai fails a mini-course test at 68% (mark 80%): result shows one decimal, unrounded comparison, per-objective breakdown (R13).
2. Guidance names the still-failed objective groups — "Needs practice", cause unnamed — and links each to its evidence (R10/D2).
3. He takes focused review for the two failed groups, then a fresh retest covering only those groups at the same demand (R14).
4. One group clears at 90%; the other at 76% stays unsatisfied — the failed-test requirement remains honestly open.
5. **Climax:** after the second retest clears it, the requirement reads satisfied with *both* truths visible: original 68% preserved, recovery credit listed separately — passed sections were never repeated, and no invented "new score" replaced history (D3).

Failure beat: a disputed question is flagged → item marked Under review, his pending completion decision pauses, his earned passes untouched (D3).

### Flow 3 — Instructor course with exact-version approval (Dr. Lam, course instructor)

1. Dr. Lam imports a 40-student CSV; the preview surfaces two duplicate rows and one malformed email before anything is committed (R4/D5).
2. He generates a draft mini-course with AI, edits two lessons manually, then opens the approval inspector: lesson versions, supplementary sources, and the question/answer/rubric/feedback bundle, side by side (R3/R5).
3. He approves the exact versions; approver, time and versions are recorded (D4).
4. A learner later triggers a tailored retest: it assembles from the approved bank; a newly generated feedback variant lands in the pending queue — enrolled students see approved material or "Pending instructor approval", never unseen output (R5/D4).
5. **Climax:** he withdraws one defective published item: new use stops instantly, affected pending evidence pauses for correction, every already-earned pass stands — and the participation report shows him exactly this: who recovered, who's due for review — and no one's private uploads (R16/D3).

Failure beat: a second instructor's attempt to open the course → "This item is unavailable"; cross-course rosters never render.

### Flow 4 — Consent declined (Priya, privacy-cautious learner)

1. Priya's plan setup offers AI processing; the disclosure names provider, purpose, categories, retention (U3).
2. She chooses Not now — nothing is dispatched; manual topic/plan editing remains fully available (R22).
3. **Climax:** her manual plan confirms with a Manual label and identical roadmap behavior — the product never punishes refusal with reduced learning capability, only honestly absent AI features.

### Flow 5 — Going deeper and off-syllabus (Kai, weekend, laptop)

1. In a lesson on unit-test doubles, Kai asks "Why does this mock leak into my real test?" — the why-stepper adds one depth: purpose, assumption, trade-off, each tied to its source (R11/D4). The same objective Wen met as a worked example is pitched to Kai as a trade-off discussion — background adaptation without changing what the objective requires (R8).
2. His uploaded notes never explain fakes vs stubs; the lesson fills the gap with an identified supplement — source name, location, and an explicit "supplement" badge distinguishing it from his own material — and shows one conflicting claim beside the upload's own statement rather than silently resolving it (R6/D4).
3. He asks for a third depth; the interface states the evidence is exhausted and stops — no invented root cause (D4).
4. He switches to a self-directed path outside the syllabus: topic "binomial confidence intervals," goal Apply a skill; the same setup → plan → confirm loop generates a personal mini-course in the other domain (R18).
5. **Climax:** the same calm loop carried him from a mock-leak question to a new domain without ever being told he "mastered" anything — the roadmap shows two paths, one Completed, one In progress, and the explanations he read are labeled AI-generated with their sources one tap away.

### Requirement coverage

- Flow 1 — R1, R7, R12, R13, R15, R20, R21
- Flow 2 — R10, R13, R14
- Flow 3 — R3, R4, R5, R16
- Flow 4 — R22
- Flow 5 — R6, R8, R11, R18
- R2 (private uploads) — Flow 3's failure beat and the "Cross-owner / revoked / forbidden access" state row, rather than a learner-side flow beat
- R8 — the Wen/Kai protagonist split across Flows 1 and 2, plus the adaptation clause in Flow 5
- R9, R17 — content/format coverage owned by the lesson shells and trackers in Component Patterns, not separate journeys
- R19 — a presentation deliverable, not a product surface

## Decisions and Open Questions

Decided 2026-10-21 (user accepted the drafted assumptions):

- Light mode only; dark tokens deferred until a real need is named (DESIGN.md).
- English-only interface; zh-HK / bilingual surfaces are not designed in this release. This is recorded as a named accessibility risk for Cantonese-first learners, not only a scope choice; revisit trigger: pilot feedback. Microcopy stays short and jargon-free in the meantime.
- Brand name "Fieldnotes" and tagline extend product-wide from the approved prototype.
- No UI component library; hand-rolled CSS remains the system.
- Lime means attention/live; olive means selection/confirmed (DESIGN.md Colors).
- Control boundaries meet 3:1 non-text contrast: `input-border` darkened from the prototype; `input-border-soft` is decorative only; the focus ring is lime on ink surfaces (accessibility review, 2026-10-21).
- A consistent help footer (operator contact, "Report a problem") is present on every screen; no dedicated help centre exists in this release.

Deferred:

- Activity-family interaction design (simulation, role play/mock interview, mini-game, narrated animation/slides, online coding — R17) is deferred to epic 6 refinement; until then the three inherited rules in Component Patterns apply. Nothing in this spine should be read as a per-family interaction contract.

Open:

- Notification posture beyond in-app is explicitly none for now (D6); revisit only with a policy change.
- Instructor-shell information architecture detail — epic 5 is unrefined; refine this spine's instructor sections when epic 5 is refined.
- Exact roadmap node copy and indicator wording beyond D1's three states + two indicators remain to be specified.
