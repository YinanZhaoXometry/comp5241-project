---
title: 'Whole-mini-course roadmap surface (3.6)'
type: 'feature'
ticket: 6
created: '2026-10-29'
status: 'done'
baseline_revision: '6b0398f2898ab92c3517bf240faec4b0d21c2015'
route: 'full'
route_source: 'auto'
risk: 'medium'
review: ''
review_source: ''
lenses_ran: []
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/initiative-ai-learning-platform/product-policies.md'
  - '{project-root}/_bmad-output/initiative-ai-learning-platform/architecture-shared-technical/architecture-shared-technical.md'
  - '{project-root}/_bmad-output/initiative-ai-learning-platform/ux-ai-learning-platform/EXPERIENCE.md'
  - '{project-root}/_bmad-output/initiative-ai-learning-platform/tickets/epic-assessment-and-progress/tickets/story-evidence-linked-gap-guidance-with-unknown-separation-plan.md'
warnings: []
deferred: []
---

<intent-contract>

## Intent

**Problem:** The completion contract (3.4) exists but the roadmap is still ONE line inside the assessment panel ("Roadmap: In progress.") scoped to a single open study. There is no whole-mini-course roadmap surface: no owner-level view of the learner's confirmed studies as Not started / In progress / Completed nodes, no Needs practice pill at node level (3.5's guidance renders only inside the graded result view), no Review due pill anywhere (the review-state query port the epic contract names as this story's stubbed touch point does not exist), no recommended prerequisite order (parent manifests pin child order but nothing serves it), and no honest "Plan confirmed — course not generated" roadmap state (the library list renders that line, the roadmap does not exist to render it).

**Approach:** The roadmap is a READ-TIME owner-scoped view (the guidance.ts pattern, no new tables): a pure `deriveRoadmapView` over already-recorded facts — the owner's confirmed, non-deleted studies; each root's resolved studied release (explicit `app.studied_release` pointer, else getCourse's default resolution: the current confirmed revision's course row, else the latest ready one); R2 award rows; attempts/targets; ready-version supersession; and parent manifests as the recommended-order carriers. Node state rides the EXISTING 3.4 rule (`deriveRoadmapNode`: Completed only from an earned version-scoped award pinning the resolved release; In progress on any attempt or required-item done; else Not started). The Needs practice pill mirrors 3.5's guidance classification at node altitude (an open recovery-target group of the resolved release's newest failed chain, not suppressed by a newer passing attempt). The Review due pill renders from a VERSIONED review-state QUERY PORT — a typed contract plus an explicit stub/no-op binding that is unbound by default and returns no state; unbound renders no pill, never a wrong state, and the port is structurally never an input to node state, so a due review can never remove completion. Served by `getRoadmap` (owner-scoped fence, one gather transaction, port queries after it closes, then the pure derivation) at `GET /api/v1/roadmap`, and rendered by a tracer-area panel (`RoadmapPanel`, the assessment-stage pattern) visible whenever signed in: every node freely browsable (an Open action per node — no locks, no XP, nothing disabled), recommended order numbered per path, states in words (accessibility floor).

## Boundaries & Constraints

