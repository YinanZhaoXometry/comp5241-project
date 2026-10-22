---
title: 'Bounded retention and archive contract'
type: 'feature'
ticket: S10
created: '2026-10-22'
status: 'built'
baseline_revision: '558a381712a38faebc1b0884aec4a2beeddb2070'
route: 'full'
route_source: 'auto'
risk: 'high'
review: 'quick'
review_source: 'pinned'
lenses_ran: []
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/initiative-ai-learning-platform/tickets/epic-private-study-setup/delivery-checks.md'
  - '{project-root}/_bmad-output/initiative-ai-learning-platform/tickets/epic-private-study-setup/execution-plan-remaining-stories.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Derivative copies exist without an explicit bounded-retention inventory: nothing records which active copies exist, under which class they expire, or when a deadline has been missed — expired copies remaining available is the recorded high risk.

**Approach:** Deliver S10: a retention registry over the explicit active-copy inventory (export artifacts 24h, deletion active-purge 7-day deadline status/alert, content-free metadata/receipts 30d, backup/journal classes registered for S13), a synthetic ninety-day course-archive notice/export/purge fixture with synthetic course-controller records, a duplicate-safe scheduler with failure/retry and receipt cleanup, and a refuse-unregistered-derivative-persistence check other modules call when registering copies.

## Boundaries & Constraints

**Always:** Local synthetic data; additive migration applied only by the migration owner; content-free registry rows (no material, plan or answer text); the seven-day purge stays with the deletion reconciler and the 24h export purge with the export sweep — this story records classes, evaluates status/alerts and alerts never restore access; module write ownership (the scheduler deletes only tables this module owns); duplicate scheduler execution safe; clock-controlled tests manipulate timestamps via SQL UPDATEs, never the system clock.

**Never:** No live AI, external accounts/costs, deployment, real data, new npm dependencies, edits to other modules' files or the reserved `errors.ts`, ticket advancement past 'planned', any S13 physical backup/journal implementation (class registration alone is not backup evidence), any instructor enrollment/authoring or epic-5 integration (the archive contract admits only synthetic-fixture rows), any claim about S6, S7 closure, S12, F1 or release readiness.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Unregistered derivative persistence | `registerRetentionCopy`/`requireRetentionClass` with a class absent from the registry | Persistence refused at the registry check | `INVALID_INPUT`; never a silent omission from deletion |
| Duplicate registration / duplicate scheduler run | Same copy registered twice; `reconcileRetention` run twice or concurrently | One idempotent registry row per copy; guarded upsert refreshes only still-active rows; every step idempotent (`FOR UPDATE SKIP LOCKED`, guarded terminal writes) | A purged row is never resurrected by a late re-registration |
| Export artifact at 24h | `ready` request past `expires_at` | Export sweep (driven by the scheduler) marks `expired`, erases bytes, nulls the key; registry row `purged`; download denied | Failed erase retried next sweep; overdue without erasure proof alerted |
| Deletion deadline at 7d | `pending` deletion request past `deadline_at` | One overdue alert recorded on the registry row; request stays `pending`; all reads stay denied | Enforcement stays with the deletion reconciler; alert never restores access |
| Content-free receipts at 30d | `deletion_preview` past `expires_at` | Journal row deleted; registry receipt `purged`; study data untouched; purged registry receipts deleted after their own 30-day ceiling | Expiry receipt never resurrects data |
| Archive contract at 60d/90d | Synthetic fixture past `notice_due_at`, then past `purge_due_at` | Notice recorded; learner-initiated export replays one receipt; purge deletes the synthetic course-controller record only behind a recorded notice | Export before notice → `CONFLICT`; after purge → `FORBIDDEN_OR_NOT_FOUND` |
| Sweep/enforcement step fails | Any scheduler step throws | Step logged as pending (`retention-*-pending` event) and retried next run; other classes unaffected | No false success; failed class converges on retry |

</frozen-after-approval>

## Code Map

