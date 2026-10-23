# Redesign brief — Fieldnotes visual refresh (openDesign working doc)

**Status:** working brief for the openDesign redesign exploration. Not a BMad artifact, not a ticket advancement, and not implementation authorization — see §8 Governance.
**Date:** 2026-10-23
**Direction requested:** modern, professional, warm, friendly, cozy.

---

## 1. Recommendation in one paragraph

Do a **visual spine revision**, not a clean-slate redesign. The experience spine (information architecture, screen states, interaction contracts, accessibility floor) was finalized and validated on 2026-10-22 (`_bmad-output/initiative-ai-learning-platform/ux-ai-learning-platform/EXPERIENCE.md`) and the current "Fieldnotes" identity (warm paper + deep green ink + lime accent) already reads warm and cozy. Redesign the **look** — color, type, shape, depth, iconography, motion, component styling — in openDesign across the full screen inventory in §4, and keep the validated **behavior** unless a screen genuinely needs to change.

## 2. What exists today (evolve this, don't discard)

### Current tokens (from `src/app/globals.css`, `src/app/demo/demo.module.css`, DESIGN.md)

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

### Spine decisions that carry over (revisit only deliberately, and record it)

- Color semantics: **lime = attention/live, olive = selection/confirmed/focus, danger scarce**; no lime text on paper.
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

1. Final token sheet (hex/type/spacing/radius/motion) in the same shape as DESIGN.md's frontmatter tokens.
2. Per-screen exports (desktop + mobile) + notes on any screen whose *behavior* you changed (those are experience-spine amendments, flag them separately).
3. Component styling specs for the kit in §5.1.
4. A short changelog vs the current spine: which recorded decisions were revisited (shadows? light-only? new semantic color? typography dependency?) — each needs an explicit memlog entry when the spine is revised.

## 8. Governance (read before writing any code)

- Current authorization covers stories 1–2, the screenshot demo plan, and the adapter-only plan. **A UI rewrite/redesign implementation is NOT covered** — when designs are done, we record the spine revision (DESIGN.md update + memlog entry in the ux folder) and write a new plan/story (same pattern as `plan-screenshot-study-prototype.md`) before touching `src/app`.
- New dependencies (webfonts, icon packages, any component library) require that plan to authorize them explicitly; the CSP and the `*.module.css` Tailwind-loader exclusion must be preserved.
- This brief itself may be moved into `ux-ai-learning-platform/imports/` if you re-run the bmad-ux flow to formalize the revision.
