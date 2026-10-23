# DESIGN.md — Fieldnotes design spine (revised)

**Status:** spine revision recorded in the ux folder 2026-10-23 (designed in openDesign). Implementation pending plan approval — see `plan-visual-spine-revision.md`. The 2026-10-22 Fieldnotes spine is archived as `DESIGN.2026-10-22.fieldnotes-superseded.md`. Supersedes the 2026-10-22 visual token sheet and the color-semantics, depth, typography, and motion decisions recorded in the previous DESIGN.md. The experience spine (IA, screen states, interaction contracts, accessibility floor) is **unchanged** — see "Behavior changes: none" in §8.
**Governance:** this document records the spine revision only. It is not implementation authorization. Per the redesign brief §8, a new plan/story must authorize the UI work (and any new dependencies) before `src/app` is touched, and each revisited decision in §8 needs a memlog entry in the ux folder.
**Sources of truth while this is a draft:** token sheet + component kit in `foundations.html`; per-screen application in the 22 screen files; rationale per decision in the brief's §3 "Decision recorded" and §9 changelog.

---

## Frontmatter tokens

```yaml
# ── Fieldnotes design tokens (2026-10-23 revision) ──────────────────────
# Warm parchment canvas, exclusively warm-toned neutrals, single
# terracotta accent, serif display at weight 500. No webfonts, no
# gradients, no cool blue-grays anywhere in the system.

color:
  bg:            "#f5f4ed"   # Parchment — page background; never pure white
  surface:       "#faf9f5"   # Ivory — cards, inputs, elevated containers
  surface-warm:  "#e8e6dc"   # Warm Sand — secondary buttons, selected nav,
                             #   meter tracks, neutral selection fill
  fg:            "#141413"   # Near Black (warm/olive) — primary text;
                             #   also dark-section background
  fg-2:          "#3d3d3a"   # Dark Warm — emphasized secondary text,
                             #   button text on warm surfaces, meter fills
  muted:         "#5e5d59"   # Olive Gray — secondary body text
                             #   (4.6:1 on Parchment)
  meta:          "#6d6c64"   # Stone Gray, darkened in the 2026-10-23 a11y
                             #   sweep (was #87867f at 3.3:1) — now 4.6:1 on
                             #   Parchment / 5.0:1 on Ivory at 12px metadata
                             #   sizes; also the input border color
  border:        "#f0eee6"   # Border Cream — standard hairline
  border-soft:   "#e8e6dc"   # Border Warm — section dividers, emphasized
  accent:        "#c96442"   # Terracotta — borders, fills, dots, large-text
                             #   moments (3.5:1 on bg; 3:1 contexts only)
  accent-on:     "#faf9f5"   # Ivory text on accent-strong surfaces
  accent-hover:  "color-mix(in oklab, accent, black 8%)"
  accent-active: "color-mix(in oklab, accent, black 14%)"
  accent-strong: "#a55236"   # Deep Terracotta, added in the a11y sweep —
                             #   primary-button bg and small accent text
                             #   (4.9:1 on bg / 5.2:1 on Ivory with ivory
                             #   label text ≥4.5:1; 4.5:1 on 12% pill tints)
  accent-strong-hover:  "color-mix(in oklab, accent-strong, black 8%)"
  accent-strong-active: "color-mix(in oklab, accent-strong, black 14%)"
  success:       "#17a34a"   # confirmed / mastered
  warn:          "#eab308"   # partial / missed / validation — always on a
                             #   tinted plate (10–12% warn over surface)
  danger:        "#b53333"   # Error Crimson — scarce; destructive flows only
  focus:         "#3898ec"   # Focus Blue — keyboard focus ring ONLY;
                             #   the one cool color in the system

type:
  display:       'Georgia, "Times New Roman", serif'   # weight 500 always
  body:          'system-ui, -apple-system, "Segoe UI", sans-serif'
  mono:          'ui-monospace, Menlo, monospace'  # code + all metrics
                                                 # (tabular-nums)
  scale:         { xs: 10px, sm: 14px, base: 16px, lg: 20px,
                   xl: 25px, 2xl: 32px, 3xl: 52px, 4xl: 64px }
  leading:       { body: 1.6, tight: 1.1 }
  overline:      { size: 10px, tracking: "+0.5px", transform: uppercase }
  # Display serif: weight 500 is the ceiling — no bold, no light.
  # Body line-height 1.6 everywhere; never below 1.4.
  # Zero webfont dependencies — CSP font-src 'self' untouched.

spacing:         # 8px base unit
  ladder:        [4, 8, 12, 16, 20, 24, 32, 48]
  card-padding:  24px
  section-y:     { desktop: 96px, tablet: 64px, phone: 48px }

radius:
  sm:            8px     # standard buttons, cards, containers
  md:            12px    # primary buttons, inputs, nav elements
  lg:            16px    # featured containers, embedded media
  pill:          9999px  # pills, tags, meter tracks
  # No sharp corners (< 6px) on interactive elements.

elevation:
  flat:          none
  ring:          "0 0 0 1px border"                  # default depth — a
                                                     # border-like halo
  raised:        "rgba(0,0,0,0.05) 0 4px 24px"       # whisper shadow —
                                                     # overlays/floating
                                                     # elements ONLY
  # Ring shadows replace the previous tonal-only policy. No drop shadows
  # beyond the one whisper level. No gradients.

borders:
  hairline:      "1px solid border"        # cards, topnav, separators
  emphasized:    "1px solid border-soft"   # section dividers
  input:         "1px solid meta"          # 3:1 non-text contrast floor

focus:
  ring:          "0 0 0 3px rgba(56,152,236,0.3)"    # on :focus-visible
  input:         "border-color #3898ec + ring"       # the one cool-color
                                                     # moment

motion:
  fast:          150ms   # hover / press
  base:          200ms   # panels, expands (was proposed 250ms — trimmed)
  ease:          "cubic-bezier(0.2, 0, 0, 1)"
  reduced:       "prefers-reduced-motion collapses all of the above to ≤10ms"
  # No essential information is ever conveyed by motion alone.

icons:
  family:        inline monoline SVG
  stroke:        1.5px, round caps and joins
  sizes:         [16, 20, 24]    # 20px in nav
  # No emoji as functional icons; no icon packages (CSP/dependency floor).

layout:
  sidebar:       240px   # collapses to top nav below 850px
  content-cap:   1400px  # app (prototype screens use 1080–1200px)
  breakpoints:   [1700, 1100, 850, 600]   # floor 360px
  touch-targets: { min: 44px, answer-rows: 64px }
```

