# Accessibility Review

Reviewer scope: DESIGN.md + EXPERIENCE.md spine pair, `mockups/key-review-inbox.html`, `mockups/key-instructor-approvals.html`, with the epic-1 shared interaction rules (`../tickets/epic-private-study-setup/setup-experience.md` § Shared interaction and acceptance rules) as the promised floor. Inspection only. All contrast claims were re-computed from the token hex values using the WCAG relative-luminance formula. WCAG 2.2 AA is treated as the stated implementation target, not a certification claim, per the spine's own wording.

## Overall verdict

**Strong — usable as an implementation contract after the two high findings are fixed; no critical blockers.** This is a well-above-average accessibility posture for a UX spine: every one of the 16 measured contrast ratios in DESIGN.md is accurate (re-computed, all within rounding); the keyboard-complete, file-selection-by-keyboard, and 44px-target commitments are explicit; the three-rule focus choreography (stage heading, dialog-opener return, post-deletion receipt) is specific; state is never conveyed by color or icon alone (text+status is a Do/Don't row, a component rule, and a floor line); meters keep native semantics with words; `prefers-reduced-motion` disables all animation; no dragging motions exist anywhere (file intake is explicitly "Choose files or keyboard file picker"); and redundant entry (3.3.7) is satisfied by construction — back-navigation preserves server-saved work, the timezone is detected and correctable, topics are confirmed rather than retyped. The honest-state microcopy ("No reviews due", "Still processing", "Pending instructor approval") is itself an accessibility feature: uncertainty is stated in words, never hidden behind iconography.

The gaps are additive, not contradictory: the contract under-specifies dialog keyboard mechanics, omits the non-text contrast dimension (1.4.11) entirely from its measured table, and leaves several focus/announcement edges (list-row removal, media controls, skip link, ink-surface focus indication) to implementer invention. The two mocks honor the token floor faithfully but introduce landmark errors and one real spine divergence (shared snooze/pause controls detached from review rows).

Area-by-area clean results: 2.5.8 target size (44px buttons/links/nav, 64px answer rows — nothing interactive is smaller); 2.5.7 dragging (none); 3.3.7 redundant entry (satisfied, see above); 360px reflow commitment present with table re-flow rule (code-block horizontal scroll is the legitimate 1.4.10 exception and is not page-level); all mock text pairings resolve to tabled values except one, which passes anyway (finding 10).

## Findings

### 1. Dialog keyboard contract is unspecified (Esc, focus containment, initial focus)

- **Severity:** high
- **Location:** EXPERIENCE.md › Interaction Primitives; setup-experience.md › Shared interaction and acceptance rules
- **Evidence:** Both spines commit "keyboard-complete" and give exactly three focus-choreography rules. Dialogs are implied in several load-bearing places — "dialog cancel returns focus to the opener" (EXPERIENCE), the deletion flow's "cancel-safe confirmation" with danger-zone confirm, the U5 revision-conflict "Compare/reload latest saved version, then reapply edits", and the mixed-batch "explicitly continue with successful selection". Nowhere is stated: that Esc closes a dialog as cancel, that Tab/Shift+Tab are contained within an open dialog, where focus lands when a dialog opens (heading vs first control), `aria-modal`/inert-background expectations, or what happens to an in-progress form on backdrop click. Focus management in dialogs is the single most common downstream keyboard/AT failure, and the contract's silence invites divergent per-screen implementations.
- *Fix:* Add a dialog primitive to EXPERIENCE.md › Interaction Primitives: "Dialogs: Esc closes as cancel (never as confirm); Tab cycles within the dialog; opening moves focus to the dialog heading; cancel/backdrop closes and returns focus to the opener (as already promised); destructive dialogs focus the cancel-safe action; background content is inert while open."

### 2. Non-text contrast (1.4.11) is absent from the measured table, and control-boundary tokens fail 3:1

- **Severity:** high
- **Location:** DESIGN.md › Colors ("Contrast (measured, WCAG 2.2)" paragraph) and token definitions `input-border`, `input-border-soft`; used by `{components.answer-option}` border and field edges
- **Evidence:** The measured table covers only text-on-background pairings and then claims completeness ("Every text pairing meets AA for normal text"). 1.4.11 requires 3:1 for visual information that identifies UI components and states. Recomputed: `input-border` #89998e on surface #fffefa = **2.97:1** (marginally failing for field boundaries); `input-border-soft` #aab79e on surface = **2.09:1**, and this token is the *unselected answer-option border* — answer rows sit on a surface panel whose background equals the row's own background (surface vs paper ≈ 1.08:1), so the 2.09:1 border is the only boundary cue delimiting the interactive region of every assessment option. The selected state is fine (2px olive, 6.1:1) but the resting state of the product's most-used interactive control fails the non-text floor. (`disabled-border` at 2.11:1 is exempt — inactive components — and the spine honestly says so for disabled text.)
- *Fix:* Add a non-text column to the contrast table (field edges, option borders, focus ring, meter fill vs track, separators marked decorative). Darken `input-border-soft` for interactive boundaries to ≥3:1 on surface (e.g., a step toward `input-border`, then re-measure both), or give answer options a second identification cue (tonal fill ≥3:1 difference) so the border is not load-bearing.

### 3. Universal olive focus ring fails 3:1 on ink surfaces

- **Severity:** medium
- **Location:** DESIGN.md › Components › focus-ring ("everywhere, no exceptions"); EXPERIENCE.md › Interaction Primitives; hero/code-block components create ink surfaces
- **Evidence:** Recomputed: olive #486600 on ink #193c36 = **1.82:1**. The ring is 3px with a 4px offset, so it sits in the *surrounding* background — fine on paper (6.11:1), surface (6.55:1) and soft (5.73:1). But "no exceptions, including custom controls" means any focusable element placed on an ink background — a link or button inside a hero panel, or a future focusable inside a code block — gets an effectively invisible ring. The mocks happen to contain no focusables on ink, which is why this hasn't been seen yet; the spec as written guarantees a failure the moment one is added.
- *Fix:* Amend the focus-ring component: "on ink surfaces the ring is lime (lime/ink 9.1:1); olive ring on light surfaces only." State both pairings in the contrast table's non-text section.

### 4. Review-row controls are not associated with their rows (mock diverges from spine)

- **Severity:** medium
- **Location:** mockups/key-review-inbox.html (both canonical and paused frames, `.rowControls`); EXPERIENCE.md › Component Patterns › "Review row" ("pause/snooze/disable controls" — row-scoped)
- **Evidence:** The spine defines snooze/pause/disable as *Review row* controls, but the mock renders one shared control block under the whole list ("Snooze until tomorrow", "Snooze 3 days", "Pause reminders") with no indication of which review a press applies to. For a screen-reader user tabbing to "Snooze until tomorrow" after three rows, and equally for a sighted user, the target of the action is ambiguous. The post-action state change (which row moved where) is also not shown, and the floor's "review due ... announcements" does not cover the snooze/pause result announcement.
- *Fix:* Either move the controls into each row (matching the spine) or name them per target ("Snooze 'Unit testing fundamentals' until tomorrow"); make the frame caption or the spine state that a snooze/pause result is announced via the live region without focus movement, and which heading/row receives focus after the list changes.

### 5. No focus-destination rule after removing a list item

- **Severity:** medium
- **Location:** EXPERIENCE.md › Interaction Primitives / Component Patterns (Extraction slot row "Remove/replace/retry per slot"; CSV import; export flows); setup-experience.md Shared rules
- **Evidence:** The choreography rules cover dialog-cancel return and post-*deletion* focus on the receipt heading, but the product has several mid-list removals that delete a row without any dialog or receipt: removing or replacing a failed extraction slot, removing a row from the CSV import preview, an export leaving the list. In each case, focus after the row disappears is unspecified — the classic "focus resets to document start / is lost" failure for keyboard and AT users.
- *Fix:* Extend the focus-choreography rule: "after a row is removed or replaced, focus moves to the same position in the updated list (next row's primary control, or the list's add/primary action if the list is now empty) and the removal is announced politely."

### 6. Narrated animation media controls are not committed (autoplay, pause, rate)

- **Severity:** medium
- **Location:** EXPERIENCE.md › Accessibility Floor ("Narrated learning includes text equivalents; motion is never required to access teaching content"); requirement R17 activity families
- **Evidence:** Text equivalents are committed (good, and stronger than most specs), and the why-stepper has an always-visible stop control. But for the narrated-animation/slide family (R17) the floor says nothing about: playback being user-initiated (no autoplay), a pause/stop control during playback, retriggering, or playback-rate control. Media that autoplays or cannot be paused fails 1.4.2/2.2.2 expectations and disproportionately harms AT users who need to pause while a screen reader speaks. `prefers-reduced-motion` "disables all animation/transition" does not clearly cover pausing narrated *content* media, only UI motion.
- *Fix:* Extend the floor line: "Narrated animations and slides never autoplay; each has visible pause/stop and a text transcript; playback rate is adjustable; transcripts are reachable from the same content item."

### 7. No skip-to-content commitment

- **Severity:** medium
- **Location:** EXPERIENCE.md › Accessibility Floor / Information Architecture (sticky 240px sidebar; top nav under 850px); both mocks
- **Evidence:** The keyboard-complete rule covers operability, but neither spine nor mocks commit to a skip mechanism, and the layout grammar puts a multi-item sidebar nav before the main content on every screen. Keyboard users must tab through brand, nav label, three-plus nav links and sidebar footer on every page load. This is the cheapest, most standard floor item and its absence from an otherwise thorough floor is conspicuous.
- *Fix:* Add to the floor: "a skip-to-content link is the first focusable element on every screen, visible on focus with the olive ring"; note it in the mocks' shell grammar.

### 8. Mocks contain invalid landmark structure (multiple and nested `<main>`)

- **Severity:** medium
- **Location:** mockups/key-review-inbox.html and mockups/key-instructor-approvals.html — `<main class="frames">` wrapping framed screens that each contain their own `<main class="main">`
- **Evidence:** The review mock exposes four `<main>` landmarks (the sheet wrapper plus one per framed screen), with product mains *nested inside* the sheet main. HTML allows one `<main>` per document (absent shadow DOM), and landmark navigation in screen readers will announce a confusing main-inside-main set before the user reaches the actual product surface. Everything else in the mocks is semantically careful (`aria-current`, `aria-label` on the interval track with `role="img"`, `aria-hidden` decorative arrows, real `<button>`s, `lang="en"`), which makes this stand out.
- *Fix:* In the mock furniture, change `<main class="frames">` to a `<div>` (or give each framed app's main `role="main"` inside a single labeled sheet container — simplest is div + `aria-label`ed sections per frame). Keep exactly one `<main>` per framed product screen.

### 9. Time-limit story: the 120-second rule is fine, but session expiry mid-edit needs a stated contract

- **Severity:** medium
- **Location:** EXPERIENCE.md › State Patterns ("Processing ≥120 s", "Session expiry / role change"); setup-experience.md U2/Pending-at-120-seconds and "no persistent browser storage" rule
- **Evidence:* On 2.2.1: the 120-second honest-pending rule is **not** a user-facing time limit — it imposes no completion deadline on the user, preserves input, and degrades to "Still processing" or retryable failure, so no turn-off/extend mechanism is required; this deserves one sentence in the spine so downstream reviewers do not re-litigate it. The real gap: navigation-away with unsaved work warns, but *server-side session expiry* mid-edit ("Private UI cleared immediately", memory-only storage) can silently destroy in-progress answers in a long practice/test session. AT users and slow readers take longer per screen, so this hits them disproportionately; the spine never says whether an expiry warning, a save-on-idle, or a draft-preservation promise applies at that boundary.
- *Fix:* State explicitly in State Patterns: "No learner-facing task is time-limited (no timed tests or idle countdowns); the 120 s rule is a system honesty deadline, not a user time limit. Before a session expires with in-memory unsaved edits, the user is warned and given the chance to save/continue where the platform supports it; where memory-only storage applies, the expiry screen says plainly that unsaved edits could not be kept."

### 10. `muted` on `soft` (5.5:1) is used but missing from the measured table

- **Severity:** low
- **Location:** DESIGN.md › Colors contrast paragraph; used in both mocks' `.sidebarBottom` ("Signed in as… Reminders appear in this app only.") on the soft sidebar
- **Evidence:** Recomputed 5.51:1 — passes AA for normal text, but the spine's own rule is "New pairings must be measured, not eyeballed," and the sidebar furniture pairing is absent from the table. Same for `ink` on `selected-bg` (10.8:1, answer-option selected text), also untabled though passing. The table should be closed under actual usage.
- *Fix:* Add rows: muted/soft 5.5:1, ink/selected-bg 10.8:1 (and the non-text rows from findings 2–3).

### 11. `list-style: none` on the review list risks dropped list semantics

- **Severity:** low
- **Location:** mockups/key-review-inbox.html — `<ul class="reviewList">` with `list-style: none` and no `role="list"`
- **Evidence:** Some browser/AT combinations (historically Safari/VoiceOver) remove list/listitem semantics when `list-style` is none; the review list's grouping would be lost exactly where row association (finding 4) is already weak.
- *Fix:* Add `role="list"` to the `<ul>` (as the approvals mock already does for its options grid) or keep native markers styled.

### 12. Evidence `<meter>` lacks a programmatic accessible name

- **Severity:** low
- **Location:** mockups/key-instructor-approvals.html — `<meter class="evMeter" min="0" max="12" value="9">9 of 12 required items completed</meter>`
- **Evidence:** The descriptive text ("Required items 9 of 12 completed") is a sibling `<p>`, not associated; the meter's inner text is only a fallback and meter does not take `<label>`. AT support for unlabeled meter values is inconsistent, and the spine's "always labeled with words" rule is met visually but not programmatically.
- *Fix:* `aria-label="Required items completed"` (or `title`) on the meter, and note in the component pattern that the words must be programmatically associated, not just adjacent.

### 13. Consequential copy is set below 12px, and 1.4.12 text-spacing is not an explicit commitment

- **Severity:** low
- **Location:** DESIGN.md › Typography — `fine` 0.65rem (10.4px), `overline` 0.625rem all-caps (10px), `tagline` 0.5rem (8px); mocks use `.fine` for load-bearing honesty text ("Snoozing changes timing, not evidence", the approval-record line, "estimate, from session activity")
- **Evidence:** All these pass contrast, and rem-based sizing plus the "responsive text scales without truncating controls" rule covers 1.4.4 reasonably. But 10.4px is below common low-vision legibility floors for text that carries binding meaning (rules, receipts, evidence caveats), and the floor never mentions 1.4.12 text-spacing (user-applied letter/line/word spacing must not break clipping) even though the tight overline tracking (0.14em) is the kind of style that interacts with it. The 8px tagline is brand decoration; the `fine` token is not.
- *Fix:* Raise `fine` to ≥0.75rem for consequential text (or define a 12px floor for any text a user must read to act), and add one floor line: "controls and text containers tolerate user text-spacing overrides (1.4.12) without clipping or overlap."

### 14. Consistent help (3.2.6) has no surface at all

- **Severity:** low
- **Location:** EXPERIENCE.md › Information Architecture (no help/contact surface in the surface map); setup-experience.md U0 ("contact operator for account/recovery")
- **Evidence:** WCAG 2.2 AA's 3.2.6 requires a help access mechanism repeated in a consistent place *if one is provided*. Currently the only help-ish reference is sign-in-time operator contact; nothing product-wide exists. For non-CS-major learners (a stated audience) a discoverable, consistently placed way to get help or report a problem is both a 2.2 conformance question and a cognitive-accessibility need. If the deliberate answer is "none in this release," that decision should be recorded like the English-only decision.
- *Fix:* Decide and record: either add a consistent footer/help entry (operator contact + accessibility feedback) shown in the same order on every screen, or log "no help surface this release" under Decisions with the 3.2.6 rationale.

### 15. Accessible authentication details (3.3.8) unstated

- **Severity:** low
- **Location:** setup-experience.md U0; EXPERIENCE.md sign-in surface
- **Evidence:** U0 already gets a lot right (generic messages, one submission, no credentials in URL/logs). Missing: a commitment that credential fields allow paste and work with password managers (no paste-blocking, no cognitive-function tests such as transcription puzzles on re-auth) — the specific content of 3.3.8. Operator-provisioned accounts make this more likely to be hand-typed, not less.
- *Fix:* Add to U0 required behavior: "credential fields accept pasted input and password-manager autofill; re-authentication requires no memorization/transcription puzzle."

### 16. Learner-facing jargon: operation IDs and "Quarantined"

- **Severity:** low
- **Location:** EXPERIENCE.md › State Patterns ("'Still processing' with operation id"); setup-experience.md U2 state name "Quarantined / extracting"
- **Evidence:** Raw operation IDs are internal vocabulary; "Quarantined" is a security term, not learner language. The spine's voice rules otherwise keep reading level plain and short (a strength — microcopy sits comfortably around a plain-English register). These two leak implementation vocabulary into the learner surface, adding cognitive load exactly in failure states where users are already strained.
- *Fix:* Specify that the operation ID is secondary/parenthetical (or collapsible) after a human sentence, and that the learner-facing label for the quarantined state is plain wording (e.g., "Checking file safely") while "Quarantined" stays an internal state name.

### 17. Approval gate: "inspected" has no mechanism, and coverage is not programmatically tied to the button

- **Severity:** low
- **Location:** EXPERIENCE.md › Component Patterns › Approval inspector ("batch approve only after inspecting listed versions"); mockups/key-instructor-approvals.html approve bar
- **Evidence:** The rule says approval is gated on inspection, but neither spine nor mock defines how inspection is established (per-version checkbox? scroll-tracking? honor system?). The mock's approve button is simply always enabled, with the covered-versions sentence in an unrelated `<p class="fine">` — not referenced by the button. A keyboard/AT user approving must be certain which versions are covered without visual proximity inference; an undesigned gate will be invented differently by each implementer (some mouse-centric).
- *Fix:* Define the gate (e.g., a required per-bundle "I have inspected these versions" checkbox that enables the button, keyboard-operable, announced on toggle), and tie the versions sentence to the button via `aria-describedby`.

### 18. English-only interface — recorded risk for the Hong Kong audience

- **Severity:** low (risk note only)
- **Location:** EXPERIENCE.md › Decisions ("English-only interface; zh-HK / bilingual surfaces are not designed in this release")
- **Evidence:** The decision is explicitly recorded (good governance), and both mocks correctly set `lang="en"`. The audience (PolyU learners, personas like Wen and Priya) plausibly includes Cantonese-first users for whom English microcopy about consent, deletion and evidence semantics is a comprehension barrier — a language-accessibility risk rather than a WCAG 2.2 AA failure for the declared target audience.
- *Fix:* Keep the decision, but record it as a named accessibility risk with a revisit trigger (e.g., pilot feedback), and keep microcopy short and jargon-free (see finding 16) to reduce the cost for non-native English readers.

---

Verification note: every ratio in DESIGN.md's contrast paragraph was recomputed from the hex tokens and matched the stated value within rounding (e.g., ink/paper 11.15 vs 11.2, code-text/ink 10.69 vs 10.7, disabled 4.99 vs 5.0). Findings 2, 3 and 10 cite the recomputed values for pairings the table omits. No files other than this report were modified.
