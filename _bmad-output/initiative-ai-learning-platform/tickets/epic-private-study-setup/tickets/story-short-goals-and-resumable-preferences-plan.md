---
title: 'Short goals, corrected topic and resumable preferences'
type: 'feature'
ticket: 'S4'
created: '2026-10-22'
status: 'built'
baseline_revision: 'd851f8f77314ab8f7d8f38e84cac266f7f31916e'
route: 'full'
route_source: 'auto'
risk: 'medium'
review: 'quick'
review_source: 'pinned'
lenses_ran: []
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/initiative-ai-learning-platform/tickets/epic-private-study-setup/delivery-checks.md'
  - '{project-root}/_bmad-output/initiative-ai-learning-platform/tickets/epic-private-study-setup/setup-experience.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Goal/topic setup state is not saved server-side, so back/refresh loses direction and a stale tab can confirm a draft built from superseded intent.

**Approach:** Deliver S4 + U4 (and the U1 draft-resume fields this package owns): exactly the four goal routes with only Other's short clarification, Manual topic (no fake inference), optional background/time preferences, validated changeable IANA timezone, server-saved stage state with explicit save status, optimistic revision conflicts and session-expiry recovery.

## Boundaries & Constraints

**Always:** Local synthetic data; owner-scoped authorization; explicit save status; monotonic pinned `app.setup_preference.revision` for plan-relevant (goal/topic/clarification) changes; 360px/keyboard usable UI.

**Never:** Live AI or topic inference (S6 stays blocked); exam date, background essay or forced time preference; new npm dependency; deployment/real data; ticket advancement past `planned` until the full gate passes at integration; claims about S6, S7 closure, S12, F1 or release readiness.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Four goal routes | Each of Exam preparation / Understand a topic / Apply a skill / Other (+ short clarification for Other only) | Saved with explicit save status and revision | Other without clarification or non-Other with clarification → INVALID_INPUT |
| Invalid input | Unknown goal/stage/time preference, over-limit text, invented timezone, unexpected field | Nothing saved | INVALID_INPUT; row not created |
| Replay/races | Duplicate command, same key different bytes, stale second-tab expectedRevision | One committed result; replay returns stored result | CONFLICT for misuse and stale revision |
| Revision ownership | Goal/topic/clarification change vs optional preference/stage change | Revision bumps only on plan-relevant change so older draft confirmation can be invalidated without erasing history | Consumers (P3 confirm) read `app.setup_preference.revision` by the pinned name |
| Session boundary | Expired/revoked session; different owner | UNAUTHENTICATED / owner-scoped reads; re-authentication reloads only authorized saved work | Deny without private-content leak |

</frozen-after-approval>

## Code Map

- [migration](../../../../../migrations/004-setup-preferences.sql): `app.setup_preference` PK owner_id with the pinned columns; additive SQL only.
- [contract](../../../../../src/contracts/preferences.ts): strict PUT command schema, pinned GET shape, `Intl.supportedValuesOf('timeZone')` validation.
- [service](../../../../../src/modules/setup-preferences/service.ts): learner-scoped get/save, row-scoped idempotent replay, relevant-change revision bump.
- [repository](../../../../../src/modules/setup-preferences/repository.ts): row read for update, single-row upsert.
- [goal stage](../../../../../src/app/goal-stage.tsx): Manual topic, four routes, Other clarification, optional preferences, timezone detect/correct, explicit save status, conflict recovery.

## Tasks & Acceptance

**Execution:**
- [x] Migration `004-setup-preferences.sql` with `app.setup_preference` (pinned columns + defense-in-depth CHECKs mirroring the contract).
- [x] `src/contracts/preferences.ts` with the pinned `{stage, goal, topic, clarification, background, timePreference, timezone, revision}` shape.
- [x] `src/modules/setup-preferences/` service/repository with authorization, idempotency and monotonic revision.
- [x] `GET/PUT /api/v1/preferences` route branch + `study-app.tsx` mount delivered as exact snippets to the integrator (integrator-only files untouched by this package).
- [x] `src/app/goal-stage.tsx` (U4/U1 fields: Manual topic, four routes, Other-only clarification, optional background/time, validated changeable timezone, save status, conflict reload, resume).
- [x] `tests/unit/preferences.test.ts` (contract schema: four routes, Other-only clarification, timezone validation — executed on this branch), `tests/integration/preferences.test.ts` and `tests/browser/preferences.spec.ts` authored; PG-backed suites validated at integration.