---

## 1. Design principles

Carried over unchanged from the validated spine; the revision changes how they are *expressed*, not what they are.

1. **Warm, not sterile.** The parchment canvas and warm-only neutral ramp are the personality. Every gray carries a yellow-brown undertone; the single cool color (Focus Blue) exists for accessibility only.
2. **Honest states.** No fake data, no decorative progress, no estimated numbers rendered as fact. Empty evidence renders as an empty track labeled "No evidence yet"; missing data renders as "—"; session meters are labeled "session only — not a stored score".
3. **No gamification.** No XP, streaks, confetti. Missed answers and paused reviews are neutral or amber, never red-alarmed. Friendly ≠ gamified.
4. **Editorial pacing.** Serif display type at weight 500 sets a literary cadence; generous section spacing (48–96px vertical rhythm) lets each screen breathe.
5. **Restraint with color.** One accent, at most two chromatic uses per view (default budget: eyebrow/selected-state + primary CTA). Terracotta never carries data-dense encodings like progress meters.
6. **Status is never color alone.** Every status pill pairs its tint with a dot + text label.

## 2. Color semantics (revised)

| Semantic | Token | Notes |
|---|---|---|
| Attention / live / selected answer | `--accent` Terracotta | Selected answer = terracotta border + 6% tint fill; borders/dots/large text |
| Primary action / small accent text | `--accent-strong` Deep Terracotta | One primary CTA per view; small pill/link/label text in accent |
| Confirmed / mastered / completed | `--success` | Pills, "Reviewed" states, meter-green variant |
| Partial / missed / needs work / validation | `--warn` | Always on a 10–12% tinted plate; **never** danger |
| Destructive / danger zone | `--danger` Error Crimson | Scarce: deletion flows, error text. Appears once per flow at most |
| Selection in lists & nav | `--surface-warm` Warm Sand | Neutral fill, no chromatic color |
| Keyboard focus | Focus Blue ring | 3px halo at 30% + input border `#3898ec` |

This **replaces** the previous lime = attention/live, olive = selection/confirmed/focus mapping. Meter fills for recorded evidence are dark `--fg-2`, not terracotta (screen-9 decision: with multiple meters on one screen, accent fills break the accent budget, and dark ink reads as "recorded fact" rather than "attention").

