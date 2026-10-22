---
title: 'Root-scoped deletion and complete late-work suppression'
type: 'feature'
ticket: 'S9'
created: '2026-10-22'
status: 'built'
baseline_revision: 'd851f8f77314ab8f7d8f38e84cac266f7f31916e'
route: 'full'
route_source: 'auto'
risk: 'high'
review: 'quick'
review_source: 'pinned'
lenses_ran: []
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/initiative-ai-learning-platform/tickets/epic-private-study-setup/delivery-checks.md'
  - '{project-root}/_bmad-output/initiative-ai-learning-platform/tickets/epic-private-study-setup/setup-experience.md'
  - '{project-root}/_bmad-output/initiative-ai-learning-platform/tickets/epic-private-study-setup/execution-plan-remaining-stories.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Deleting one material must revoke exactly its transitive derivatives, and a
whole-personal deletion must suppress every late result — with previews before any
destructive action and honest deadline/status visibility afterward.

**Approach:** Deliver S9 + U3/U8: dependency preview by category with cancel-default;
separate selected-root vs whole-personal delete (new command, own route); transitive A+B
invalidation extended to export/diagnostic derivatives via registered lifecycle ports;
pre-return denial through those ports; withdrawal-offers-deletion link; late recommit
rejection; idempotent purge; seven-day deadline visibility.

## Boundaries & Constraints

**Always:** Local synthetic data; all-ancestor lineage fences authoritative (no owner-wide
deletion flag); revocation durable before any post-commit step; purge idempotent; receipts
and journals content-free; cancel is the default destructive-flow state.

**Never:** Live AI, accounts/costs, deployment, real data, OCR/remote imports, new npm
dependencies, DB-backed suite runs on the package branch (no `.local/` here), or ticket
advancement past `planned` before the integration gate passes. Scheduler enforcement of the
seven-day deadline is S10/P7's — this ticket delivers visibility only and claims no
enforcement. No claims about S6, S7 closure, S12 or F1.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Root preview | `POST studies/{id}/dependencies` on a live root | Per-category counts (originals/extractions/selections/plans/confirmations/operations + ports), unrelated roots excluded | Deleted root, other owner, bad body denied; counts only, no text |
| Personal preview | `POST personal/removal` with `{schemaVersion:1,preview:true}` | Whole-account category counts incl. processing records/exports/diagnostics when present | No destructive effect, no deletion record |
| Root delete | Removal command on root A | A + transitive A+B tombstoned; B unrelated stays usable; in-flight jobs canceled | Replayed command returns one receipt; stale revision CONFLICT |
| Personal delete | Removal command (expectedRevision 0) | Every owner root tombstoned pre-return; deadline = +7d; one receipt per command key | Journal failure → RETRYABLE_FAILURE while denial stays durable; hash mismatch CONFLICT |
| Late results | Extraction/diagnostic/export/download settles after deletion | Recommit fails through lineage fences; canceled ports deny use; downloads stop at next chunk | No resurrection; already-downloaded bytes honestly unrecallable |
| Purge | Retried purge / reconciler | Idempotent; staging lease keeps state honestly `pending`; ports deny/purge retried until success | Failing port never restores access; overdue derived at read (visibility only) |

</frozen-after-approval>

## Code Map

- [derivatives](../../../../../src/modules/lifecycle-platform/derivatives.ts): registered
  lifecycle ports (preview/deny/purge), built-in export/diagnostic ports guarded on the
  pinned tables' absence, absence guard helper.
- [dependencies](../../../../../src/modules/lifecycle-platform/dependencies.ts): category
  preview computation (transitive roots + recursive object set), preview schemas, notes.
- [repository](../../../../../src/modules/lifecycle-platform/repository.ts):
  `relatedRoots`, `app.deletion_request` record/replay, `app.deletion_preview` journal.
- [service](../../../../../src/modules/lifecycle-platform/service.ts): extended
  `removeRoot`/`purgeRoot`/`reconcileCopies`; new `dependenciesPreview`, `personalRemoval`,
  `purgePersonal`, `reconcileDeletions`; two-phase personal denial → journal.
- [danger-zone](../../../../../src/app/danger-zone.tsx): `DangerZone` (root + personal
  flows) and `DeletionOffer` (U3 withdrawal-offers-deletion link), extracted from
  study-app's inline section; mount via integrator snippet.
- [migration](../../../../../migrations/008-lifecycle-completion.sql): additive
  `app.deletion_request` + `app.deletion_preview` only.

## Tasks & Acceptance

**Execution:**
- [x] Migration 008 (deletion_request + content-free preview journal; seven-day deadline column).
- [x] Registered-port registry with built-in export/diagnostic ports guarded on pinned-table absence.
- [x] Root dependency preview by category, journaled content-free, cancel-default UI (DangerZone).
- [x] Whole-personal delete command, own route, durable pre-return denial, idempotent replay, seven-day deadline visibility (overdue derived at read).
- [x] removeRoot/purgeRoot extended: ports deny before return; ports purge derivatives during idempotent purge; reconciler completes pending denials/purges.
- [x] DeletionOffer component + privacy-panel delta snippet for P1 (integrator applies after P1 merges).
- [x] tests/integration/lifecycle.test.ts (multi-client races: deletion vs in-flight extraction, protected download; personal end-to-end; synthetic adapter port contracts; failing-port recovery).
- [x] tests/browser/lifecycle.spec.ts (root flow with cancel default, personal flow with deadline receipt, cross-role/revoked denial, 360px/keyboard/focus).
- [ ] Integration gate (migrate + PG integration + build + browser + restart) — runs at integration, NOT on this branch.