- [migration](../../../../../migrations/009-retention-registry.sql): `app.retention_registry` (pinned; one content-free row per active copy, class CHECK identical to the code-side class set, guarded unique upsert index) and `app.archive_contract` (pinned; synthetic-fixture-only ninety-day notice/export/purge contract).
- [retention](../../../../../src/modules/lifecycle-platform/retention.ts): `RETENTION_CLASSES` + `requireRetentionClass` (refuse-unregistered check), `registerRetentionCopy` (the check+register call site for other modules), `syncRetentionInventory` (known stores never silently omitted), `reconcileRetention` (duplicate-safe scheduler: drives `sweepExports`, evaluates export/deadline status+alerts, owns `deletion_preview` expiry, advances the archive contract, cleans receipts), `createCourseArchiveFixture`/`exportCourseArchive` (synthetic fixture only).
- [integration tests](../../../../../tests/integration/retention.test.ts): expiry boundaries vs actual files/rows, overdue alert without restored access, receipt cleanup with no resurrection, archive ordering, concurrent duplicate runs. [unit tests](../../../../../tests/unit/retention.test.ts): code/migration class-set identity, pinned ceilings, refusal contract.

## Tasks & Acceptance

**Execution:**
- [x] Additive migration `009-retention-registry.sql` with the two pinned table names; no existing table altered.
- [x] New `src/modules/lifecycle-platform/retention.ts` only — no existing lifecycle/export/deletion file modified; cross-module wiring delivered as snippets for the integrator.
- [x] Retention classes registered for S13's backup/journal physical implementation (configuration only, explicitly not backup evidence).
- [x] Duplicate-safe scheduler with failure/retry logging and receipt cleanup; enforcement responsibilities preserved (reconciler/sweep own purges).
- [x] Synthetic ninety-day archive fixture with synthetic course-controller records and the refuse-unregistered-derivative check.
- [x] Clock-controlled integration tests (SQL timestamp manipulation) + unit contract tests. Branch-level gates: typecheck/typecheck:worker/lint/boundaries/unit run; **all DB-backed suites not runnable on this branch** (single PG cluster owned by the integration workspace) — validated at integration.

**Acceptance Criteria:**
- Given any derivative copy, when it is persisted, then its retention class is checked and unregistered kinds are refused rather than silently omitted from deletion.
- Given an expired copy (24h/30d/90d), when the scheduler runs (once or repeatedly), then the registry inventory matches the actual files/rows and nothing expired remains served.
- Given a deletion deadline passed, when the scheduler evaluates it, then an overdue alert is recorded once without restoring access and enforcement stays with the reconciler.
- Given the synthetic ninety-day archive fixture, when notice, export and purge deadlines pass, then the recorded order is notice → export → purge and no expiry receipt resurrects data.

## Implementation Notes

- 2026-10-22 (P7, branch `pkg/p7-retention` off wave-2 milestone 558a381): implemented as scoped above. Scheduler hook for `src/worker/main.ts` and module-side registration call sites for other modules are delivered as exact snippets in the package report for the integrator — no other module's file was edited, per package constraints. `app.deletion_request` deadline visibility (P6) is consumed read-write only where P6's comment assigns the sweep to this module; the reconciler's enforcement path is untouched.
- Status is 'planned' and stays 'planned' until the full gate passes at integration (§5 of the execution plan); branch-level check results are recorded in the Plan Change Log honestly, including everything that could not run here.

## Plan Change Log