## 3. Typography

- **Display:** Georgia serif, weight 500, tight leading (1.1–1.2). Scale anchors: 52px section headings, 32px sub, 25px card titles, 64px hero (demo/overview only). Weight 500 is the ceiling.
- **Body/UI:** system sans stack, 16px/1.6 body, 14px captions, 15px buttons/inputs, 10px +0.5px uppercase overlines.
- **Mono:** ui-monospace for code and **all metrics** (tabular-nums), so numbers align in tables and meters.
- **Dependencies:** zero. The type upgrade was resolved with Georgia + system stacks; a self-hosted characterful serif (e.g. Fraunces) remains an optional future decision requiring plan authorization, and is no longer load-bearing for "designed, not default".

## 4. Shape, depth, motion, iconography

- **Geometry:** 8 / 12 / 16 / 9999px radius scale (was 4 / 3.2 / 32). Cards and standard buttons at 8, inputs and primary buttons at 12, featured containers at 16.
- **Depth:** ring shadows (`0 0 0 1px`) are the default elevation — a border-like halo, not a shadow. One whisper shadow (`rgba(0,0,0,.05) 0 4px 24px`) is permitted on overlays and floating elements only. No gradients anywhere.
- **Motion:** 150ms hover/press, 200ms panels, `cubic-bezier(0.2,0,0,1)`; all gated by `prefers-reduced-motion` (collapses to ≤10ms).
- **Icons:** inline monoline SVG, 1.5px stroke, round caps, 16/20/24px. No emoji as functional icons, no icon package dependency.

## 5. Accessibility floor (unchanged)

- WCAG 2.2 AA: body text ≥4.5:1, large text ≥3:1, UI borders/icons ≥3:1 on their background. Input borders use `--meta` for exactly this reason.
- Focus ring visible on every interactive element, including on dark Near Black surfaces.
- Touch targets ≥44px; answer rows ≥64px.
- Layouts hold at 360px single-column; sidebar 240px → top nav below 850px; content cap ~1400px.
- Skip-to-content, dialog keyboard contract (focus in on open, Esc/backdrop close, focus returns on close), consistent help footer.
- `prefers-reduced-motion` respected; no essential information by motion alone.

## 6. Honesty & content constraints (unchanged)

- Light mode only (dark deferred); English-only (Cantonese support is a recorded future risk).
- Every demo screen carries a permanent **"Sample prototype · No live AI"** label; tracer screens carry **"Local tracer — not approved for real data"**.
- Self-hostable assets only: CSP `font-src 'self'`, `img-src 'self' data:` — no CDN fonts, no external imagery, no icon packages.
- No UI component library — hand-rolled CSS on Tailwind base + CSS Modules; the `*.module.css` Tailwind-loader exclusion is preserved.

## 7. Component kit (styling specs)

Canonical, interactive specs live in `foundations.html`. Summary of the recipes the screens actually use:

- **Buttons** (all 44px min-height, 12px radius, 15px/500): primary = Deep Terracotta (`--accent-strong`) + Ivory text + 1px self-ring, hover/active darken 8%/14% in OKLab; secondary = Warm Sand + Dark Warm text + ring; quiet = transparent + Border Warm, hover border → Stone Gray; danger = transparent + Error Crimson text/border, hover gains an 8% danger tint; disabled = opacity .45, no transform.
- **Inputs/textarea:** 44px min-height, 12px radius, `1px solid --meta` (3:1 floor), Ivory bg, focus = Focus Blue border + ring. Placeholders in Stone Gray.
- **Answer rows:** 64px min-height, 12px radius, hairline border; selected = terracotta border + 6% tint + filled radio dot; hover border → Stone Gray; locked/answered rows get no hover color change.
- **Pills:** pill radius, 12px/500, dot + label always; variants = accent (12% tint), muted (Warm Sand), success (12% tint, darkened text), warn (10–12% plate), danger (10% tint — scarce).
- **Meters:** 8px pill track in Warm Sand; evidence fills in `--fg-2`; green variant for mastered. Empty evidence = empty track + "No evidence yet", never a fabricated 0%.
- **Cards:** Ivory, hairline Cream border, 8px radius, 24px padding; featured containers 16px.
- **Callouts:** 2px terracotta left rule on Ivory; serif variant for promise/quotes.
- **Code blocks:** Near Black bg, Warm Sand text, 12px radius, mono 14px/1.6.
- **Notices/inline errors:** 10% warn plate + 35% warn border, Dark Warm text, 12px radius.
- **Dialogs/toasts:** overlays carry the whisper shadow; focus-managed per §5; reduced-motion gated.
- **Nav:** 240px sidebar (Warm Sand selected fill) → top nav below 850px; sticky topnav with blurred Parchment at 92%.

