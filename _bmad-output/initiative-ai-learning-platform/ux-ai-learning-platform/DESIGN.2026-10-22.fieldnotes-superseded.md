---
name: Fieldnotes
description: Calm field-journal learning workspace — warm paper, deep-green ink, editorial serif, one lime accent for what is alive; formalizes the approved screenshot prototype's look.
status: final
created: 2026-10-21
updated: 2026-10-22
sources:
  - ../initiative-ai-learning-platform.md
  - ../../../src/app/globals.css
  - ../../../src/app/demo/demo.module.css
colors:
  ink: '#193c36'
  muted: '#52635d'
  paper: '#f7f6f1'
  surface: '#fffefa'
  soft: '#edf0e6'
  line: '#d7dfd6'
  line-strong: '#c6d0c3'
  lime: '#d8e88c'
  lime-border: '#b7cc6c'
  olive: '#486600'
  olive-soft: '#9caf61'
  selected-bg: '#f0f5de'
  current-course: '#edf2d8'
  danger: '#8b2926'
  danger-bg: '#fff0e9'
  hero-muted: '#dbe4db'
  hero-line: '#577067'
  code-text: '#eff3e4'
  disabled-bg: '#e2e7db'
  disabled-fg: '#53645c'
  disabled-border: '#aab5a5'
  input-border: '#7a8b81'
  input-border-soft: '#aab79e'
typography:
  display-xl:
    fontFamily: Georgia, serif
    fontSize: clamp(2rem, 3.1vw, 3.25rem)
    fontWeight: '400'
    lineHeight: '1.1'
    letterSpacing: -0.045em
  display:
    fontFamily: Georgia, serif
    fontSize: 1.75rem
    fontWeight: '400'
    lineHeight: '1.2'
    letterSpacing: -0.025em
  title-md:
    fontFamily: Georgia, serif
    fontSize: 1.5rem
    fontWeight: '400'
    lineHeight: '1.3'
  title-sm:
    fontFamily: Georgia, serif
    fontSize: 1.25rem
    fontWeight: '400'
    lineHeight: '1.3'
  metric:
    fontFamily: Georgia, serif
    fontSize: 2.5rem
    fontWeight: '400'
    lineHeight: '1.2'
  body:
    fontFamily: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif
    fontSize: 0.875rem
    fontWeight: '400'
    lineHeight: '1.6'
  meta:
    fontFamily: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif
    fontSize: 0.75rem
    fontWeight: '400'
    lineHeight: '1.5'
  fine:
    fontFamily: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif
    fontSize: 0.65rem
    fontWeight: '400'
    lineHeight: '1.5'
  overline:
    fontFamily: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif
    fontSize: 0.625rem
    fontWeight: '700'
    lineHeight: '1.6'
    letterSpacing: 0.14em
  tagline:
    fontFamily: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif
    fontSize: 0.5rem
    fontWeight: '600'
    lineHeight: '1.6'
    letterSpacing: 0.12em
  mono:
    fontFamily: ui-monospace, SFMono-Regular, Consolas, monospace
    fontSize: 0.85em
    fontWeight: '400'
    lineHeight: '1.7'
rounded:
  sm: 0.25rem
  md: 0.375rem
  full: 9999px
spacing:
  xs: 0.25rem
  sm: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  '2xl': 2rem
  '3xl': 2.5rem
  '4xl': 3rem
  margin-mobile: 1rem
  margin-desktop: clamp(1.5rem, 3.5vw, 3.5rem)
  content-max: 1400px
  sidebar-width: 240px
