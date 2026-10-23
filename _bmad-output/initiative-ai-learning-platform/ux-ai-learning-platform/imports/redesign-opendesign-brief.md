# Redesign brief — Fieldnotes visual refresh (openDesign working doc)

**Status:** working brief for the openDesign redesign exploration. Not a BMad artifact, not a ticket advancement, and not implementation authorization — see §8 Governance.
**Date:** 2026-10-23
**Direction requested:** modern, professional, warm, friendly, cozy.
**Exploration update (2026-10-23):** full screen inventory delivered — foundations (token sheet + component kit), all 22 screens across Groups 1–3, plus the U0–U8 setup-flow map and the system-states gallery (26 HTML files; `index.html` is the launcher). Direction and spine revisions recorded in §3 "Decision recorded" and §9 changelog.

---

## 1. Recommendation in one paragraph

Do a **visual spine revision**, not a clean-slate redesign. The experience spine (information architecture, screen states, interaction contracts, accessibility floor) was finalized and validated on 2026-10-22 (`_bmad-output/initiative-ai-learning-platform/ux-ai-learning-platform/EXPERIENCE.md`) and the current "Fieldnotes" identity (warm paper + deep green ink + lime accent) already reads warm and cozy. Redesign the **look** — color, type, shape, depth, iconography, motion, component styling — in openDesign across the full screen inventory in §4, and keep the validated **behavior** unless a screen genuinely needs to change.

## 2. What exists today (evolve this, don't discard)

### Current tokens (from `src/app/globals.css`, `src/app/demo/demo.module.css`, DESIGN.md)

> **Superseded 2026-10-23** by the new token sheet below (see §3 "Decision recorded" and §9). Kept here as the "before" reference for the spine revision.

| Role | Value |
|---|---|
| ink (text/primary) | `#193c36` |
| muted text | `#52635d` |
| paper (page bg) | `#f7f6f1` |
| surface (cards) | `#fffefa` |
| soft (sidebar) | `#edf0e6` |
| line / line-strong | `#d7dfd6` / `#c6d0c3` |
| accent lime (attention/live) | `#d8e88c` (border `#b7cc6c`) |
| olive (confirmed/selection/focus) | `#486600` (soft `#9caf61`, selected bg `#f0f5de`) |
| danger | `#8b2926` (bg `#fff0e9`) |
| display type | Georgia, serif — `clamp(2rem, 3.1vw, 3.25rem)`, weight 400 |
| UI/body type | `-apple-system, BlinkMacSystemFont, "Segoe UI"` stack, 14px/1.6 |
| radius | `0.25rem` buttons / `0.2rem` inputs / `2rem` pills |
| depth | tonal only — **no shadows, no gradients**; hairline 1px borders |
| breakpoints | ≥1700 / 1100 / 850 / 600, floor 360px; content cap 1400–1440px; sidebar 240px |

### New tokens (designed 2026-10-23 — this is the live sheet; see `foundations.html`)