## 8. Changelog vs the previous spine

Each revisited decision needs an explicit memlog entry in the ux folder when this revision is adopted (§9 stubs below).

**Revisited (5):**

1. **Shadows.** Tonal-only is replaced by ring shadows (`0 0 0 1px` warm hairlines) plus one whisper shadow restricted to overlays/floating elements. No gradients. (Brief §3 move 4.)
2. **Color semantics.** Lime/olive mapping replaced by §2's table: terracotta = attention/live/selected/primary; green = confirmed/mastered; list/nav selection = neutral Warm Sand; focus = Focus Blue. Status never color alone.
3. **Palette identity.** The green-ink identity is retired in favor of the warm-neutral + terracotta system (Direction B variant executed on the active openDesign design system). Largest departure from the brief's original "evolve, don't discard" stance; was an explicit working-session instruction.
4. **Typography dependency.** Resolved to zero new dependencies — Georgia + system stacks only. A self-hosted serif remains an option, not a requirement.
5. **Motion timings.** Panels 200ms (was proposed 250ms).

**Refined within the revision (2026-10-23 a11y sweep, no new spine decision):** `--meta` darkened `#87867f → #6d6c64` and `--accent-strong #a55236` (+hover/active) added after numeric contrast verification found 3.3:1 metadata text and 3.7:1 primary-button labels — both below the §5 floor. `#c96442` is retained for 3:1-context uses only (borders, fills, dots, large text). Skip-to-content links added to every screen (floor item that had not landed).

**Kept intact:** light mode only; English-only; no gamification; honest states; no UI component library; WCAG 2.2 AA floor; CSP self-hosting constraint; breakpoints, 240px sidebar, 1400px content cap, 44px/64px targets.

**Behavior changes:** none. All 22 screens + setup flow + states gallery follow the validated experience spine; no experience-spine amendments to flag.

## 9. Memlog entries to write on adoption

One entry per revisited decision, to be filed in `_bmad-output/initiative-ai-learning-platform/ux-ai-learning-platform/` when this DESIGN.md revision is adopted:

1. `memlog: elevation policy — tonal-only → ring shadows + whisper overlay shadow` (rationale: modern-warm depth without breaking the no-gradients rule; overlays only).
2. `memlog: color semantics — lime/olive → terracotta/success/warn mapping` (rationale: single-accent budget; contrast pairs re-validated on parchment; amber replaces red for missed/partial states).
3. `memlog: palette identity — green ink retired for warm-neutral + terracotta` (rationale: explicit working-session direction; largest departure, recorded deliberately).
4. `memlog: typography — Georgia/system stacks adopted, webfont dependency dropped` (rationale: "designed, not default" achieved without a plan-authorized dependency; CSP untouched).
5. `memlog: motion — panel timing 250ms → 200ms` (rationale: trim for calm; reduced-motion gating unchanged).
6. `memlog: a11y conformance fixes — meta gray darkened, deep-terracotta action token added` (rationale: 2026-10-23 sweep found sub-4.5:1 pairs at small sizes; token-level fix keeps the WCAG 2.2 AA floor without altering semantics).

## 10. What ships with this revision

- `foundations.html` — token sheet + component kit (canonical styling specs, §7).
- 22 screen files (Groups 1–3), `setup-flow.html` (U0–U8), `states.html` (system-states gallery); `index.html` launcher.
- `exports/` — 52 per-screen PNGs: `<screen>-desktop.png` at 1440px and `<screen>-mobile.png` at 360px. Sticky chrome is rendered static in captures; faint seam lines in tall pages are exporter tiling artifacts.
- Redesign brief §3 "Decision recorded" + §9 changelog — per-screen design decisions and their rationale, plus the 2026-10-23 accessibility-sweep results.
- Accessibility sweep (build-order step 5): **done 2026-10-23** — see §8 "Refined within the revision" and brief §9.
