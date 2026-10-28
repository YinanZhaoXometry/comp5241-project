---
title: 'Manual-course approval-enrollment tracer (5.1)'
type: 'feature'
ticket: '1'
created: '2026-10-29'
status: built
baseline_revision: '766a12485a99f760840982264b66730f00c6f036'
route: 'full'
route_source: 'auto'
risk: 'high'
review: 'quick'
review_source: 'pinned'
lenses_ran: ['quick (in-session, coordinator-directed fallback: this lane has no subagent tool, so the Quick lens ran as an inspection pass by the session agent over the staged diff at /tmp/epic5-5.1-diff.patch — not a context-free subagent; recorded as the deviation it is)']
review_loop_iteration: 0
followup_review_recommended: false
context:
  - /Users/zhaoyinan/document/Polyu/COMP5241 软工/project-new-epic5/_bmad-output/initiative-ai-learning-platform/ux-ai-learning-platform/EXPERIENCE.md
  - /Users/zhaoyinan/document/Polyu/COMP5241 软工/project-new-epic5/_bmad-output/initiative-ai-learning-platform/product-policies.md
  - /Users/zhaoyinan/document/Polyu/COMP5241 软工/project-new-epic5/AGENTS.md
warnings: []
deferred: []
---

<intent-contract>

## Intent

**Problem:** Epic 5 has no instructor surface at all: an instructor cannot create a course, author a manual mini-course version, approve that exact version, or enroll a learner — and the `/instructor/courses` + `/instructor/approvals` routes are static prototypes with no data behind them.

**Approach:** Build the thinnest full-path tracer on the operator-provisioned synthetic instructor principal: new `instructor-courses` module + migration `030` (course, immutable version, exact-version approval, enrollment, command receipts), live instructor-shell ports of the two static references, a learner-shell study route that serves only the approved version, and a registered lifecycle-inventory port. No AI, no tests/answers, no CSV, no reports.

## Boundaries & Constraints

**Always:**
- Every command runs in one `transaction()` with `authorize()` first; instructor endpoints require `role='instructor'` AND course ownership; learner study requires an existing enrollment row for `(course, learner)`. Every denial — non-enrolled learner, second instructor, ordinary admin, missing course — is the identical `FORBIDDEN_OR_NOT_FOUND` ("This item is unavailable"); unauthenticated is 401.
- Approved versions are immutable (DB trigger, the `plan_revision` precedent); approval records approver/time/version digest; a replayed command (same commandKey+hash) returns the committed receipt, and approve/enroll effects are single rows arbitrated by PK/UNIQUE constraints (AD-2/AD-5/AD-6).
- Enrollment association is server-side only: the confirmed email must match an operator-provisioned account (row in `app.identity_principal`; better-auth `signUpEmail` leaves `emailVerified=false`, so in this local no-email system the principal row IS the verified-account marker — recorded as the entry-4 revisit point). Name/email are instructor-entered single-row data, previewed before any commit; the roster never appears in any learner view.
- The live pages reuse the Fieldnotes spine (`instructor.module.css`, `kit.module.css`, existing shells); honesty label "Sample prototype · No live AI" stays visible; CSP and the `*.module.css` loader exclusion untouched; `docs/project-structure.md` updated in the same change.
- Migrations: `migrations/030-instructor-courses-tracer.sql`, additive, idempotent (`IF NOT EXISTS`/`DROP TRIGGER IF EXISTS`), self-contained (no dependency on 021–029), applied only by `scripts/migrate.ts`.