**Acceptance Criteria:**
- Given the four goal routes, when saving each (with only Other needing a short clarification), then each round-trips through the pinned GET shape with an explicit revision.
- Given a stale second-tab save or a replayed/misused command key, when committed, then exactly one result exists and stale saves CONFLICT without overwriting.
- Given goal/topic/clarification changes versus optional preference or stage navigation changes, when saved, then only the former advance the pinned revision (older draft confirmations can be rejected without erasing history).
- Given an expired/revoked session or another owner, when reading or writing, then deny; re-authentication reloads only the owner's authorized saved work.

## Implementation Notes

- 2026-10-22 (package branch): implementation complete on `pkg/p2-preferences` off baseline d851f8f. Ran on the package branch: `npm run typecheck`, `npm run typecheck:worker`, `npm run lint`, `npm run boundaries`, `npm test` (unit) — see Verification for outcomes; PG-dependent suites (`test:integration`, browser, restart, build, migrate) were NOT run here per plan §1.8 (single-cluster serialization; this worktree has no `.local/`) and are validated at integration.
- Topic is Manual throughout: no topic inference exists in this release; the UI labels the field Manual and no candidates are offered (S6 remains blocked).
- The plan §3-P2 sentence "P5's confirm must consult app.setup_preference.revision" was resolved by the integrator: the draft-CONFIRM consultation belongs to P3 (materials-setup), which codes against this package's pinned `revision` column name. This package only owns the column and keeps it monotonic.

## Plan Change Log

- 2026-10-22 — Timezone validation source is `Intl.supportedValuesOf('timeZone')` per the plan pin, widened with the spec's special `"UTC"` value and the runtime's own `Intl.DateTimeFormat().resolvedOptions().timeZone`: Node/V8's supportedValuesOf omits `"UTC"` and every `Etc/*` identifier (418 region zones only), yet `resolvedOptions().timeZone` may legitimately return them — caught by a real failing unit assertion (`validTimeZone("UTC")` was false) before any save path shipped. A detected default must always be saveable; invented zones (e.g. `Mars/Olympus`, lowercase aliases) stay rejected.
- 2026-10-22 — Idempotency is stored on the `app.setup_preference` row itself (`command_key`, `request_hash`, `result` columns) instead of `app.command_receipt`: the shared receipt table requires `root_id` referencing `app.lifecycle_root`, which root-less owner preferences do not have. A genuine lost-response retry (same command key and bytes) replays the stored committed result exactly once; the same key with different bytes CONFLICTs; a later command overwrites the stored key, after which the retry falls through to the `expectedRevision` check and CONFLICTs instead of misreporting another command's state as its own result. Forever-receipts are not provided; recorded as a deliberate deviation.
- 2026-10-22 — `revision` advances only on plan-relevant changes (goal/topic/clarification). Optional background/time preference, timezone and stage navigation update the row without advancing the revision, so epic-4 settings never invalidate a plan confirmation; any stale `expectedRevision` still CONFLICTs (row-level optimistic concurrency), which covers the stale second-tab case regardless of which fields changed.
- 2026-10-22 — The goal-stage component mounts only inside an open study (after Materials, before the plan editor), following the New-study flow Materials → Goal → Plan. Single mount line handed to the integrator; `study-app.tsx` was not edited by this package.
- 2026-10-22 — Time preference is a validated enum (morning/afternoon/evening/flexible) rather than free text, and background is bounded at 400 characters: both keep the "no forced time preference, no background essay" rule while staying validated for epic 4.
- 2026-10-22 — U1's library-level "saved time / material count" display lives in `study-app.tsx` (integrator-owned); this package exposes stage and revision through the pinned GET shape for whoever renders the library resume line. Not a deviation from S4 acceptance; recorded for visibility.

## Review Triage Log

- (none yet — independent review happens at integration)

## Design Notes

One row per owner; the row is both the saved state and its own idempotency receipt. Lock order is `identity_principal` (via `authorize`) then the preference row, so session revocation serializes against preference writes. GET has no command and no side effects; PUT always carries the command envelope. The UI retains in-memory edits on conflict and requires an explicit reload-and-reapply, mirroring the plan editor's revision-conflict behavior.

## Verification

- Package branch (ran): `npm run typecheck`, `npm run typecheck:worker`, `npm run lint`, `npm run boundaries`, `npm test` (unit, including the new preferences contract tests) — actual outcomes recorded in the package report; no skips/suppressions.
- At integration (not run here, §1.8): `db:start` + `migrate` (applies 004), `npm run test:integration` (four goal routes, short Other, invalid timezone, stale second tab, expiry recovery), browser cases in `tests/browser/preferences.spec.ts` (needs the integrator-applied route branch + mount), full gate; only then may this ticket's `status` become `'built'`.