**Always:**
- Node state follows R2 awards EXACTLY through the existing `deriveRoadmapNode`: Completed only when an earned mini-course award pins the resolved studied release; a passed/fully-recovered attempt with no award yet keeps the node honestly In progress; an earned award keeps it Completed forever (monotonic — later failures, supersession, policy edits never un-complete).
- Node state is computed BEFORE and INDEPENDENT of the review port: the review input feeds only the pill boolean; the derivation's state path never reads it. A due review can never remove or change completion (D6 completion-versus-review separation, structurally).
- Review-due pill: unbound port (the default stub) → no pill on every node and an honest served note that review scheduling is not part of this build; a bound port returns a versioned per-release state (`{ schemaVersion, courseId, courseVersion, due }` pinned to the resolved release — versioned like every other read); `due !== true` never renders a pill. No scheduling, due-list, reminder or verdict behavior is built (epic-spaced-review owns it; this epic exposes only the AD-13 shared evaluator verdict).
- Needs practice pill derives ONLY from open recovery-target groups of the resolved release's own newest failed chain (D2: observed difficulty, cause unnamed), with the same newer-passing-attempt suppression guard as 3.5 guidance/completion so the node pill, the guidance panel and the recovery panel can never disagree; practice evidence never flips anything at node level.
- Recommended order comes from the plan machinery only: parent-manifest paths render their children in the manifest's pinned order (the 3.4 plan-pinned carrier); roots pinned by no manifest render as their own single-node path in plan-confirmation order. No invented cross-study prerequisites, no sorting by progress.
- Free browsing: every authorized node is openable regardless of state — no locks, no gating, no XP/points/streak surfaces; the recommended order is numbering, never enforcement (D1).
- Honesty states in words: a confirmed study with no course renders "Plan confirmed — course not generated" (the Empty-surface pattern), a pending generation renders the in-flight line, a failed one renders the honest failure; a resolved release older than the newest ready one renders the Version-superseded note (learner stays on the studied version until an explicit switch; the switch flow stays 3.4's, unchanged).
- Scope: owner-scoped reads only (authorize + owner_id filters everywhere; the deleted/revoked studies never render — the roadmap is authorized nodes only); cross-owner denial is structural (another owner's query returns only their own rows); loopback only, synthetic data only, zero egress, no AI dispatch.
- `npm run lint`/`typecheck`/`typecheck:worker`/`boundaries`/unit green; targeted integration and the new browser spec green; `docs/project-structure.md` updated in the same change; full-gate serialization left to the orchestrator (the lane rule).

**Never:**
- No migration in this story: the roadmap changes NO stored shape (the story-3.3 precedent — "no migration exists for 3.3" because the snapshot jsonb carried the additions; here nothing is stored at all). Migration number 025 stays unused by this story; no other numbered migration is created.
- No writes anywhere (pure read model; the review port is a query port, and its stub writes nothing); no edits to 021–024 tables; no lifecycle/export/retention registration changes (nothing new exists to register — entry 3.9 registers derivatives, and this story creates none).
- No locks, XP, streaks, time limits or prerequisite enforcement; no review scheduling/verdict surfaces; no instructor surfaces; no new dependencies; no reformatting of shared files (3.7 sibling lane — adds to `repository.ts`/`service.ts` only, no restructuring); the static `/roadmap` product page and `tests/browser/pages.spec.ts` untouched; no editing applied migrations.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Three-course path, mixed states | manifest pins three releases: A awarded, B failed-group open, C untouched | path renders 3 nodes in manifest order: A Completed, B In progress + Needs practice pill, C Not started; every node openable | none |
| Node follows awards exactly | required items done + passing attempt but award not yet landed (pre-award window) | node honestly In progress until the award row pins the release (3.4 rule) | none |
| Completed stays completed | later failed retake / supersession / policy edit after the award | node stays Completed (award-derived, monotonic) | none |
| Failed-group sibling | B's newest failed chain has open targets on the resolved release | Needs practice pill on B; a completed sibling A renders no pill | none |
| Recovered normally | newer passing attempt on the release after the failed chain | no Needs practice pill (the 3.5 suppression guard; ledger untouched) | none |
| Review port unbound (default) | stub binding returns no state | no Review due pill anywhere; served note states review scheduling is not in this build; node states byte-identical with/without the port | none |
| Review port bound, review due | binding returns `{ due: true }` for one release | Review due pill on that node ONLY; its state unchanged (completed node stays Completed) | none |
| Plan confirmed, course not generated | confirmed study, no ready/pending/failed course row | node renders the honest "Plan confirmed — course not generated" line; NO progress state claimed | none |
| Generation in flight / failed | resolved course row pending/failed | honest in-flight / failed line; no invented progress | none |
| Version superseded | studied pointer pins v1 while v2 is ready (explicit switch) or resolution supersedes | node renders the studied release's honest state + "newer version ready — switching is explicit" note | none |
| Recommended order | manifest children order vs confirmation order | manifest paths numbered in pinned order; standalone roots in confirmation order as single-node paths | none |
| Cross-owner | another owner's roadmap read | only their own studies render; A's nodes never visible to B | FORBIDDEN_OR_NOT_FOUND surface stays per-verb; owner-scope is structural |
| Deleted/revoked study | root deleted_at set | node does not render (unauthorized); awards stay recorded but unreached | none |
| Empty roadmap | owner with no confirmed studies | honest empty state with one primary action (start a study) — no invented progress | none |

</intent-contract>

## Code Map

- `src/contracts/assessment.ts` — EXTEND (Story-6 section): `roadmapCourseStates = ["ready","not-generated","pending","failed"]`; `RoadmapNodeView = { rootId, title, topic, courseId: string|null, version: number|null, courseState, state: RoadmapNode|null, needsPractice: boolean, reviewDue: boolean, superseded: boolean, latestVersion: number|null }` (state null exactly when courseState ≠ ready — no invented progress); `RoadmapPathView = { manifestId: string|null, nodes: RoadmapNodeView[] }` (manifestId null = the study's own single-node path); `RoadmapView = { paths, reviewPortBound: boolean, note: string }` with a fixed honesty note constant (free browsing, no locks/XP; completion only from earned awards; review pills only when scheduling exists); the versioned review-state port contract: `REVIEW_STATE_PORT_VERSION = 1`, `ReviewDueState = { schemaVersion: 1, courseId, courseVersion, due: boolean }`, `ReviewStateInput = { ownerId, courseId, courseVersion }`.
- `src/modules/assessment-progress/review-port.ts` (NEW) — the stubbed port binding: `type ReviewStateQuery = (input: ReviewStateInput) => Promise<ReviewDueState|null>`; an explicit `bindReviewStateQuery`/`activeReviewStateQuery` seam whose DEFAULT is the unbound no-op (always resolves no state), so epic-spaced-review can replace the binding without touching this module's callers. The stub performs no I/O; unbound is a first-class honest state, not an error.
- `src/modules/assessment-progress/roadmap.ts` (NEW, pure — the guidance.ts pattern) — `deriveRoadmapView({ roots, resolvedCourses, studiedPointers, awards, attempts, targets, manifests, reviewStates })`: per-root node assembly (resolution honesty, award-derived state via `deriveRoadmapNode`, the Needs-practice chain/suppression rule, supersession, review pill) and path assembly (manifest order + confirmation order). Unit-testable without DB.
- `src/modules/assessment-progress/repository.ts` — EXTEND (owner-scoped batch reads, the `practiceSummariesForCourse` read-only precedent; adds only): `confirmedRootsForOwner` (roots with confirmed plans + plan jsonb title/topic + confirmation time, non-deleted, bounded LIMIT 100 the listStudies precedent), `studiedReleasesForOwner`, `coursesForRoots` (per-root resolved row mirroring getCourse's default resolution: the current confirmed revision's latest row of any status, else the latest ready row — status included), `latestReadyVersionsForRoots`, `miniCourseAwardsForOwner`, `attemptsForOwner`, `targetsForOwner`.
- `src/modules/assessment-progress/service.ts` — EXTEND: `getRoadmap(identity)` — the owner fence (authorize), one gather transaction, review-port queries after it closes (a stub call never holds the transaction; epic 4's binding owns its own consistency), then the pure derivation. No write paths, no scopedRoot (owner-level query).
- `src/app/api/v1/[...path]/route.ts` — EXTEND: `GET /api/v1/roadmap` branch (the `preferences` owner-scoped GET precedent; privateHeaders).
- `src/app/roadmap-panel.tsx` (NEW — the assessment-stage tracer pattern, NOT the static screens area) — the roadmap panel mounted in `study-app.tsx` (visible whenever signed in): per path an ordered list; per node the number, title, state in words, Needs practice / Review due pills as labeled text, honest not-generated/in-flight/failed/superseded notes, and a quiet Open action per node (the existing `open(rootId)` handler — free browsing, nothing disabled, no locks/XP); light 3s eventual-consistency re-read (the AssessmentStage poll pattern, never steals focus).
- `src/app/study-app.tsx` — EXTEND: mount `<RoadmapPanel>` in the signed-in content area (before the Saved studies section) with the shared busy/failure props.
- Tests: `tests/unit/roadmap.test.ts` (NEW — pure derivation matrix from award/guidance-shaped fixtures: states, pills, order, honesty states, review-pill/never-removes-completion), `tests/integration/roadmap.test.ts` (NEW — the three-mini-course path journey over real studies: award-following states, failed-group pill with completed sibling, manifest recommended order, free browsing facts, cross-owner scope denial, version-superseded honesty through the real switch flow, unbound pill + unchanged completion), `tests/browser/roadmap.spec.ts` (NEW — node states, keyboard-only operability, 360px and desktop viewports, Open-per-node free browsing, no Review due pill); `docs/project-structure.md` same-change update.

## Tasks & Acceptance

**Execution:**
- [x] `src/contracts/assessment.ts` — story-6 roadmap + review-port contract types.
- [x] `src/modules/assessment-progress/review-port.ts` — versioned query port + unbound stub binding seam.
- [x] `src/modules/assessment-progress/roadmap.ts` — pure `deriveRoadmapView`.
- [x] `src/modules/assessment-progress/repository.ts` — owner-scoped batch reads.
- [x] `src/modules/assessment-progress/service.ts` — `getRoadmap`.
- [x] `src/app/api/v1/[...path]/route.ts` — `GET /api/v1/roadmap` branch.
- [x] `src/app/roadmap-panel.tsx` + `src/app/study-app.tsx` — the roadmap surface.
- [x] Tests: unit `roadmap.test.ts`, integration `roadmap.test.ts`, browser `roadmap.spec.ts`.
- [x] `docs/project-structure.md` — same-change update.

**Acceptance Criteria:**
- Given a three-mini-course path (one awarded, one failed-group open, one untouched), the roadmap renders node states that follow completion awards exactly — Completed only from the award, the failed-group course In progress with a Needs practice pill, the completed sibling Completed, the untouched one Not started — in the manifest's recommended order.
- Every authorized node is browsable freely: an Open action exists on every node regardless of state; no lock, gating, XP or prerequisite enforcement anywhere in the surface or the contract.
- A confirmed-but-ungenerated study renders "Plan confirmed — course not generated"; pending/failed generations render their honest lines; an explicitly-switched older release renders the Version-superseded note with its own honest state.
- With the review port unbound (the default), no Review due pill renders anywhere, the served note says review scheduling is not part of this build, and completion states are byte-identical with the port bound-or-not; a bound due review adds only the pill — a completed node stays Completed.
- The surface stays honest and operable across 360px/desktop keyboard-only runs (states in words, focusable Open actions, no overflow).
- Cross-owner reads render only the caller's own studies; deleted/revoked studies never render.
- Lint, both typechecks, boundaries, and the full unit suite stay green; the targeted integration pair and the new browser spec pass; no skips/overrides/suppressions anywhere.

## Design Notes

Latitude taken (recorded per the house rule): (1) **No migration** — the roadmap is a read-time view and the review port is an unbound stub; nothing is stored, so no 025 file exists (the documented 3.3 no-migration precedent; flagged to the orchestrator since the lane numbering reserves 025 for this story). (2) The roadmap is OWNER-scoped, not per-root: one node per entire mini-course across the learner's confirmed studies, which is the only honest multi-course shape in personal study (one course per root; 3.4's own design note — "multi-child cases are exercised through synthetic manifests"); the three-mini-course path is a parent manifest, pinned child order = recommended order. (3) Standalone studies render as their own single-node path in confirmation order — no invented cross-study prerequisites. (4) The Needs-practice pill reuses 3.5's chain-selection + newer-passing suppression semantics at node altitude rather than calling `deriveGuidance` (the pill needs a boolean, not citations — but the two rules are documented as mirrors so they cannot drift). (5) The review port's bind seam is a module-level default-unbound binding — the honest unbound state is served (`reviewPortBound: false`), the stub performs no I/O, and the derivation's state path never reads the port (structural D6). (6) `state: RoadmapNode|null` — null exactly when no course is resolvable, so "Plan confirmed — course not generated" renders INSTEAD of a progress state (no invented progress) while the contract still types the three D1 states once. (7) Port queries run after the gather transaction closes so any future epic-4 binding cannot hold the root-lock transaction open.

## Auto Run Result

**Status: BUILT (2026-10-29, lane-split worktree `project-new-e3s6`, commits 0b3a7ef plan → 93cc197 feat).** All targeted verification green in the lane's mandated scope; the serialized FULL gate (`npm run checks`) stays the orchestrator's, per the lane rule.

**Exact commands and results** (every shell under nvm Node v24.22.0, `NPM_CONFIG_USERCONFIG=/dev/null`, `NEXT_TELEMETRY_DISABLED=1`):
- `npm ci --no-audit --no-fund` — ok (254 packages; fresh worktree).
- `npm run lint` — PASS: eslint 0 warnings/0 errors, oxlint clean on 187 files/151 rules, lint coverage 113 inventoried rules + 8 negative probes + JSX reference probe.
- `npm run typecheck` — PASS (dev imports; production build exercised the generated production types).
- `npm run typecheck:worker` — PASS.
- `npm run boundaries` — PASS ("Module dependency-direction and transitive client/provider isolation checks passed").
- `npm run test` — PASS: 15 files, **294/294** unit tests (baseline 278 + the new roadmap file's 16: award-following states, pre-award window, needs-practice matrix incl. suppression/cleared/other-release scoping, review-pill matrix incl. mismatched-pin rejection and never-removes-completion, manifest order/overlap, not-generated/pending/failed/superseded, empty roadmap).
- `npm run db:start` — could NOT bind: port 55432 is already held by the SHARED cluster (the main worktree's postmaster, serving since 03:12). Disposition: the worktree's credential files authenticate against that running shared cluster (verified: migration URL auth OK, runtime URL auth OK; 24 migrations applied), which is exactly the lane's "shared local cluster … do not stop the DB afterwards" arrangement — nothing was stopped, nothing touched. `npm run migrate` — PASS ("Ordered auth → application → queue migrations complete"); 001–024 stand applied; 025 does not exist by this story's design (no stored-shape change — the documented 3.3 no-migration precedent).
- `npx vitest run tests/integration/roadmap.test.ts tests/integration/assessment.test.ts --no-file-parallelism` — PASS: **18/18** across both files (roadmap 5: the three-mini-course path journey with award-exact states + Needs-practice pill beside the Completed sibling + pinned manifest order + parent award on the last required child, the honest not-generated node + unbound port, version-superseded through the REAL switch flow, cross-owner structural denial, and the bound-port seam journey proving the pill renders pinned while completion stays Completed; assessment 13 unchanged and green).
- `npx playwright test tests/browser/roadmap.spec.ts` — PASS: **1/1** (2.1m) against the Playwright-spawned production server + worker (documented typegen dance run: `next typegen` → build with the dev cache removed → spec → dev state restored, prod cache removed, dev typecheck green again). The journey: 360px keyboard-only node states following the real verbs (not-generated → Not started → In progress + Needs practice at the honest 79.96% boundary → Completed), the planted recommended path in its pinned non-chronological order, free browsing via keyboard Enter and click on Open (nothing locked, including the ungenerated node), no Review due pill anywhere with the unbound-port note rendered, overflow-free at 360px and 1280px, and B's roadmap containing none of A's studies.
- `npm run build` — PASS (production build inside the typegen dance; the 2 pre-existing Turbopack route warnings are the source-fetch dynamic-import legs, unchanged by this story).

**Build summary.** The roadmap is a READ-TIME owner-scoped view — zero writes, zero tables, zero dispatch. `deriveRoadmapView` (pure, `roadmap.ts`) assembles per-study nodes (resolution honesty, the story-4 award rule through `deriveRoadmapNode`, the guidance-mirror needs-practice chain rule, supersession, the review pill) and the path layer (manifest pinned order + confirmation order for standalone studies). `getRoadmap` gathers facts in one owner-fenced transaction (8 new owner-scoped batch reads in the repository; the confirmation pointer reads `app.study_batch` — the batchRow precedent, NOT `app.material`, which carries no row for later studies) and calls the review-state port only AFTER the transaction closes. The versioned review-state port (`review-port.ts`) is an explicit bind seam whose default is the unbound no-op: `reviewPortBound: false` is served in words, no pill renders, and the derivation's state path structurally never reads the port. UI: `RoadmapPanel` in the tracer content area (the assessment-stage pattern — global classes only, no CSS changes, 3s eventual-consistency poll), one node per mini-course with states/pills in words and a quiet Open action on every node. The static `/roadmap` product page and `tests/browser/pages.spec.ts` are untouched.

**Environment notes for the orchestrator.** (1) The non-interactive shells on this machine mishandle the user's zsh nvm lazy-load wrappers — every command here ran with the wrappers unset and `~/.nvm/versions/node/v24.22.0/bin` first on PATH (node -v verified v24.22.0 each time). (2) The fresh worktree lacked the compiled TXT helper; it was built from `src/worker/txt-extract.c` with the build-extractor script's EXACT clang flags and probed (`--probe` ok) — the parser image/admission stack was NOT touched. (3) The Playwright webServer log showed one unrelated `export-build-failed` event from a STALE export request another lane's data left on the shared cluster queue — no effect on this journey (passed), recorded for honesty. (4) `runtime-config.json` was copied from the main worktree's `.local/` per the lane instruction (never committed). No load flakes were encountered in any run; no skip, override or suppression exists anywhere.

## Verification

**Commands:**
- `nvm use && NPM_CONFIG_USERCONFIG=/dev/null NEXT_TELEMETRY_DISABLED=1 npm run lint && npm run typecheck && npm run typecheck:worker && npm run boundaries && npm run test` -- expected: all green.
- `npm run db:start && npm run migrate` then `NPM_CONFIG_USERCONFIG=/dev/null npx vitest run tests/integration/roadmap.test.ts tests/integration/assessment.test.ts --no-file-parallelism` -- expected: pass, new roadmap journeys included, existing assessment suite untouched and green.
- With the dev server on 127.0.0.1:3000: `npx playwright test tests/browser/roadmap.spec.ts` -- expected: pass.

## Review Triage Log (2026-10-29, independent lens — PASS-WITH-NOTES)

All verify clauses, the D6 structural fence, read-only purity, cross-owner denial, the no-migration latitude and the flagged edge decisions (multi-manifest roots, pointer fallback, LIMIT 100) verified clean; no P0/P1/P2 findings. Three P3s dispositioned:

1. **Resolution fallback tier divergence (patched as documentation):** the SQL resolution has a third tier ("any row at all") that `getCourse` lacks, so in a narrow re-confirm window the roadmap can name "failed" where the course surface names "not generated" — honesty-preserving (no progress state is claimed either way) but the comment/plan claimed an exact mirror. Disposition: the `resolvedCoursesForRoots` comment now states the three-tier behavior and the divergence window verbatim; behavior unchanged (an alignment would change served reads post-review without browser re-proof; recorded instead).
2. **Review-port schemaVersion unchecked (patched in code):** the pill acceptance now requires `schemaVersion === REVIEW_STATE_PORT_VERSION`, with a unit test bypassing the pinned type to prove a future-version state renders no pill.
3. **Keyboard proof is focus+Enter, not a full Tab traversal (noted):** the browser journey proves keyboard activation of native buttons on both viewports; full Tab-order reachability leans on the tracer's app-wide keyboard coverage. Recorded as the proof's honest extent.