**Never:**
- No AI dispatch, no generation, no scored tests/answers, no CSV import, no participation reports, no reminders, no enrollment removal/revocation (entries 2–5, 7–9 own those).
- No writes to `src/modules/assessment-progress`; no edits to applied migrations; no new dependencies; no worker queue jobs (all commands are synchronous SQL; the worker layer is exercised by real web/worker restart survival, not by a job).
- No public course directory, no self-enrollment, no roster exposure to learners, no existence leaks (no distinct error for "exists but not yours").
- The static `/instructor/students` and `/instructor/participation` pages stay static; `/library` and the other static product pages are untouched.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Create course | Instructor POST instructor/courses {title} | 201-style receipt {courseId}; course listed | Non-instructor role / bad title → same 404 / 400 |
| Save draft v1 | Instructor POST …/{id}/draft {lesson title, 1–4 section texts} | Version v1 row (immutable content, sha256 digest); pending item in approvals | Second concurrent draft → 409; replay → same receipt |
| Approve exact version | Instructor POST …/{id}/approve {courseId, versionId} after checking inspector gate | One approval row (approver/time/version/digest); version immutable thereafter | Unknown/foreign versionId → 404; already-approved version → idempotent existing-record receipt (still one row); replay → same receipt |
| Duplicate approve | Same commandKey replayed | Exactly the committed receipt; still one approval row | Hash mismatch → 409 |
| Enrollment preview | Instructor POST …/{id}/enrollment-preview {name,email} | Matched/unmatched preview incl. already-enrolled flag; zero writes | Malformed email → 400 |
| Enrollment confirm | Instructor POST …/{id}/enrollment {same row + command} | One enrollment row + receipt (server-side email→principal match) | No verified account → 400 before commit; duplicate commandKey → same receipt; new commandKey, same learner → honest already-enrolled receipt, still one row |
| Learner studies | Enrolled learner GET enrollments/{courseId} | Approved version only: lesson, required content item, version + approvedAt; NO draft or other version bytes | Unapproved-only course → "Pending instructor approval" state; non-enrolled/second instructor/admin/missing → identical 404 |
| Lifecycle inventory | personalRemoval preview (instructor / enrolled learner) | Categories list instructor-courses/-approvals (owner) and instructor-enrollments (learner) counts | Root-scope preview unaffected (no categories) |
| Restart | Real web+worker restart | Course/version/approval/enrollment unchanged; learner read identical; immutability holds | — |

</intent-contract>

## Code Map