components:
  button-primary:
    background: '{colors.ink}'
    color: '{colors.surface}'
    border: '1px solid {colors.ink}'
    radius: '{rounded.sm}'
    minHeight: 44px
    padding: 0.75rem 1.125rem
    typography: '{typography.body}'
  button-lime:
    background: '{colors.lime}'
    color: '{colors.ink}'
    border: '1px solid {colors.lime}'
    radius: '{rounded.sm}'
    minHeight: 44px
  button-secondary:
    background: transparent
    color: '{colors.ink}'
    border: '1px solid {colors.ink}'
    radius: '{rounded.sm}'
    minHeight: 44px
  button-danger:
    background: '{colors.danger}'
    color: '#ffffff'
    border: '1px solid {colors.danger}'
    radius: '{rounded.sm}'
    minHeight: 44px
  panel:
    background: '{colors.surface}'
    border: '1px solid {colors.line}'
    radius: '{rounded.md}'
    padding: 1.5rem 2rem
  hero:
    background: '{colors.ink}'
    color: '{colors.surface}'
    radius: '{rounded.md}'
    label-color: '{colors.lime}'
  roadmap-node:
    background: '{colors.surface}'
    border: '1px solid {colors.line}'
    current-variant-background: '{colors.current-course}'
  pill:
    background: '{colors.soft}'
    border: '1px solid {colors.line-strong}'
    radius: '{rounded.full}'
    typography: '{typography.overline}'
  callout:
    background: '{colors.soft}'
    border-left: '3px solid {colors.olive-soft}'
    radius: none
  answer-option:
    background: '{colors.surface}'
    border: '1px solid {colors.input-border}'
    radius: '{rounded.sm}'
    minHeight: 64px
    selected-background: '{colors.selected-bg}'
    selected-border: '2px solid {colors.olive}'
  feedback:
    background: '{colors.soft}'
    border-left: '3px solid {colors.olive}'
  code-block:
    background: '{colors.ink}'
    color: '{colors.code-text}'
    radius: '{rounded.sm}'
    comment-color: '{colors.lime}'
    typography: '{typography.mono}'
  notice:
    background: '{colors.danger-bg}'
    border-left: '3px solid {colors.danger}'
  sample-badge:
    background: '{colors.lime}'
    color: '{colors.ink}'
    border: '1px solid {colors.lime-border}'
    radius: '{rounded.full}'
  evidence-meter:
    fill: '{colors.olive}'
    track: '{colors.soft}'
  input:
    background: '#ffffff'
    color: '{colors.ink}'
    border: '1px solid {colors.input-border}'
    radius: '{rounded.sm}'
    padding: 0.65rem
    minHeight: 44px
    textarea-minHeight: 96px
    disabled-background: '{colors.disabled-bg}'
    disabled-color: '{colors.disabled-fg}'
    disabled-border: '1px solid {colors.disabled-border}'
  focus-ring:
    outline: '3px solid {colors.olive}'
    outline-offset: 4px
    outline-on-ink: '3px solid {colors.lime}'
---

## Brand & Style

Fieldnotes is a learning workspace that behaves like a naturalist's field journal: observe, note, revisit. The tagline — *A LITTLE MORE UNDERSTOOD.* — is the brand's whole argument. Learning is gradual and evidence-based, never gamified; the interface's job is to make honest state visible and get out of the way.

The posture is **quiet editorial**: a serif voice (Georgia) for headlines and the brand, a neutral system sans for everything working, warm paper surfaces with a deep-green ink, hairline separations instead of shadows, and exactly one bright note — lime — meaning *this is alive / look here now*. No streaks, no confetti, no percent-complete theatrics; a completed roadmap node or a cleared recovery target is shown plainly, because plainness is the reward.

This spine formalizes the look of the already-approved screenshot prototype and tracer application. Where a future screen has no prototype precedent, derive from these tokens rather than invent.

**Visual references.** The living prototypes are the mock set for this run: the sample study experience at `/demo` (overview), `/demo/lesson`, `/demo/practice`, `/demo/progress` (`src/app/demo/`), and the tracer workspace at `/` (`src/app/study-app.tsx`); the local screenshot set lives under `.local/demo-screenshots/` and `artifacts/Fieldnotes-Desktop-Demo.docx`. In-run mocks: `mockups/key-review-inbox.html`, `mockups/key-instructor-approvals.html`. Spines win on conflict with any of them.

## Colors

A paper-and-ink palette with one accent; every color earns its place.

