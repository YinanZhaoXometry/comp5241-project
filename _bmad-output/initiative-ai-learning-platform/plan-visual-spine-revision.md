   # Plan — Fieldnotes visual spine revision (src/app implementation)

**Status:** **approved 2026-10-23** by user direction ("implement parallely, if one of the pages is already implemented then we can just update the style and the page"); implementation began the same day. Filing this plan and marking it approved is the act that authorizes the work below, per `redesign-opendesign-brief.md` §8.
**Implementation note (2026-10-23):** skip-to-content is provided per shell rather than in the root layout — a root-level link would precede the demo shell's own "Skip to sample content" link in tab order and break the existing keyboard-contract browser test; every route already carries a skip link via `study-app.tsx` or `demo-shell.tsx`, so the §7 acceptance outcome is unchanged.
**Date:** 2026-10-23
**Pattern:** follows `plan-screenshot-study-prototype.md` — explicit scope, explicit dependencies, explicit constraints.
**Design source of truth:** `DESIGN.md` (revised spine, openDesign deliverable) + 26 reference HTML files + `exports/` (desktop 1440 / mobile 360 PNGs per screen).
**Experience spine:** unchanged. Behavior changes: **none** — see DESIGN.md §8. This plan restyles only.

---

## 1. Goal

Replace the current visual layer (tokens, type, shape, depth, iconography, component styling) across `src/app` with the revised spine: parchment/ivory/warm-sand surfaces, terracotta action system, warm-only gray ramp, serif display at weight 500, 8/12/16px radii, ring elevation + whisper shadow on overlays only. Zero behavior changes; zero new runtime dependencies.

## 2. Explicitly authorized by this plan

When approved, this plan authorizes:

1. **Token replacement** in `src/app/globals.css`: swap the Fieldnotes green-ink token set for the revised sheet (DESIGN.md frontmatter), including `--accent-strong` and the `--meta` contrast fix.
2. **Component restyle** across all `*.module.css` files to match the §7 kit recipes in DESIGN.md (buttons, inputs, 64px answer rows, pills, meters with dark `fg-2` fills, cards, callouts, code blocks, notices, dialogs, nav).
3. **Screen restyle** for every route in the rollout order in §5, matching the openDesign reference files and exports.
4. **A skip-to-content link** added to every screen (a11y sweep finding — it was spine floor since 2026-10-22 and never landed).

Nothing else is authorized. In particular, **not authorized**: route changes, IA changes, state-machine changes, copy rewrites beyond token-adjacent labels, dark mode, Cantonese, gamification of any kind.

## 3. Dependencies — none added

This plan explicitly authorizes **zero new dependencies**:

- **No webfonts.** Display is Georgia/system serif; UI is the system sans stack. The brief's "type upgrade" move was resolved in favor of zero-dependency system stacks (brief §3, decision recorded). CSP `font-src 'self'` is untouched and unexercised.
- **No icon package.** Icons are inline SVG (Lucide-style 1.5px rounded stroke) hand-placed per the reference files.
- **No component library.** Hand-rolled CSS on Tailwind base + CSS Modules, as today.

If implementation later wants a webfont or icon package, that requires a plan amendment — it is not covered here.

## 4. Technical constraints (preserve exactly)

- CSP unchanged: `font-src 'self'`, `img-src 'self' data:`. No CDN fonts, no remote imagery.
- The `*.module.css` Tailwind-loader exclusion must be preserved; do not route module CSS through the Tailwind pipeline to "simplify" the migration.
- Tailwind base stays; do not adopt Tailwind utilities for the new tokens — tokens live as CSS custom properties in `globals.css`, consumed by modules.
- No raw hex outside the `:root` token block. Hover/active variants come from the token sheet or `color-mix()` on tokens.
- `prefers-reduced-motion` gating preserved and extended to any new transition (150ms hover / 250ms panel, ease-out).

## 5. Rollout order (matches brief §5)