- `src/app/api/v1/[...path]/route.ts` — single HTTP entry; add `instructor/courses…` and `enrollments…` paths after `authenticated()`; keep `privateHeaders` on every response.
- `src/modules/identity-access/access.ts` — `authorize(client, identity)` returns `{role, epoch}`; the role fence lives in the new module (never edit identity-access).
- `src/modules/course-generation/service.ts` — the reference command/read pattern: `transaction` + `authorize` + replay/receipt + zod parse via `src/platform/commands.ts`; `requestHash` doubles as the content digest helper.
- `src/modules/lifecycle-platform/derivatives.ts` — lifecycle-port registry; add one `instructor-courses` port (`tableReady`-guarded, preview counts, personal purge of the person's enrollment rows only — instructor course/approval records are course-controller records and survive personal removal per D5).
- `src/modules/lifecycle-platform/repository.ts` — `replay`/`receipt` are root-anchored (`command_receipt.root_id` FK) and NOT reusable here; the module owns an `instructor_command_receipt` table instead.
- `migrations/015-course-generation.sql`, `migrations/001-tracer.sql` — schema/trigger/UNIQUE patterns to mirror (immutable-revision trigger; guarded constraint adds).
- `src/app/shell/instructor-shell.tsx` + `src/app/screens/instructor-courses.tsx` / `instructor-approvals.tsx` + `instructor.module.css` — visual reference to port; the two screen components become live clients (DialogFrame keyboard contract stays); students/participation screens untouched.
- `src/app/shell/product-shell.tsx`, `src/app/client.ts` (`api`/`command`/`json`), `src/app/study-app.tsx` — learner-shell frame, fetch helpers and the sign-in form pattern ("My study library" heading) reused by the new live pages.
- `tests/integration/assessment.test.ts` — integration harness pattern (`provisionSynthetic`, `actor()` identity, direct service calls, real PG); `tests/browser/course.spec.ts` — browser harness pattern (provisioned sign-in, origin checks); `scripts/restart-smoke.ts` — real-restart evidence script (append one epic-5 beat); `tests/browser/pages.spec.ts` — static-page assertions that must drop the two ported routes.
- `scripts/provision-synthetic.ts` — already provisions instructor + admin + 2 learners; tests provision their own second instructor via `provisionSynthetic(label,'instructor')`.

## Tasks & Acceptance

**Execution:**
- [ ] `migrations/030-instructor-courses-tracer.sql` — create `app.instructor_course`, `app.instructor_course_version` (UNIQUE(course_id,version), immutability trigger), `app.instructor_approval` (version_id PK, approver/time/digest), `app.instructor_enrollment` (UNIQUE(course_id,learner_id)), `app.instructor_command_receipt` (PK(owner_id,command_key)) — all idempotent.
- [ ] `src/contracts/instructor-courses.ts` — zod command/content/view schemas (create, saveDraft one lesson 1–4 sections, approve, enrollment preview/confirm, learner views); derived required content item `lesson:1:reading` (the `readingItemFor` precedent).
- [ ] `src/modules/instructor-courses/repository.ts` + `service.ts` — transactional commands/reads with role fences, replay/receipt over `instructor_command_receipt`, digest pinning, server-side verified-account matching, approval idempotency, learner approved-only views.
- [ ] `src/modules/lifecycle-platform/derivatives.ts` — register the `instructor-courses` lifecycle-inventory port.
- [ ] `src/app/api/v1/[...path]/route.ts` — wire the nine endpoints.
- [ ] `src/app/screens/instructor-courses.tsx` → live client + `src/app/instructor/courses/page.tsx`; `src/app/screens/instructor-approvals.tsx` → live client (inspection checkbox gates Approve) + `src/app/instructor/approvals/page.tsx`; `src/app/shell/instructor-shell.tsx` live-mode honesty label; new `src/app/enrolled/page.tsx`, `src/app/enrolled/[courseId]/page.tsx` + screen clients under the product shell.
- [ ] `tests/unit/instructor-courses.test.ts`, `tests/integration/instructor-courses.test.ts`, `tests/browser/instructor.spec.ts`, `tests/browser/pages.spec.ts` (drop the two ported routes), `scripts/restart-smoke.ts` (epic-5 beat), `docs/project-structure.md` map update.
- [ ] Run the full local gate serialized with the other lane; record exact counts.

**Acceptance Criteria:**
- Given the instructor principal, when they create a course, draft one lesson, approve that exact version and enroll one verified learner, then after a real web/worker restart the course reopens with the identical approved version (immutable at the DB level) and approver/time/version recorded.
- Given the enrolled learner, when they open the learner-shell study route, then they see exactly the approved lesson and version — a later draft's text appears nowhere in any served payload; and when a non-enrolled learner, a second instructor or an ordinary admin requests the same route, then each receives the identical no-existence-leak denial.
- Given a duplicate approve or enroll command (same commandKey), when it is replayed, then the committed receipt returns and exactly one approval/enrollment row exists; a fresh enroll command for an already-enrolled learner creates no second enrollment.
- Given a personal-removal preview, when the instructor or the enrolled learner runs it, then the tracer's course/approval/enrollment records appear as lifecycle-inventory categories.
- Given the live instructor pages, when rendered at 360px and desktop, then the Fieldnotes spine, honesty label, skip-link/focus contract and security headers hold with no external requests or console errors.

## Implementation Notes

Planner note (route: full): sized full because the tracer crosses DB + module + HTTP + two live UI ports + three test layers + restart evidence. The start authorization (hitl) is the owner's 2026-10-29 go; provisioning the synthetic instructor principal is the standing `npm run provision` (operator-delegate action, done during verification).

2026-10-29 (blocked exit, no code changes): the bmad-build-auto run resolved ticket 5.1, completed the full document/code investigation and wrote this plan to ready-for-development quality, then halted at step-03's mandatory full-route implementing-subagent launch: this dispatch environment (a subagent lane) exposes no subagent-spawning tool, and the workflow's Subagents rule requires HALT with `no subagents` rather than improvising an in-session implementation. Work already standing on this branch: `npm ci --ignore-scripts` completed (254 packages, 0 vulnerabilities); no database was started, no ports touched, no source files changed. Environment note for the next runner: the shell snapshot's `node`/`npm` functions call an undefined `_nvm_lazy_load` — prepend `source ~/.nvm/nvm.sh && nvm use >/dev/null; unfunction node npm 2>/dev/null` to every terminal call. Resume by clearing the blocked mark and either re-running from a subagent-capable session or explicitly authorizing the oneshot (in-session) route.

2026-10-29: owner direction "finish 5.1" explicitly authorizes the in-session implementation unlock recorded above; status returned to in-progress and the plan is implemented in-session by the same agent that wrote it (route stays `full`; the subagent-launch step is satisfied by owner-authorized self-implementation, recorded here as an authorized process deviation).

2026-10-29 (environment, coordinator direction): the shared port 55432 is held permanently by the parallel epic-3 lane's own cluster, so this lane's PostgreSQL runs on 127.0.0.1:55433 — provisioned manually in this worktree mirroring scripts/local-db.ts exactly (initdb, tracer_owner/tracer_runtime roles, tracer_synthetic database, mode-0600 .local/{migration,runtime}-config.json with 55433 URLs; no product script modified; secrets never printed). `npm run db:start` sees the cluster running and the configs present and reports ready unchanged. Two epic-1 suites (tests/integration/migration.test.ts and restore.test.ts) hardcode socket port 55432 for their scratch-database admin client; since editing shared tests for a lane-environment reason would be worse, the gitignored `.local/pg-socket/` carries a socket alias symlink `.s.PGSQL.55432 -> .s.PGSQL.55433` so those clients reach this lane's cluster unchanged (verified standalone: 7/7 green). No shared file was modified for the port. The only remaining shared resource is web port 3000 (e2e + restart stages).

2026-10-29 (implementation): migration 030's instructor_approval originally shipped with version_id as PK and no row id; the repository's insert/reads expected an id column. Corrected IN PLACE before any merge — the migration had only ever been applied to this lane's throwable local cluster (dropped and re-created; no shared database ever saw the first shape). One integration expectation corrected with it: the instructor LIST endpoints are owner-scoped, so a second instructor legitimately receives their own empty list — the identical no-leak denial applies to every course-scoped call and to non-instructor roles (test updated to assert exactly that).

2026-10-29 (project note, shared-infrastructure collision): a parallel lane's `extractor:build` on the SHARED Colima daemon retags the single image tag `comp5241-bounded-parser:local`, which garbage-collects every other lane's admitted pinned image (`sha256:…` ID) mid-run — this lane's e2e stage failed wholesale that way on 2026-10-29 (coordinator verified: 481 extractions succeeded pre-collision, then every extract job failed "service" fail-closed, exactly as designed). Not a 5.1 defect; recorded so the team serializes full gates or namespaces the parser tag per lane. No product script was changed for this.

## Verification

**Commands:**
- `npm run checks` — expected: all gates green (audit 0, lint+coverage, boundaries, both typechecks, unit, extractor build, db+migrate, PG integration incl. the new suite, production build via the documented typegen dance with `next-env.d.ts` restored after, Chromium e2e incl. the new spec, real restart smoke incl. the epic-5 beat); record exact case counts.
- `npm run provision` (operator-delegate) — expected: four synthetic actors written to the ignored credential file (safe refusal if it already exists).

**Recorded run (2026-10-29, this tree, one `npm run checks` run):** audit 0 vulnerabilities; lint 113 inventoried rules + 8 negative probes + JSX positive probe; module boundaries passed; both typechecks passed; unit **246 passed** (15 files, incl. 5.1's 4); extractor:build "Four-format sandbox admitted after full image audit, real boundary fixtures, denial/resource probes and empty container inventory"; db ready (55433 cluster); migrations ordered-complete; PG integration **191 passed** (19 files, incl. 5.1's 6); production build compiled successfully (typegen dance applied; dev `next-env.d.ts` restored and both typechecks re-verified after). The `test:e2e` and `test:restart` stages were re-run after a fresh `extractor:build` because a parallel lane's rebuild of the shared parser image on the shared Docker daemon garbage-collected this lane's admitted image mid-run (cross-lane collision, not a 5.1 defect) — final re-run counts recorded below when complete. `npm run provision` ran once: "Four synthetic actors provisioned through Better Auth. Credentials saved privately…".

**e2e/restart record (2026-10-29, ownership-verified against the port-3000 server's cwd every 60s — see the coordinator's contamination protocol):**
- Original in-gate run: doomed by the parser-image GC above (no result).
- Attempt 2: discarded — port-3000 server ownership changed mid-run to the parallel lane (contamination); no result recorded.
- Attempts 3–4: lost the port spawn race / ownership to the other lane's focused runs (discarded).
- Attempt 5 (full suite, ownership held): 59 passed / 1 failed — the failure was a REAL 5.1 defect: the live sign-in gate never became ready for signed-out visitors (`setReady` was generation-gated after `clear()` bumped it). Fixed; two further real test defects were found and fixed on the way (honesty-label assertion matching the 360px-hidden sidebar copy; a render loop from the unstable session-gate object in dependency arrays that flooded GETs and starved navigation; the browser journey's auth-limiter fixture resets per the course.spec precedent; course-scoped assertions bound to this run's instructor).
- Attempt 6/focused re-runs (final tree): full-suite run **59 passed / 1 failed**, the single failure being the epic-2 `course.spec` practice-set keyboard case on code this story never touches; standalone re-run of that file: **6/6 passed** (the documented known-load-flake protocol). `tests/browser/instructor.spec.ts` passed in the full-suite run.
- Focused verification on the final tree (ownership held throughout): `instructor.spec` + `journey.spec` **3/3 passed**.
- `npm run test:restart` (ownership-verified, final tree): **PASS** — including the epic-5 beat: approved version + enrollment survive a real web/worker restart byte-identical, the approved version is immutable (UPDATE rejected "Immutable revision"), a replayed approve command returns one receipt with exactly one approval row, the second instructor receives the 404 no-leak denial, and the learner's lifecycle-inventory preview counts `instructor-enrollments: 1`.
- Strengthened 5.1 integration suite (matrix-audit additions: draft replay/hash-conflict, unknown-versionId denial) re-run after the additions: **6/6 passed**.
- Matrix test audit (step-03): every I/O & Edge-Case Matrix row is covered by at least one test that ran and passed in the records above; no expectation was edited to match code — every failure above was fixed in code or, for the epic-2 keyboard case, resolved by the project's documented standalone re-run protocol.

**Manual checks (if no CLI):**
- Instructor/approvals live pages visually keep the ported Fieldnotes layout and the visible honesty label at 360px and desktop (spot-check during e2e run).

## Auto Run Result (halted first pass — kept for the record; superseded by the final section below)

Status: blocked
Blocking condition: no subagents

- Step-01: ticket `5.1` resolved (`tickets.py find initiative-ai-learning-platform 5.1`); epic file, entry, initiative 2026-10-29 decision and companions read in full; no research folders or sibling plans; git tree clean on `feat/epic5-instructor-courses` (branch fits the epic).
- Step-02: full codebase investigation done in-session (identity-access, lifecycle-platform inventory/ports, course-generation service/contracts patterns, HTTP entry, shells/screens, test harnesses, restart smoke, migrations 001/009/015); route decided `full` (crosses DB+module+HTTP+UI+3 test layers, far over the 100-line oneshot bar); plan written with Code Map, I/O matrix and ACs; risk stays `high`.
- Step-03: HALT — the workflow mandates launching a fresh-context implementing subagent on the full route ("Using subagents when instructed is mandatory. If you cannot, HALT … `no subagents`"), and this dispatch lane has no subagent-spawning tool (the only orchestration tool available is explicitly restricted to user-requested dynamic workflows, which this dispatch is not). Per the dispatching PO's instruction ("do its steps, don't improvise around them. If it prints HALT, stop and report the reason"), the run stops here instead of improvising an in-session implementation on the full route.
- Standing ready for the next runner: plan at ready-for-development content quality (status now `blocked` with `blocked_at`/`blocked_reason` written by `tickets.py mark`); `npm ci --ignore-scripts --no-fund` completed on this branch (254 packages added, 0 vulnerabilities); baseline `766a12485a99f760840982264b66730f00c6f036`; no DB started, no ports touched, no source changes; shared machine left exactly as found.

## Review Triage Log

### 2026-10-29 — Review pass (quick, in-session per coordinator fallback)
- verdicts: 6 findings — high 0, medium 0, low 3, false 3, maybe-false 0
- findings:
  - `[low]` `[reject]` enrolled-course screen labels any load error "This item is unavailable" — a transient RETRYABLE_FAILURE would show the denial block — but the adjacent notice renders the honest platform message ("The operation could not finish…"), users rarely hit transient failures on this local loopback tracer, and distinguishing codes would add branching for no demonstrated harm.
  - `[low]` `[reject]` enrolled-list shows `approvedAt` date-only (`slice(0,10)`) — cosmetic; no user or developer harm beyond formatting taste.
  - `[low]` `[patch]` README not updated with this story's verification record and live-route table rows (the CONTRIBUTING story convention) — patched during the pass: the Static-product-pages section now marks `/instructor/{courses,approvals}` and `/enrolled*` as LIVE, and the Verification section records the epic-5 entry-1 gate numbers and the re-run circumstances honestly.
  - `[false]` `[reject]` "static page coverage was reduced by dropping two routes from pages.spec" — those routes are no longer static; their render/width/honesty-label/denial behavior moved to `instructor.spec.ts`, which asserts them against the live pages (the pages.spec header comment records the 2026-10-29 re-categorization).
  - `[false]` `[reject]` "a concurrent duplicate saveDraft delivery returns CONFLICT instead of the receipt" — a post-commit redelivery replays the committed receipt (integration-tested); the truly-concurrent window replays-then-state-checks exactly like the standing `lifecycle.replay` pattern, and the receipt PK arbitrates effects regardless.
  - `[false]` `[reject]` "enrollment preview leaks account existence" — the preview is owner-scoped by D5's own contract (the instructor's CSV/roster preview explicitly shows known vs unknown emails); nothing account-related is exposed to learners or other roles, and the matched flag is never client-supplied authority (confirm re-resolves server-side).