| Role | Token | Value |
|---|---|---|
| page background | `--bg` Parchment | `#f5f4ed` (never pure white) |
| card surface | `--surface` Ivory | `#faf9f5` |
| warm interactive surface | `--surface-warm` Warm Sand | `#e8e6dc` (secondary buttons, selected nav, meter tracks) |
| primary text | `--fg` Near Black | `#141413` (warm, slightly olive; also dark-section bg) |
| emphasized secondary text | `--fg-2` Dark Warm | `#3d3d3a` |
| secondary body text | `--muted` Olive Gray | `#5e5d59` (4.6:1 on Parchment) |
| metadata / input borders | `--meta` Stone Gray | `#87867f` (holds 3:1 non-text on bg) |
| borders | `--border` Cream / `--border-soft` Warm | `#f0eee6` / `#e8e6dc` |
| **single accent** | `--accent` Terracotta | `#c96442` — attention/live, primary CTA, selected answer; Ivory text on top; hover/active = −8%/−14% lightness in OKLab |
| success / confirmed | `--success` | `#17a34a` |
| warning / partial states | `--warn` | `#eab308` (always on a tinted plate) |
| danger | `--danger` Error Crimson | `#b53333` |
| focus ring | Focus Blue | `#3898ec`, 3px halo at 30% — **only** for keyboard focus, the one cool color |
| display type | Georgia serif | weight 500 (was 400), 52/32/25px scale, tight 1.1–1.2 leading — **no webfont** |
| UI/body type | system sans stack | 16px/1.6 body, 14px caption, 10px overline (+0.5px tracking) |
| code / numerics | ui-monospace | tabular-nums for all metrics |
| radius | 8 / 12 / 16 / pill 9999 | (was 4 / 3.2 / 32) |
| depth | **ring shadows** `0 0 0 1px` + one whisper shadow `rgba(0,0,0,.05) 0 4px 24px` on overlays only | **revisits the tonal-only spine decision — see §9** |
| motion | 150ms hover/press, 200ms panels, `cubic-bezier(0.2,0,0,1)`, reduced-motion collapses to ≤10ms | |
| layout | sidebar 240px → top nav below 850px; content cap ~1080–1200px in the prototype (spine's 1400px cap unchanged for app) | |

### Spine decisions that carry over (revisit only deliberately, and record it)

- Color semantics: ~~lime = attention/live, olive = selection/confirmed/focus, danger scarce~~ → **revised 2026-10-23:** terracotta = attention/live/selected-answer + primary CTA (one accent, used sparingly); success green = confirmed/mastered; danger scarce; selection in lists/nav is Warm Sand fill (no chromatic color); focus is Focus Blue ring only. Status is never color alone — pills carry dot + label. See §9.
- WCAG 2.2 AA: 3:1 non-text contrast (input border `#7a8b81`), visible focus ring on ink, 44px targets / 64px answer rows, skip-to-content, dialog keyboard contract, consistent help footer.
- Light mode only (dark deferred); English-only (known risk).
- No gamification — no XP, streaks, confetti. Friendly ≠ gamified.
- Honest states — no fake data, no decorative progress.
- No UI component library — hand-rolled CSS on Tailwind base + CSS Modules.

### Where to look at the current app

- Demo (visible sample product): `http://127.0.0.1:3000/demo`, `/demo/lesson`, `/demo/practice`, `/demo/progress` (see README for the port-3100 preview build; loopback only).
- Screenshots: `.local/demo-screenshots/*.png` (not committed) and `artifacts/Fieldnotes-Desktop-Demo.docx`.
- Canonical HTML mocks of two key unbuilt screens: `_bmad-output/initiative-ai-learning-platform/ux-ai-learning-platform/mockups/key-review-inbox.html` and `key-instructor-approvals.html`.

## 3. Translating "modern, professional, warm, friendly, cozy" into design moves

The gap between current and goal is mostly **type, shape, depth and refinement** — not palette identity:

1. **Type upgrade (biggest single win).** Replace the system stack + Georgia with a self-hosted pairing: a warm humanist sans for UI/body (e.g. Figtree, Source Sans 3, Public Sans) and a characterful serif for display (e.g. Fraunces, Source Serif 4). This alone moves the design from "default" to "designed". Constraint: CSP is `font-src 'self'`, so any webfont must be self-hosted and adds a dependency → needs plan authorization before code (§8).
2. **Warmer neutral ramp.** Shift paper/surface slightly toward cream (e.g. paper `#F8F5EE`, surface `#FFFEF9`, soft `#EFEAE0`) while keeping the green ink identity.
3. **Softer geometry.** Current 4–6px radii read utilitarian. Try 8–14px on cards/inputs/buttons (sm 6 / md 10 / lg 14 / pill 999) for the cozy-modern feel.
4. **One soft elevation level.** The spine bans shadows (tonal depth only). Modern-warm typically uses a barely-there diffuse shadow on overlays and floating elements (e.g. `0 8px 24px rgba(25,60,54,.08)`). This is a spine decision to revisit — either keep tonal-only or allow shadow for overlays only; record whichever you choose.
5. **Optional warm secondary.** A scarce apricot/amber highlight (e.g. `#E9A23B` / soft `#FBEED8`) for celebratory-but-calm moments (lesson complete, streak-free encouragement). Must get a recorded semantic meaning before use; keep lime/olive semantics intact.
6. **Consistent iconography.** A single rounded 1.5px-stroke icon family (Lucide-style) at 16/20/24px.
7. **Motion language.** 150ms ease-out for hover/press, 250ms for panels; always gated by `prefers-reduced-motion` (already supported).

### Three directions to explore in openDesign (recommended: A)

- **A — Evolved Fieldnotes (recommended).** Keep green-ink identity and semantics; warm the neutrals; upgrade type; enlarge radii; optionally one overlay shadow. Highest continuity, preserves validated contrast pairs, still clearly "more modern".
- **B — Warm editorial.** Cream/ochre palette, bigger serif presence, generous whitespace. Coziest, but abandons the green brand equity and invalidates contrast pairs.
- **C — Modern product.** Cooler neutral base + green accents, denser layout, Inter-like type. Most "professional SaaS", least cozy.

### Decision recorded (2026-10-23)

The first design pass went with a variant of **B — Warm editorial**, executed on the Claude (Anthropic) design system active in openDesign: parchment canvas, exclusively warm neutrals, terracotta as the single accent, serif display at weight 500. Per the working session's instruction, the brief's own green-ink design system was not the target — the openDesign active system was. Consequences, move by move:

1. **Type upgrade → resolved without a dependency.** Georgia (serif display, weight 500) + system sans + ui-monospace. No Fraunces/Figtree, so **no webfont, no plan authorization needed** for type; CSP `font-src 'self'` untouched. If a characterful serif (e.g. Fraunces) is still wanted later, that is a separate dependency decision.
2. **Warmer neutral ramp → adopted and taken further:** Parchment `#f5f4ed` / Ivory `#faf9f5` / Warm Sand `#e8e6dc`; the green ink identity is replaced, not kept.
3. **Softer geometry → adopted:** 8 / 12 / 16 / 9999 radius scale.
4. **One soft elevation level → resolved:** ring shadows (`0 0 0 1px`) as the default depth; one whisper shadow `rgba(0,0,0,.05) 0 4px 24px` allowed on overlays/floating elements only. **This revisits the tonal-only spine decision** — recorded in §9, needs a memlog entry when the spine is formally revised.
5. **Optional warm secondary → not adopted.** Terracotta covers warm emphasis; no apricot/amber introduced. Accent budget: ≤2 chromatic uses per view.
6. **Consistent iconography → adopted:** inline monoline SVG, 1.5px stroke, round caps, 20px in nav (16/24 variants per kit).
7. **Motion language → adopted with a trim:** 150ms hover/press, 200ms panels (not 250ms), all gated by `prefers-reduced-motion`.

## 4. Screen inventory to design (full product, implemented + planned)

All names exactly as in the experience spine's IA table. Design **desktop (1440) + mobile (360)** for every screen; the sidebar collapses to top nav below 850px.

### Group 1 — Already built (design first; code exists to compare against)

| # | Screen | Where today |
|---|---|---|
| 1 | Sign in | `/` (tracer) |
| 2 | Library ("Saved studies") | `/` tracer sidebar |
| 3 | New study — Materials (per-file previews, acknowledge, retry/cancel) | `/` tracer step 01 |
| 4 | New study — Goal & plan (Manual-only editor today) | `/` tracer steps 02–03 |
| 5 | Privacy & data (AI-processing consent panel) | `/` tracer |
| 6 | Demo shell + Overview (hero, learning loop, roadmap, AI Fluency 4D grid) | `/demo` |
| 7 | Mini-course player — sample (promise blockquote, code block, notebook aside) | `/demo/lesson` |
| 8 | Practice & recall — sample (assisted MC, prewritten feedback) | `/demo/practice` |
| 9 | Progress — sample (evidence meters, coverage, reflection card) | `/demo/progress` |

### Group 2 — Key unbuilt learner screens (the redesign's main value)

| # | Screen | Notes |
|---|---|---|
| 10 | Mini-course player — full | All activity formats: text+images, simulations, role play/mock interview, mini-games, AI-narrated animation/slides, online coding |
| 11 | Practice & recall — full | Scoring, retry, recall states |
| 12 | Test & recovery | Gap-targeted recovery flow (not built at all) |
| 13 | Roadmap — full | Real roadmap vs sample's 3-node version |
| 14 | Review inbox | Canonical/paused/empty variants exist in `mockups/key-review-inbox.html` |
| 15 | Why-explorer | Spine-only; needs first-ever visual design |
| 16 | Optional starting check | Setup state U6 |
| 17 | New study — Goal & plan (AI-assisted variant) | The not-yet-built AI route of screen 4 |
| 18 | Owner export / deletion receipt | U7 (export not built) / U8 (receipt exists) |

### Group 3 — Instructor shell (all unbuilt; two mocks exist)

| # | Screen |
|---|---|
| 19 | Instructor — Courses (customize existing, generate from topic, exact-version approval) |
| 20 | Instructor — Approvals (mock: `key-instructor-approvals.html`) |
| 21 | Instructor — Students (import, roster) |
| 22 | Instructor — Participation / engagement tracking |

### Also design as states, not screens

- Setup states U0–U8 (sign-in boundary → deletion receipt) as a connected flow.
- System states for every screen: loading, empty, error, partial/offline-honest, confirm dialogs, danger-zone patterns.
- Instructor approval/rejection states, version-diff presentation (exact-version approval is a core requirement).

## 5. Build order in openDesign

Progress as of 2026-10-23: **all five steps designed.** Step 1 done (`foundations.html`). Step 2 done (`sign-in.html` 1, `library.html` 2, `new-study-materials.html` 3, `new-study-plan.html` 4, `privacy-data.html` 5, `demo-overview.html` 6, `course-player.html` 7, `practice.html` 8, `progress.html` 9). Step 3 done (`course-player-full.html` 10, `practice-full.html` 11, `test-recovery.html` 12, `roadmap.html` 13, `review-inbox.html` 14, `why-explorer.html` 15, `starting-check.html` 16, `new-study-plan-ai.html` 17, `owner-export.html` 18). Step 4 done (`instructor-courses.html` 19, `instructor-approvals.html` 20, `instructor-students.html` 21, `instructor-participation.html` 22, plus `setup-flow.html` U0–U8 and `states.html` system-states gallery). Step 5 (formal accessibility pass against the §6 checklist) remains as the final verification sweep before handoff.

1. **Foundations first:** moodboard for the chosen direction → full token sheet (color ramps incl. hover/disabled variants, type scale, spacing ladder, radius set, elevation policy, border widths, focus ring spec, motion timings, icon family) → component kit: buttons (primary/quiet/danger), inputs/textarea/file slots, checkboxes/radios (64px answer rows), sidebar nav + topbar + badge/tag, callouts and rule bars, code blocks, cards, meters/progress, tables, dialogs, toasts/inline notices, empty/error states.
2. **Group 1 screens** — validate the system against what exists.
3. **Group 2** — the redesign's payoff; player and review inbox are the most important.
4. **Group 3 + state variants.**
5. **Accessibility pass before calling it done** (§6 checklist).

## 6. Non-negotiable constraints checklist (apply while designing)

- [ ] WCAG 2.2 AA: body text ≥4.5:1, large text ≥3:1, UI borders/icons ≥3:1 on their background (the current spine darkened input borders for exactly this).
- [ ] Focus ring clearly visible on every interactive element, including on the dark ink hero.
- [ ] Touch targets ≥44px; answer rows ≥64px.
- [ ] Layouts hold at 360px width single-column; content cap ~1400px; sidebar 240px → top nav below 850px.
- [ ] `prefers-reduced-motion` respected — no essential information conveyed by motion alone.
- [ ] Every demo screen keeps a permanent **"Sample prototype · No live AI"**-equivalent label.
- [ ] No gamification elements; honest empty/loading/progress states.
- [ ] English-only copy (Cantonese support is a recorded future risk, not now).
- [ ] Assets must be self-hostable: CSP allows no external fonts/images (`font-src 'self'`, `img-src 'self' data:`) — no CDN-linked typefaces or stock imagery in the shipped design.
- [ ] Tracer screens keep "Local tracer — not approved for real data" style honesty labels.

## 7. Handoff format (what to bring back from openDesign)

1. Final token sheet (hex/type/spacing/radius/motion) in the same shape as DESIGN.md's frontmatter tokens. **Drafted 2026-10-23: `DESIGN.md` (spine revision draft) in this project** — frontmatter tokens + revised semantics + component specs + changelog + memlog stubs.
2. Per-screen exports (desktop + mobile) + notes on any screen whose *behavior* you changed (those are experience-spine amendments, flag them separately). **Delivered 2026-10-23: `exports/` holds 52 PNGs — `<screen>-desktop.png` at 1440px and `<screen>-mobile.png` at 360px for all 25 HTML pages (22 screens + foundations + setup-flow/states references + launcher).** Sticky chrome (topbar/sidebar) is rendered static in the captures to keep full-page stitching clean; faint seam lines in tall captures are exporter tiling artifacts, not design bugs. **Behavior changes: none** — no experience-spine amendments to flag.
3. Component styling specs for the kit in §5.1. **Covered by `foundations.html` and summarized in §7 of the `DESIGN.md` draft.**
4. A short changelog vs the current spine: which recorded decisions were revisited (shadows? light-only? new semantic color? typography dependency?) — each needs an explicit memlog entry when the spine is revised. **Covered by §8–9 of the `DESIGN.md` draft (five revisited decisions, six memlog stubs — the sixth covers the a11y token fixes).**

## 8. Governance (read before writing any code)

- Current authorization covers stories 1–2, the screenshot demo plan, and the adapter-only plan. **A UI rewrite/redesign implementation is NOT covered** — when designs are done, we record the spine revision (DESIGN.md update + memlog entry in the ux folder) and write a new plan/story (same pattern as `plan-screenshot-study-prototype.md`) before touching `src/app`. **Plan drafted 2026-10-23: `plan-visual-spine-revision.md` in this project** — explicit scope/authorization, zero new dependencies, CSP + `*.module.css` constraints, old→new token migration map, 7-phase rollout matching §5, acceptance criteria, and rollback. Approving and filing that plan is the remaining act that authorizes `src/app` work.
- New dependencies (webfonts, icon packages, any component library) require that plan to authorize them explicitly; the CSP and the `*.module.css` Tailwind-loader exclusion must be preserved.
- This brief itself may be moved into `ux-ai-learning-platform/imports/` if you re-run the bmad-ux flow to formalize the revision.

---

## 9. Changelog vs the current spine (2026-10-23 design pass)

Delivered artifacts: `index.html` (overview/launcher), `foundations.html` (token sheet + component kit), and all 22 screens: Group 1 — `sign-in.html` (1), `library.html` (2), `new-study-materials.html` (3), `new-study-plan.html` (4), `privacy-data.html` (5), `demo-overview.html` (6), `course-player.html` (7), `practice.html` (8), `progress.html` (9); Group 2 — `course-player-full.html` (10), `practice-full.html` (11), `test-recovery.html` (12), `roadmap.html` (13), `review-inbox.html` (14), `why-explorer.html` (15), `starting-check.html` (16), `new-study-plan-ai.html` (17), `owner-export.html` (18); Group 3 — `instructor-courses.html` (19), `instructor-approvals.html` (20), `instructor-students.html` (21), `instructor-participation.html` (22); states — `setup-flow.html` (U0–U8 connected flow), `states.html` (loading/empty/error/offline/dialog/danger-zone gallery). All honor §6: 44px targets, 64px answer rows, visible Focus Blue ring, reduced-motion gating, permanent "Sample prototype · No live AI" labels (tracer screens carry "Local tracer — not approved for real data"), no external fonts/images, no gamification.

Screen 8 specifics worth recording: the assisted-MC **hint affordance** is a quiet bordered button (not accent — the accent budget stays at selected-state + primary CTA); **incorrect answers use the warm amber `warn` tone, never `danger`** (danger stays scarce per the spine); the progress meter is explicitly labeled "session only — not a stored score" to keep honesty; the session summary routes misses to the review inbox instead of showing a grade. No new tokens were needed — the kit covered every element.

Screen 9 specifics worth recording: **evidence meters are dark warm `fg-2` fills, not terracotta** — with four meters plus six coverage bars on one screen, accent fills would break the accent budget, and dark ink reads as "recorded fact" rather than "attention". **Empty evidence is rendered as an empty track + "No evidence yet", never an estimated number** (honesty floor applied to data, not just copy). Thin evidence is called out in the provenance line ("one task is thin evidence"). The **reflection card stores only in-browser in the sample** and says so; in-product copy defers device-storage choice to the user. The suggested next step routes to the review inbox rather than pushing the next lesson, mirroring screen 8's routing. No new tokens were needed — the kit covered every element.

Screen 14 specifics worth recording: the redesign covers the **canonical / paused / empty variants in one working screen** (tab views, not separate files). **Recall is write-before-you-peek** — the textarea comes before the instructor's note, and the note is explicitly labeled instructor-written, not generated. **Self-assessment reschedules honestly**: "I recalled it" logs the next interval with the reason ("interval doubled — second success in a row"); "Still fuzzy" keeps the item due and shortens the interval instead of pretending success. **Pausing is not a failure state** — paused items leave the schedule, don't count as gaps, and the paused pill is neutral (not the green confirmed tone). **Missed-in-practice items use the warm amber `warn` pill**; `danger` never appears. The empty state ("Inbox clear") states that the screen will not invent work. No new tokens were needed — the kit covered every element.

Screens 10–13 specifics worth recording: **practice-full** extends screen 8 with free-recall and self-graded explain-back question types; recall-state pills (New / Strengthening / Fuzzy) use amber for Fuzzy, never red; retry-missed is a real second round, and scoring stays "session only". **test-recovery** (first visual design) frames diagnostics as gap-targeting, not grading — per-topic Solid / Needs work results, and recovery is a checklist of refresher + retry steps that feeds back into the review schedule. **roadmap — full** uses an 8-node / 3-phase vertical timeline; locked nodes state their unlock condition honestly ("Unlocks after practice check"); the current node carries the screen's one terracotta moment.

Screens 15–18 specifics worth recording: **why-explorer** (first-ever visual design) is an accordion of honest "why" answers — spacing intervals framed as estimates, lesson order attributed to the instructor — plus a trace-your-path strip. **starting-check** (U6) is explicitly optional, self-rating not a test, and its recommendation is overrideable ("you decide"). **owner-export** generates a real downloadable sample JSON via Blob (self-contained, CSP-safe); deletion is a quiet two-step danger zone ending in the U8 receipt — `danger` appears only there. **new-study-plan-ai** reuses screen 4's editor as its Manual mode; the AI draft is presented as a reviewable proposal (editable, removable with undo) labeled "Drafted from your goal — review before accepting", with prewritten-sample honesty copy.

Group 3 specifics worth recording: **instructor-approvals** makes exact-version approval concrete with a version id + content hash, lesson-by-lesson diff pills, expandable before/after blocks, and a focus-managed confirm dialog; changes-requested lands back in the queue as an amber pill. **instructor-students** import validates pasted rows in amber (not red) and ships a working CSV template download. **instructor-participation** keeps the surveillance-free framing: provenance notes on every summary number, a "— means missing, never estimated" legend, no rankings; completion bars follow the screen-9 decision (dark `fg-2` fills, not terracotta).

States-as-states: **setup-flow.html** maps U0–U8 as connected cards with designed / spine-only pills; **states.html** is the reference gallery (skeleton loading, honest empty, amber error with retry, offline-honest banner, focus-managed confirm dialog, quiet danger zone). Dialog pattern across the project: focus moves in on open, Esc and backdrop close, focus returns on close, all reduced-motion gated.

Spine decisions **revisited** (each needs a memlog entry when the spine is formally revised):

1. **Shadows.** Tonal-only is replaced by ring shadows (`0 0 0 1px` warm hairlines) plus one whisper shadow (`rgba(0,0,0,.05) 0 4px 24px`) restricted to overlays/floating elements. No gradients.
2. **Color semantics.** Lime/olive replaced by: terracotta = attention/live/selected/primary action; green = confirmed/mastered; selection in lists and nav = neutral Warm Sand; focus = Focus Blue ring. All status pills pair color with dot + label.
3. **Palette identity.** Green ink identity retired in favor of the warm-neutral + terracotta system (Direction B variant). This is the largest departure from the brief's original "evolve, don't discard" stance and was an explicit instruction in the working session.
4. **Typography dependency.** Resolved to **zero new dependencies** — Georgia + system stacks only. A self-hosted serif remains an option but is no longer load-bearing for "designed, not default".
5. **Motion timings.** Panels 200ms (was proposed 250ms).

Accessibility sweep (2026-10-23, all 26 HTML files, §6 checklist): scripted audit + numeric contrast verification + render checks. Two P0 contrast violations found and fixed at the token level (values recorded in `DESIGN.md`): `--meta` darkened `#87867f → #6d6c64` (was 3.3:1 on parchment/ivory at 12px metadata sizes; now 4.6–5.0:1), and primary-action terracotta split into `--accent-strong: #a55236` for text-on-accent and small accent text (was `#c96442` at 3.7:1 with ivory button labels; now ≥4.5:1 on every surface incl. pill tints). `#c96442` remains for borders, fills, dots, and large-text moments where 3:1 applies. Also fixed: skip-to-content links added to all 26 files (spine floor item that had not landed), and the launcher's file links given 44px targets. Verified clean: focus rings on every interactive element, 64px answer rows, 850px sidebar→topnav collapse with internal nav scroll at 360px (no page-level horizontal scroll), reduced-motion gating, native `<dialog>` keyboard contract, sample/honesty labels, zero external font/image references.

Spine decisions **kept intact**: light mode only; English-only; no gamification; honest states; no UI component library; WCAG 2.2 AA floor; CSP self-hosting constraint.

Behavior changes: **none.** All screens designed so far follow the validated experience spine; no experience-spine amendments to flag.
