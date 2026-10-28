---
title: 'Manual-course approval-enrollment tracer (5.1)'
type: 'feature'
ticket: '1'
created: '2026-10-29'
status: in-progress
baseline_revision: '766a12485a99f760840982264b66730f00c6f036'
route: 'full'
route_source: 'auto'
risk: 'high'
review: ''
review_source: ''
lenses_ran: []
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

## Verification

**Commands:**
- `npm run checks` — expected: all gates green (audit 0, lint+coverage, boundaries, both typechecks, unit, extractor build, db+migrate, PG integration incl. the new suite, production build via the documented typegen dance with `next-env.d.ts` restored after, Chromium e2e incl. the new spec, real restart smoke incl. the epic-5 beat); record exact case counts.
- `npm run provision` (operator-delegate) — expected: four synthetic actors written to the ignored credential file (safe refusal if it already exists).

**Manual checks (if no CLI):**
- Instructor/approvals live pages visually keep the ported Fieldnotes layout and the visible honesty label at 360px and desktop (spot-check during e2e run).

## Auto Run Result

Status: blocked
Blocking condition: no subagents

- Step-01: ticket `5.1` resolved (`tickets.py find initiative-ai-learning-platform 5.1`); epic file, entry, initiative 2026-10-29 decision and companions read in full; no research folders or sibling plans; git tree clean on `feat/epic5-instructor-courses` (branch fits the epic).
- Step-02: full codebase investigation done in-session (identity-access, lifecycle-platform inventory/ports, course-generation service/contracts patterns, HTTP entry, shells/screens, test harnesses, restart smoke, migrations 001/009/015); route decided `full` (crosses DB+module+HTTP+UI+3 test layers, far over the 100-line oneshot bar); plan written with Code Map, I/O matrix and ACs; risk stays `high`.
- Step-03: HALT — the workflow mandates launching a fresh-context implementing subagent on the full route ("Using subagents when instructed is mandatory. If you cannot, HALT … `no subagents`"), and this dispatch lane has no subagent-spawning tool (the only orchestration tool available is explicitly restricted to user-requested dynamic workflows, which this dispatch is not). Per the dispatching PO's instruction ("do its steps, don't improvise around them. If it prints HALT, stop and report the reason"), the run stops here instead of improvising an in-session implementation on the full route.
- Standing ready for the next runner: plan at ready-for-development content quality (status now `blocked` with `blocked_at`/`blocked_reason` written by `tickets.py mark`); `npm ci --ignore-scripts --no-fund` completed on this branch (254 packages added, 0 vulnerabilities); baseline `766a12485a99f760840982264b66730f00c6f036`; no DB started, no ports touched, no source changes; shared machine left exactly as found.