- **Ink (`{colors.ink}`)** is the voice: body text, primary buttons, the inverted hero panel, selected navigation. Deep green, not black — the journal is organic, not corporate.
- **Paper (`{colors.paper}`)** is the page; **Surface (`{colors.surface}`)** is a card or panel sitting on the page; **Soft (`{colors.soft}`)** is the sidebar and quiet fill beneath callouts and answer rows. Tonal layering paper → soft → surface does the work shadows do elsewhere.
- **Line (`{colors.line}`)** and **Line-strong (`{colors.line-strong}`)** are hairline separators — 1px, never heavier. Structure is drawn, not shadowed.
- **Lime (`{colors.lime}`)** is the single attention color: hero labels, overlines on ink, sample badges, the in-flight arrow, code comments, numerals in ink circles. It signals *live/attention*, never error, never decoration on paper surfaces — a product-wide extension of its prototype roles, decided 2026-10-21. Never place lime text on paper; its contrast role is on ink or as a background fill with ink text.
- **Olive (`{colors.olive}`)** is confirmation and focus: the focus ring, selected answer borders, feedback rules, meter fills. Selection states are olive; lime never marks selection.
- **Danger (`{colors.danger}`)** with **Danger-bg (`{colors.danger-bg}`)** is reserved for destructive actions and failure notices. The prototype's only red family; keep it that scarce.
- **Supporting text tones** — **Muted (`{colors.muted}`)** is secondary text; **Hero-muted (`{colors.hero-muted}`)** and **Hero-line (`{colors.hero-line}`)** are the legible quieter tones on ink panels; `{colors.disabled-bg}` / `{colors.disabled-fg}` / `{colors.disabled-border}` dress inactive controls.
- **Control boundary tones** — `{colors.input-border}` edges every field and resting option row (darkened one step from the prototype's `#89998e`, decided 2026-10-21, so a control boundary reaches 3:1 on every light surface); `{colors.input-border-soft}` is decorative only — figure rules and quiet dividers, never the sole cue that identifies a control.

Light mode only (decided 2026-10-21; dark tokens are deferred until a real need is named). No gradients.

**Contrast (measured, WCAG 2.2).** Every text pairing meets AA for normal text; all but muted and olive meet AAA. Disabled text (5.0:1) is exempt but still legible. New pairings — text or non-text — must be measured, not eyeballed.

| Text pairing | Ratio | Level |
|---|---|---|
| ink on paper · surface · soft | 11.2 · 12.0 · 10.5 | AAA |
| ink on selected-bg · current-course | 10.8 · 10.5 | AAA |
| muted on paper · surface · soft | 5.9 · 6.3 · 5.5 | AA |
| surface on ink (hero) | 12.0 | AAA |
| hero-muted on ink | 9.3 | AAA |
| lime on ink / ink on lime | 9.1 | AAA |
| olive on paper · selected-bg | 6.1 · 5.9 | AA |
| danger on danger-bg | 7.7 | AAA |
| white on danger | 8.6 | AAA |
| code-text on ink | 10.7 | AAA |

| Non-text pairing (1.4.11, ≥3:1 for anything identifying a control or state) | Ratio |
|---|---|
| input-border on surface · paper · soft · selected-bg | 3.6 · 3.3 · 3.1 · 3.2 |
| olive focus ring on paper · surface · soft | 6.1 · 6.6 · 5.7 |
| lime focus ring on ink | 9.1 |
| selected answer border (olive on selected-bg) | 5.9 |
| meter fill vs track (olive on soft) | 5.7 |
| hairline separators (`{colors.line}`) — decorative, never the only cue | 1.4 |
| callout left rule (`{colors.olive-soft}` on soft) — decorative, never the only cue | 2.1 |

## Typography

Two voices. Georgia carries the editorial moment: `{typography.display-xl}` for page titles (optically tightened, `text-wrap: balance`), `{typography.display}` for section heads, `{typography.title-md}`/`{typography.title-sm}` for card titles, `{typography.metric}` for the rare big number. The system sans carries all work: `{typography.body}` at the product's compact 14px-equivalent density, `{typography.meta}` and `{typography.fine}` for secondary matter. `{typography.overline}` (tracked-out 0.14em) labels sections and nav groups; `{typography.tagline}` is reserved for the brand caption. `{typography.mono}` is for code, file names, answer letters, sequence numbers — anything machine-adjacent.

Serif is punctuation, not default: body text never sets Georgia; display sizes never set the sans. Big display moments appear at most once per view. Size floor: anything a person must read to act or to understand their evidence — rules, receipts, scoring caveats, approval records — is set at `{typography.meta}` (12px) or larger; `{typography.fine}` and `{typography.tagline}` are for furniture and brand decoration only.

## Layout & Spacing

A two-pane workspace: sidebar (`{spacing.sidebar-width}`, `{colors.soft}`, sticky) + content column capped at `{spacing.content-max}`, centered. Content padding is fluid (`{spacing.margin-desktop}` desktop, `{spacing.margin-mobile}` at ≤600px). The spacing scale is the prototype's rem ladder — `{spacing.xs}` to `{spacing.4xl}`; the big steps (2–3rem) separate major sections; small steps sit inside components. Forms stack vertically with `{spacing.md}` gaps; the primary action follows the inputs; destructive actions live in a separated danger zone at the foot of a view, never inline with primary work.

Asymmetric two-column article grids (content ~1.8fr / aside 1fr) drive lesson, practice and progress views; three-up grids only for roadmap nodes and evidence columns, collapsing to one column by 600px. Avoid dense horizontal tables at narrow widths — rows re-flow; they don't scroll sideways.

## Elevation & Depth

Depth is **tonal, not shadowed**: `{colors.soft}` against `{colors.paper}`, `{colors.surface}` panels against both, and ink-inverted panels (`{components.hero}`) for the single most important moment on a view. Hairline borders in `{colors.line}` separate; the only sanctioned "lift" is the ink hero or a lime fill, not a box-shadow. No shadow tokens exist in either prototype stylesheet; introducing shadows would break the system.

## Shapes

Corners are modest and functional: `{rounded.sm}` on controls, inputs, and code; `{rounded.md}` on panels, cards, and hero; `{rounded.full}` for tags and status badges, and on square glyphs (numbered steps, diagram points) where it renders a circle. The prototype's 0.2rem input radius and 2rem badge radius are normalized to `{rounded.sm}` and `{rounded.full}`, respectively. Imagery and code blocks follow their container's radius exactly.

## Components

Each component names its behavior-free visual contract; behavior lives in EXPERIENCE.md.

- **Buttons** — `{components.button-primary}` (ink fill), `{components.button-lime}` (the single attention-CTA, used sparingly: sample-mode cues, demo entries), `{components.button-secondary}` (outline), `{components.button-danger}` (destructive only). All 44px minimum height; hover underlines rather than glowing; disabled uses `{colors.disabled-bg}` / `{colors.disabled-fg}` / `{colors.disabled-border}` with unchanged layout.
- **Input** — `{components.input}`: text fields, selects, textareas and the file picker share one contract — white field on any light surface, `{colors.input-border}` edge, `{rounded.sm}`, 44px minimum height, textareas 96px minimum with vertical resize, labels in `{typography.body}` semibold above the field. Checkboxes and radios stay native with `accent-color` ink; when a choice needs a large target it becomes an answer option.
- **Panel** — `{components.panel}`; the default container for forms, evidence and settings groups.
- **Hero** — `{components.hero}`: the ink-inverted opener (library welcome, lesson opener); lime labels via `{colors.lime}`, quieter text in `{colors.hero-muted}`, internal rules in `{colors.hero-line}`. At most one per view.
- **Roadmap node** — `{components.roadmap-node}`: card per mini-course with course number overline, serif title, status text; the current course tints with `{colors.current-course}`. Status is text + pill indicators, never icon-only.
- **Callout / rule note** — `{components.callout}`: the field-journal aside (lesson promise, scoring rule, notebook tip). Serif lead line allowed at `{typography.title-sm}`.
- **Answer option** — `{components.answer-option}`: generous 64px rows edged in `{colors.input-border}`; selected state is `{colors.selected-bg}` with a 2px `{colors.olive}` border (border growth compensated by padding so text never shifts).
- **Feedback** — `{components.feedback}`: post-submission explanation block, olive-ruled; meta line in `{typography.fine}`.
- **Code block** — `{components.code-block}`: ink background for inline/course code; comments in lime.
- **Notice** — `{components.notice}`: errors and warnings; danger-ruled on `{colors.danger-bg}`.
- **Pill / sample badge** — `{components.pill}` for status; `{components.sample-badge}` marks sample/test-mode surfaces (visibility rules: EXPERIENCE.md, Sample badge).
- **Evidence meter** — `{components.evidence-meter}`: native meter semantics, olive fill on soft track (labeling rules: EXPERIENCE.md, Accessibility Floor).
- **Focus ring** — `{components.focus-ring}`: olive on paper, surface, and soft; lime (`outline-on-ink`) on ink surfaces such as the hero and code block, where olive would vanish (universality rules: EXPERIENCE.md, Interaction Primitives).

## Do's and Don'ts

| Do | Don't |
|---|---|
| Use lime for *attention/live* and olive for *selection/confirmed* | Swap them, or use lime decoratively on paper surfaces |
| Serif for one display moment per view | Set body copy in Georgia, or headlines in the sans |
| Hairlines (`{colors.line}`) and tonal layers for structure | Box-shadows, gradients, or borders heavier than 1px |
| Text + status together ("Completed", "Review due") | Icon-only state, or color-only meaning |
| 44px touch targets, 64px answer rows, olive focus ring (lime on ink) | Shrink targets below the floor, remove focus outlines |
| Consequential text at 12px or larger; `fine` for furniture only | Set rules, receipts or evidence caveats in `fine` or `tagline` |
| Keep danger red scarce (destruction, failure) | Red for emphasis, branding or "you're behind" pressure |
| Plain completion — a state change, not a celebration | Confetti, streaks, XP, or animated praise |
