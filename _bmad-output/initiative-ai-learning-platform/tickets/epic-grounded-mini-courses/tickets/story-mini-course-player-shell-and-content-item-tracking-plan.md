---
title: 'Mini-course player shell and content-item tracking'
type: 'feature'
ticket: '2.3'
created: '2026-10-27'
status: 'built'
baseline_revision: '16a6c1e'
route: 'full'
route_source: 'auto'
risk: 'medium'
review: ''
review_source: ''
lenses_ran: []
review_loop_iteration: 0
context:
  - '{project-root}/AGENTS.md'
  - '{project-root}/_bmad-output/initiative-ai-learning-platform/tickets/epic-grounded-mini-courses/delivery-checks.md'
  - '{project-root}/_bmad-output/initiative-ai-learning-platform/ux-ai-learning-platform/EXPERIENCE.md'
  - '{project-root}/_bmad-output/initiative-ai-learning-platform/ux-ai-learning-platform/DESIGN.md'
  - '{project-root}/docs/project-structure.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The tracer serves exactly one lesson with no study shell — the plan's full lesson set, the spine's player furniture, and explicit content-item tracking are missing, and the "course not generated" copy stays stale after generation.

**Approach:** Extend generation to the confirmed plan's full lesson/objective set (content v2 with per-lesson sections plus required/optional tracker items, backward-compatible serving of stored v1 single-lesson courses), and rebuild the course view as the spine's player shell: numbered lesson sequence, sticky sidebar collapsing under 850px, content-item tracker with server-persisted explicit mark-done for required items and labeled non-blocking optional enrichment, honest processing/empty/version-superseded states, media-floor rules, and shared help/footer furniture. Make the library line and plan-editor confirmed heading course-aware (the 2.1 deferred P3 lands here — S3's verify owns these states).

**Gate decisions (2026-10-27):** covered by the owner's "continue to implement all the rest tickets of epic 2" direction; per-ticket checkpoints proceed under the standing decision delegation (surfaced, logged, renegotiable). No new processor-configuration version is needed: v6's purpose/categories already cover multi-lesson generation from the confirmed plan (no new data leaves the machine; the synthetic fixture stays the only processor).

## Boundaries & Constraints

**Always:**
- Content v2 stays honest to the plan: every lesson title comes from the confirmed plan's own lesson list (parser substitution as in 2.1); objectives/outcome links resolve; required items are the lessons themselves plus their readings, optional enrichment is generated labeled and never blocks anything; no completion/score/credit semantics (epic 3), no dwell/scroll tracking — done is ONLY an explicit learner action.
- Stored v1 courses keep serving unchanged (legacy parse path or schema union; existing dev rows must still open) — no regeneration-on-read, no silent rewrite.
- Mark-done persistence: owner-scoped, course-version-scoped rows with command envelopes and idempotent replay; deleting the root purges tracker rows with the course lineage; cross-owner and foreign-version denials use the standard taxonomy; prior versions keep their own tracker state (version-superseded learners stay on the studied version until explicitly switching).
- Player shell per the spine: numbered lesson sequence, sticky sidebar collapsing under 850px, keyboard-complete at 360px and desktop with the olive focus ring visible, skip-to-content behavior consistent with the app shell, focus choreography on lesson navigation, honest ≥120 s processing and "Plan confirmed — course not generated" empty states, version-superseded notice; media floor rules stated and enforced structurally (no autoplay/no-tracking contracts; text-only content in this entry).
- No per-family activity interaction contract (epic 6 deferral stands): the player renders lesson text/items only and claims nothing about simulations/role-play/games/slides/coding.
- Additive migration `017` (tracker state table; no changes to existing tables beyond none) via `scripts/migrate.ts`; tests unit+integration+browser, zero skips; `docs/project-structure.md` in the same change; Node v24.22.0, loopback-only, no new dependencies, no live dispatch.

**Never:**
- No scored items, awards, locks, streaks or completion credit; no dwell/scroll/visibility-based completion inference; no per-family activity surfaces; no AI provider changes; no new egress.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Multi-lesson generate | confirmed plan with 1–8 lessons | course v2: every plan lesson present in order, each with sections + item rows (required lesson reading; optional enrichment labeled) | — |
| Study (player) | ready v2 course | numbered lesson sequence; per-lesson content; tracker shows required items with explicit mark-done + optional labeled non-blocking | — |
| Stored v1 course | pre-2.3 ready course | serves unchanged (legacy shape) in the same player shell (single lesson) | — |
| Mark done | learner clicks mark-done | server persists idempotently (command envelope); tracker reflects done; no other effect | replay returns same state |
| Optional item | optional enrichment viewed | labeled; never marks required; never blocks navigation | — |
| Keyboard-only | 360px and desktop | full navigation operable by keyboard, visible focus, no horizontal scroll | — |
| Processing ≥120 s / empty | pending past cap; confirmed, ungenerated | honest still-processing with reference; "Plan confirmed — course not generated." empty state | — |
| Version superseded | newer ready version exists | studied version stays until explicit switch; switch shows what changed; per-version tracker state | — |
| Cross-owner / deleted | B on A's course; deleted root | 404 no-leak; purge removes tracker rows | — |
| Library/heading honesty | generated study in library list | library line and plan-editor heading no longer claim "course not generated" when one exists | — |

</frozen-after-approval>

## Code Map

- `src/contracts/courses.ts` — content v2 (lessons array, per-lesson sections, items with required flag), legacy v1 union parse, tracker-state schemas/commands; serving shapes extend `CourseView`.
- `src/modules/course-generation/{generation,repository,service,worker}.ts` (2.1/2.2) — fixture emits per-lesson sections/items bounded by the plan; strict parser validates lesson titles/order and item links; `getCourse` serves v1/v2; mark-done service verbs beside recall; tracker queries; purge extension.
- `src/modules/materials-setup/service.ts` `listStudies`/`getStudy` — add a course-generated signal (content-free) for honest library/heading copy; `src/app/study-app.tsx` library line + `src/app/plan-editor.tsx` confirmed heading consume it.
- `src/app/course-stage.tsx` — grows into the player shell (sidebar + sequence + tracker); may split into `src/app/course-player/` components if clearer — keep functional-panel styling (global classes), kit.module.css only if a screen-like surface appears.
- `migrations/015/016` — table/precedent references; new `017` mirrors the derivative-table pattern (owner_id, course_id CASCADE, item identity, done_at, UNIQUE(owner, course, item), command-receipt replay via existing machinery — no new receipt table).
- `src/app/api/v1/[...path]/route.ts` — tracker verbs (`studies/{root}/course/track` POST or item-scoped equivalent) + course GET unchanged.
- EXPERIENCE.md Component Patterns (Content-item tracker), State Patterns (Version superseded, Processing ≥120 s, Empty surface), Interaction Primitives, Accessibility Floor; DESIGN.md tokens for the sidebar/sequence styling.
- Tests to extend: `tests/unit/course-generation.test.ts` (v2 parser/legacy union), `tests/integration/course-generation.test.ts` (multi-lesson, tracker persistence/idempotency/purge, v1 serving, library signal), `tests/browser/course.spec.ts` (player journey keyboard 360px/desktop, mark-done, optional label, superseded notice, honest states).

## Tasks & Acceptance

**Execution:**
- [x] `migrations/017-course-tracking.sql` — `app.course_item_state` (owner, course_id CASCADE, item id, done_at, UNIQUE) + idempotent guards; lifecycle purge/preview extension.
- [x] `src/contracts/courses.ts` — content v2 + legacy v1 parse union; tracker schemas; serving shapes (lessons, items, done states, per-version).
- [x] `src/modules/course-generation/generation.ts` — fixture + parser: per-lesson sections from acknowledged sources (fair distribution), required reading item per lesson, one labeled optional enrichment item overall; titles/order from the plan; bounds checked.
- [x] `src/modules/course-generation/service.ts` — `getCourse` v1/v2 serving; `markItemDone`/tracker read (command envelope, replay, owner/version scoping); generated-signal for listStudies/getStudy.
- [x] `src/modules/course-generation/repository.ts` — tracker queries + purge helpers wiring.
- [x] `src/app/course-stage.tsx` (+ player components if split) — player shell: sticky sidebar (collapses <850px), numbered sequence, tracker with explicit mark-done + optional labels, focus choreography, honest processing/empty/superseded states, help/footer furniture, media-floor copy.
- [x] `src/app/study-app.tsx` + `src/app/plan-editor.tsx` — course-aware library line and confirmed heading (S3 verify owns these states; update dependent assertions).
- [x] `src/app/api/v1/[...path]/route.ts` — tracker routes.
- [x] Tests: unit (v2 parse/legacy union/items), integration (multi-lesson + tracker + purge + v1 serving + generated signal), browser (player keyboard journey 360px + desktop, mark-done, optional, superseded, no-dwell assertion).
- [x] `docs/project-structure.md` — same-change map update.

**Acceptance Criteria:**
- Given a confirmed multi-lesson plan, when generated, then the course contains every plan lesson in order with tracker items (required readings; optional enrichment labeled) and serves studyable in the player shell keyboard-only at 360px and desktop.
- Given a required item, when the learner marks it done, then the state persists idempotently server-side and nothing else is inferred (no dwell/scroll completion anywhere).
- Given a stored pre-2.3 course, when opened, then it serves unchanged in the player shell.
- Given a newer ready version, when studying the old one, then it stays until an explicit switch, with per-version tracker state.
- Given a generated study, when viewed in the library or plan panel, then the copy no longer claims the course is not generated.
- Given root deletion, when purge runs, then tracker rows are purged with the course lineage.

## Implementation Notes

## Plan Change Log

## Review Triage Log

### Quick lens pass (2026-10-27, 8 findings, verified by the orchestrator)

- **medium** — `globals.css .lesson-nav button` (0,1,1) overrides `:focus-visible` (0,1,0): no visible focus ring on the player's primary navigation, violating the frozen a11y boundary. → patch (restore the ring for lesson-nav buttons at both breakpoints).
- **medium** — "switch shows what changed" (frozen matrix row; D1) is not implemented — the switch affordance names only the newer version number. → patch (diff the required work — lesson titles/items — between the pinned and offered versions and show it before switching).
- **high** — the player never pins the studied course version: every read uses the default view, so a regeneration settling elsewhere silently swaps the studied version and tracker view on the next action (markDone re-fetch), and the explicit-switch UI is dead code — the frozen "stays until explicit switch" boundary is unreachable in-shell. → patch (player pins its course id, reads via `?course=`, moves only on the explicit switch action; superseded state becomes reachable with the changed-work summary).
- **low** — `listStudies` inlines an EXISTS over course-generation's table instead of composing an exported read function (the plan's design note; `getStudy` composes correctly). → patch (export a batch `hasReadyCourses` and use it).
- **medium** — stale sidebar copy "No generated courses." sits beside the working player (false since S1; this change's honesty criterion covers the screen). → patch (update copy; update dependent assertions).
- **low** — the tracker status live region is `display:none` while empty (`.content output:empty`), making the polite announcement unreliable. → patch (exempt the tracker status output from the empty-hiding rule so the region always exists).
- **false** — "required items are the lessons themselves plus their readings" vs one reading item per lesson: the Boundary bullet and Execution bullet are in tension, but no bad outcome occurs — each lesson carries exactly its explicit required item (the reading), which is what the spine's tracker pattern and D1 require; nothing demands a second per-lesson item. Recorded as plan-wording ambiguity only.
- **medium** — the fixture's lesson/outcome counting regexes scan source excerpt bodies, so synthetic notes containing lines like "lesson 1: …" inflate the count and fail generation with a false `invalid-output`. → patch (bound the parse to the structured header before the excerpt block; add a covering unit test).

Verdict counts: high 1, medium 4, low 2, false 1, maybe-false 0. All real findings route to patch (no intent_gap / bad_plan).

## Design Notes

- Content v2 keeps the v1 object as its single-lesson degenerate case where possible (a `lessons` array; v1 rows parse by wrapping the stored single lesson) — one serving path, no forked UI.
- The generated signal for the library is content-free (boolean per study) computed from `generated_course` existence — no course data crosses into materials-setup beyond the existence query done in the app route or via a course-generation read function (respect module boundaries; prefer course-generation exporting a small `hasReadyCourse(client, rootId)` the route/list composes).
- Tracker identity: stable per (course version, lesson, item kind) string ids (e.g. `lesson:2:reading`) — no new uuid surface in URLs.

## Verification

**Commands:**
- `nvm use && NPM_CONFIG_USERCONFIG=/dev/null NEXT_TELEMETRY_DISABLED=1 npm run migrate` — 017 additive.
- `npm run boundaries && npm run typecheck && npm run typecheck:worker && npm run lint` — green.
- `npm run test && npm run test:integration` — green, zero skips.
- `npm run build && npm run test:e2e` — player journey green (typegen dance; restore dev state).
- Wave-boundary full `npm run checks` after 2.4.

**Manual checks (if no CLI):**
- Keyboard-run the player at 360px and desktop; mark an item done; verify optional never blocks; verify the library line flips after generation.


### Patch round (2026-10-27)

All seven real findings patched by the same implementation subagent and re-verified by the orchestrator: lesson-nav focus ring restored at both breakpoints; the player pins its studied course id (reads via `?course=`, moves only on the explicit switch — the silent-version-swap hole is closed); the switch shows a required-work diff (lesson titles/items added/removed) fetched from the offered version with honest loading/failed fallbacks; `listStudies` composes the exported batch `hasReadyCourses` instead of inlining the course table; the stale "No generated courses." sidebar copy replaced; the tracker status live region stays in the accessibility tree while empty (`:not(.tracker-status)` exemption); the synthetic fixture's lesson/outcome counting is bounded to the structured header so excerpt lines like "lesson 1:" can no longer false-fail generation. One flaky 2.2-era unit assertion (deep-equality over the per-fetch `retrievedAt` timestamp) was fixed by the orchestrator to compare everything except the timestamp. Post-patch: boundaries, both typechecks, lint, unit 195/195, integration 145/145, covering browser specs 3/3 green.