- 2026-10-22 — Deviation recorded (plan §2 anticipated it): the S10 classes enumerate the derivative stores that exist after wave 2 (export requests, deletion requests, deletion-preview journals, the synthetic archive contract) plus the S13 backup/journal classes; blocked S6/S7 derivative types are not enumerated and are exactly what the refuse-unregistered check exists for.
- 2026-10-22 — Branch-level results (Manual, local synthetic): `npm run typecheck` fails at the pre-existing baseline of 558a381 (2 worktree-local errors from the absent `.next/dev` cache referenced by `next-env.d.ts`, plus 1 pre-existing `tests/browser/check.spec.ts:102` TS7006 that also fails on the integration workspace at 558a381); zero errors attributable to P7 files (baseline error list compared before/after). `npm run typecheck:worker` passes clean. `npm run lint` fails on the pre-existing baseline `react-hooks/refs` error in a wave-2 file (reproduced on the integration workspace at 558a381); no P7 lint findings. `npm run boundaries` passes. `npm test` (unit) passes: 131 tests (128 baseline + 3 new). `tests/integration/retention.test.ts` compiles on the branch but is NOT RUN here — no DB-backed suite may run on a package branch (one PG cluster, owned by integration); its outcomes are recorded at integration, not claimed now.
- 2026-10-22 — Design decision: the scheduler deletes only rows in tables this module owns (`deletion_preview` expiry is assigned to this module by migration 008's comment); registry rows for other modules' overdue copies are alerted, never blindly deleted — module write ownership preserved. `archive_contract` rows are deleted at purge (matching S9 purge semantics); the registry receipt records `purged_at`.
- 2026-10-22 — Integration-failure triage, fixed on the TEST side (`tests/integration/retention.test.ts` case 1); implementation and migration 009 unchanged. Symptom: on the integrated database the stored `expires_at` was 55,067 ms EARLIER than the `Date` the test passed to `registerRetentionCopy`. Root cause: the case's fixture used globally fixed locator literals (`'synthetic-copy'` / `'synthetic_store'` / `'row-1'`) on the GLOBAL copy-identity unique index while the integration database persists rows between suite runs; a completed earlier run leaves that locator purged with expiry = earlier-run param + 1h (its own duplicate refresh). On re-run the first INSERT conflicts with the leftover, the guarded upsert's `WHERE state='active'` — correctly — refuses the refresh, and the fallback SELECT returns the leftover id, so the duplicate/idempotency assertions passed and the expiry assertion read the stale leftover value (observed delta = inter-run gap − 1h = 55 s ⟹ prior run ~65 min earlier). The implementation contract holds: the passed `Date` is bound as `$8` and both the INSERT and the DO UPDATE store `EXCLUDED.expires_at` exactly (no `clock_timestamp()`/`LEAST`/floor touches `expires_at`, positional bindings match the column list), so every still-active row's stored expiry equals the caller-passed value; refusing refresh for purged rows is the required no-expiry-receipt-resurrects-data guarantee. A fresh database cannot fail this assertion (the duplicate would store param + 1h), which is why it surfaced only on the persistent integration database. Fix: per-run random locator (kind + rowId suffix); the duplicate-refresh assertion is strengthened from "greater than the first param" to exact equality with the passed refresh expiry. Migration 009 bytes unchanged (applied/frozen on the integration database; no schema change was needed or made).

## Review Triage Log

- (none yet — independent review happens at integration)

## Design Notes

The registry is an inventory, not an enforcer: enforcement stays with the merged reconcilers (deletion reconciler for the 7-day purge, export sweep for 24h artifacts), while the scheduler drives/retries them, derives overdue status, records alerts and owns the content-free receipt ceilings. One registry row per physical/logical copy under a guarded expression unique index makes duplicate executions and duplicate registrations no-ops and makes a purged row unresurrectable. The archive contract's CHECK (`notice_due_at < purge_due_at`) plus statement order (notice pass before purge pass) and the purge guard (no purge without a recorded notice) make "notices/export precede purge" structural, and the fixture admits only `source='synthetic-fixture'` rows so no epic-5 integration can be pretended.

## Verification

- Branch-level (Manual, this worktree): typecheck, typecheck:worker, lint, boundaries, unit — exact outcomes in the Plan Change Log, including pre-existing baseline failures not attributable to this package.
- At integration (not runnable here, honestly deferred): `db:start` + `migrate` (009 additive), `npm run test:integration` including `retention.test.ts` (beyond-criteria: expired-copy inventory vs actual files/rows; archive fixture order; no receipt resurrects data), the one-line worker hook wiring, module-side registration call sites, browser cases are NOT in this package's scope, and the full gate per §5 before any status move past 'planned'.