## Auto Run Result (final, 2026-10-29)

Status: built (owner-authorized in-session implementation; see Implementation Notes for the authorized process deviations: no-subagent unlock, 55433 cluster, e2e/restart re-runs after the cross-lane parser-image GC).

**Summary of implemented change:** the epic-5 entry-1 manual-course approval-enrollment tracer, end to end — an instructor creates a course, drafts one manual lesson version, approves that exact version (approver/time/digest recorded, version immutable), enrolls one verified learner through a single-row preview/confirm, and the learner studies only the approved version through the learner shell; every other synthetic role receives the identical no-existence-leak denial; the records register in the epic-1 lifecycle inventory.

**Files changed:**
- `migrations/030-instructor-courses-tracer.sql` — five idempotent, self-contained tables + the immutable-version trigger.
- `src/contracts/instructor-courses.ts` — command/content/view contracts, derived required item, digest determinism.
- `src/modules/instructor-courses/{service,repository}.ts` — transactional commands/reads with role/ownership/enrollment fences, course-anchored replay/receipts, server-side verified-account matching, approved-only learner reads.
- `src/modules/lifecycle-platform/derivatives.ts` — the registered instructor-courses lifecycle-inventory port.
- `src/app/api/v1/[...path]/route.ts` — nine endpoints (instructor courses/approvals + learner enrollments).
- `src/app/live-session.tsx`, `src/app/screens/{instructor-courses,instructor-approvals,dialog-frame,enrolled-list,enrolled-course}.tsx`, `src/app/screens/enrolled.module.css`, `src/app/shell/instructor-shell.tsx` — live UI ports with the honesty label and keyboard contract.
- `src/app/instructor/{courses,approvals}/page.tsx`, `src/app/enrolled{/,[courseId]}/page.tsx` — live routes.
- `tests/unit/instructor-courses.test.ts` (4), `tests/integration/instructor-courses.test.ts` (6), `tests/browser/instructor.spec.ts` (1 journey), `tests/browser/pages.spec.ts` (re-categorized), `scripts/restart-smoke.ts` (epic-5 beat), `docs/project-structure.md`, `README.md`.