**Acceptance Criteria:**
- Given A+B derivatives, when deleting A (root or personal scope), then preview names the
  categories first, cancel is the default, and accepted deletion denies affected
  reads/use/exports/downloads before returning while unrelated roots stay usable.
- Given a late extraction/diagnostic/export/download result after deletion, when it tries
  to recommit, then the lineage fences and canceled state reject it and no copy resurrects.
- Given a retried deletion or purge, when replayed, then one receipt per command key and
  idempotent cleanup; a failing port keeps access denied and the reconciler finishes it.
- Given seven days, when the deadline passes before purge completes, then status reads
  `overdue` (visibility only; enforcement/alerting is S10's) and access is never restored.

## Implementation Notes

- 2026-10-22 (package P6, branch `pkg/p6-lifecycle`, baseline d851f8f): implemented and
  gated on the package branch only — `npm run typecheck`, `typecheck:worker`, `lint`
  (0 warnings; 113 inventoried rules + probes), `boundaries`, unit 110 passed. The worktree
  has no `.local/`; the gitignored Next dev type cache was copied from the main workspace
  so `tsc` could resolve the committed dev imports of `next-env.d.ts` (no source or route
  changes involved). **Not run here (blocked by design, §1.8): `db:start`, `migrate`,
  `test:integration`, `build`, `test:e2e`, `test:restart`, `extractor:build`, `checks`.**
  This ticket therefore stays `planned` until the integrator passes the full gate.

## Plan Change Log

- 2026-10-22 — Recorded deviation (per plan §2): S9 proceeds over the derivative types
  that exist. P1's `app.processing_decision`/`app.dispatch_admission`, P4's
  `app.diagnostic_bundle`/`app.diagnostic_item`/`app.diagnostic_evidence` and P5's
  `app.export_request` are not on this branch; the built-in ports enumerate them by the
  pinned table names, guard absence via `to_regclass` + `information_schema` column checks
  and perform **no blind writes**. Coded blind against the pin's semantic column names
  (`owner_id`, `command_key`, `state`, `artifact_object_id`, `root_id`, `bundle_id`); if a
  merged module's actual columns differ, that module's module-owned port replaces the
  built-in at integration. Until then, export/diagnostic categories are honestly omitted
  from previews and pre-return denial for those derivatives rests on lineage invalidation
  plus each module's own re-authorization fences.
- 2026-10-22 — Replay semantics deviation for the personal command: unlike
  `lifecycle.replay` (frozen receipt), a repeated personal-removal command key returns the
  **current** protective state (pending/overdue/purged) so U8 status stays visible without
  a second destructive effect. Recorded here because it changes replay behavior for this
  command only.
- 2026-10-22 — Route shape decision within the two pinned routes: the personal preview is
  carried by `POST /api/v1/personal/removal` with an explicit
  `{schemaVersion:1,preview:true}` body (no third route invented); it has no destructive
  effect and records no deletion request. `POST /api/v1/studies/{id}/dependencies` takes
  exactly `{schemaVersion:1}`.
- 2026-10-22 — Journal-write ordering per U8: the durable denial commits in its own
  transaction **before** the protective `app.deletion_request`/preview-journal write; if
  the journal write fails the request returns RETRYABLE_FAILURE while affected use remains
  denied (retry with the same command key completes it). Root-scoped `removeRoot` keeps its
  existing single-transaction shape (Story 1 behavior, unchanged).
- 2026-10-22 — Coverage honesty: the plan-listed races against dispatch (P1),
  diagnostic-submit (P4) and export-ready commit/download (P5) cannot run real-table
  versions on this branch; tests/integration/lifecycle.test.ts covers them via the
  registered-port synthetic adapter contract tests (explicitly authorized by S9: fixtures
  establish interface behavior only) plus real races for extraction completion and
  protected download. Real-table race coverage lands when P4/P5 merge and the full gate
  runs at integration.
- 2026-10-22 — No worker/main.ts or package.json change is required: the personal-deletion
  reconciler rides the existing `reconcileCopies` maintenance loop the worker already
  calls every five seconds.

## Review Triage Log

## Design Notes

All-ancestor lineage fences stay authoritative: personal deletion tombstones every root and
invalidates the recursive object set — no owner-wide deletion flag exists. Ports exist for
derivatives that are not keyed on lifecycle roots (exports, dispatch receipts, future
reminder/course/media derivatives); a failing port never restores access because denial is
committed before ports run, and the reconciler retries deny/purge until success. Receipts,
journals and port effects are content-free; the preview journal expires in thirty days per
AD-4 (P7 owns the sweep). The seven-day deadline is a durable column; `overdue` is derived
at read time and enforcement/alerting is deliberately left to S10.

## Verification

- Package branch (executed 2026-10-22): typecheck, typecheck:worker, lint (0 warnings,
  113 rules + negative probes), boundaries, unit 110 — all passed. Integration/browser
  suites authored but not executed here (no `.local/` on package branches).
- At integration (pending): `migrate` applies 008 additively;
  tests/integration/lifecycle.test.ts under real PG (races, idempotent purge, physical-copy
  inventory, second-owner isolation); tests/browser/lifecycle.spec.ts after the integrator
  applies the route.ts/study-app.tsx snippets; full `npm run checks` unchanged.

## Code Review