| Phase | Scope | Compare against |
|---|---|---|
| 0 | `globals.css` token swap + `--accent-strong` / `--meta` additions; skip-to-content in root layout | DESIGN.md frontmatter |
| 1 | Component kit in shared modules (buttons, inputs, pills, meters, cards, dialogs, notices) | `foundations.html`, `states.html` |
| 2 | Group 1 screens (code exists): sign-in, library, new-study materials, new-study goal & plan, privacy & data, demo shell + overview, mini-course player sample, practice sample, progress sample | `sign-in.html`, `library.html`, `new-study-materials.html`, `new-study-plan.html`, `privacy-data.html`, `demo-overview.html`, `course-player.html`, `practice.html`, `progress.html` |
| 3 | Group 2 (new screens, main value): full course player, full practice, test & recovery, roadmap — full, review inbox, why-explorer, starting check, AI-assisted plan variant, owner export | `course-player-full.html`, `practice-full.html`, `test-recovery.html`, `roadmap.html`, `review-inbox.html`, `why-explorer.html`, `starting-check.html`, `new-study-plan-ai.html`, `owner-export.html` |
| 4 | Group 3 instructor shell: courses, approvals, students, participation | `instructor-*.html` |
| 5 | Setup flow U0–U8 + system states (loading/empty/error/offline/dialogs/danger) as shared patterns | `setup-flow.html`, `states.html` |
| 6 | Accessibility verification pass (§6) before merge | brief §6 checklist |

Each phase lands behind its own commit; phases 2–4 may be parallelized by screen.

## 6. Token migration map (old → new)

| Old token | New token | Note |
|---|---|---|
| ink `#193c36` | `--fg` `#141413` | warm near-black replaces green ink |
| muted `#52635d` | `--muted` `#5e5d59` / `--meta` `#6d6c64` | meta darkened for ≥4.5:1 (a11y fix) |
| paper `#f7f6f1` | `--bg` `#f5f4ed` | parchment |
| surface `#fffefa` | `--surface` `#faf9f5` | ivory |
| soft `#edf0e6` | `--surface-warm` `#e8e6dc` | sidebar / quiet buttons |
| line `#d7dfd6` / line-strong `#c6d0c3` | `--border` `#f0eee6` / `--border-soft` `#e8e6dc` | input borders keep ≥3:1 variant per DESIGN.md §5 |
| lime `#d8e88c` (attention/live) | terracotta `#c96442` system + `--warn` plates | semantics remapped per DESIGN.md §2 — **this is the flagged semantic change** |
| olive `#486600` (selection/focus) | `--success` / selection tints; focus → Focus Blue `#3898ec` ring | focus ring is now a 3px blue halo, not olive outline |
| danger `#8b2926` | `--danger` `#b53333` | still scarce; danger zone stays quiet-bordered until confirm step |
| Georgia display | unchanged (Georgia/system serif), weight 500 ceiling, new scale | no font dependency |
| radius 4/6px + 999 pills | 8 / 12 / 16px + pill | — |
| tonal depth only | ring elevation + whisper `0 8px 24px rgba(20,20,19,.08)` **on overlays/floating elements only** | spine decision recorded in DESIGN.md §8 |

Full new sheet: DESIGN.md frontmatter — that document wins any conflict with this table.

## 7. Acceptance criteria

- [ ] Every §6 constraint from the brief verified on every screen: body text ≥4.5:1, large text/UI ≥3:1, visible focus ring on every interactive element including dark surfaces, ≥44px targets, ≥64px answer rows, 360px single-column with sidebar → top nav below 850px, reduced-motion respected.
- [ ] Skip-to-content present and functional on every route.
- [ ] Zero new dependencies in `package.json`; CSP string unchanged; `*.module.css` exclusion intact.
- [ ] No raw hex outside the `:root` token block (grep check).
- [ ] Visual diff against `exports/` PNGs: no unintended layout/behavior drift; token-level differences only.
- [ ] Honesty labels intact: "Sample prototype · No live AI" on demo screens; tracer labels on tracer screens.
- [ ] Behavior parity: existing tests pass unchanged (no test edits needed — nothing about behavior changed).

## 8. Rollback

Pure visual layer: revert is `git revert` of the phase commits. Token swap (phase 0) is a single file; keep the old token block in git history only — do not ship both sheets side by side behind a flag (no theming infrastructure is authorized).

## 9. Governance cross-references

- Spine revision record: `DESIGN.md` §8 changelog, §9 memlog stubs (6 entries — file them in the ux folder when this plan is approved).
- Working brief: `redesign-opendesign-brief.md` (§8 governance — this plan is the "new plan/story" it requires).
- A11y sweep results and export locations: brief §7.
- Reminder: this plan covers stories beyond the currently authorized 1–2; approval here is what extends authorization. Until then, `src/app` stays untouched.