**Review findings breakdown:** 6 findings — 1 patched (README record, low), 2 low rejected (cosmetic/rare with honest adjacent messaging), 3 false rejected with refutations (see Review Triage Log). Nothing deferred; `deferred` stays `[]`.

**Follow-up review recommendation:** false — this pass patched exactly one `low` entry (the threshold is a patched `high` or two patched `medium`s). Residual unverified risk named honestly: the review ran in-session (no context-free reviewer), so an independent fresh-context review — the project's standing practice — remains the stronger check and is recommended before the story is called `done` by the owner.

**Verification performed:** one `npm run checks` run green through the production build (audit 0; lint 113 rules + probes; boundaries; both typechecks; unit 246; extractor admitted; db/migrate; integration 191; build compiled; typegen dance applied and dev `next-env.d.ts` restored + re-typechecked). e2e/restart re-run under port-3000 ownership verification after the cross-lane parser-image GC: final full e2e 59/60 with the single failure being the known epic-2 keyboard flake (standalone re-run 6/6 per the documented protocol), `instructor.spec` green in the full run; focused final-tree run 3/3; `npm run test:restart` PASS including the epic-5 beat. Strengthened integration suite re-run 6/6. `npm run provision` ran once (four synthetic actors; credentials stay in the ignored local file).

**Residual risks:** shared-infrastructure collisions with the parallel epic-3 lane are environmental, not code (parser-image tag GC; port 3000 contention) — recorded above for the team. The entry-4 revisit point (verified-account = operator-provisioned principal row, since better-auth leaves emailVerified false) stands. No deployment, release-readiness, F-gate or live-eligibility claim is made.

2026-10-29 (disclosure, next-env.d.ts): the file is TRACKED at this branch's baseline with the development imports already committed. During the typegen dance the `git add -A` of the sign-in-fix commit (a795b4c) captured its generated production-imports state mid-build, and the final bookkeeping commit (13a13e8) committed the restored development imports — HEAD's copy is byte-identical to baseline's (verified with `git show` on both; `git diff HEAD -- next-env.d.ts` empty). No net change was committed; the intermediate flip is disclosed here rather than history-rewritten (rebase is forbidden on this lane).
