---
title: 'Authenticated consistent personal-setup export'
type: 'feature'
ticket: 8
created: '2026-10-22'
status: done
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
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Story 1 has no authenticated export of the learner's own setup data; later lifecycle stories (S9 deletion fences, S10 retention) need a registered export derivative category to fence and expire.

**Approach:** Deliver S8/F5 (export part) and U7: category preview, single-transaction consistent manifest snapshot, async durable request states, tar.gz artifact in private storage registered as a lifecycle object over the inventoried lineage, at-most-24-hour expiry enforced at download and by sweep, per-chunk reauthorized download, explicit regeneration.

## Boundaries & Constraints

**Always:** Local synthetic data; owner-scoped inventory; recursive lineage fences via `parent_ids`; content-free receipts; unchanged checks. Recheck/update Node before any gate rerun; the pending Node fix stays covered only by the recorded 2026-10-21 local exception.

**Never:** Live AI, accounts/costs, deployment, real data, OCR/remote imports, public or reusable download URLs, ticket advancement past gate evidence at integration, or any claim that S6, S7 closure, S12, F1 or release readiness changed.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Preview → request | Signed-in owner, `POST /exports` commandSchema body | Category preview beforehand; durable `queued` request; duplicate command replays one receipt/artifact | RATE_LIMITED at 3 active requests; CONFLICT on foreign command keys |
| Consistent snapshot | Concurrent edits/uploads during build | Manifest captured in one transaction; later edits need another explicit export | Capture-to-commit deletion/revocation cancels with no artifact |
| Ready → download | Fresh session, owner, unexpired | Streaming tar.gz, per-chunk reauthorization, `no-store`, attachment-only | 404 for other owners/bogus ids/expired/deleted lineage; mid-stream revocation stops chunks |
| Expiry | 24h elapsed | Download denies; sweep marks `expired`, invalidates the artifact object and purges bytes idempotently | Stale queued/running builders fail honestly (`service`), never hang |

</frozen-after-approval>

## Code Map

- [migration](../../../../../migrations/007-setup-export.sql): `app.export_request` PK(owner_id,command_key), states queued/running/ready/failed/expired/canceled, manifest/hash/expiry/artifact ids; adds the `export` lifecycle-object kind.
- [contracts](../../../../../src/contracts/export.ts): strict command/job schemas, manifest entry types, `canonical` order-insensitive hash form, 24h TTL and 512 MiB local artifact bound.
- [manifest](../../../../../src/modules/setup-export/manifest.ts): single-transaction inventory across originals, extraction revisions+metadata/warnings, selections, plans, confirmations; pinned-name enumeration of `app.processing_decision`, `app.dispatch_admission`, `app.diagnostic_*` with honest skip labels when absent.
- [tar/build](../../../../../src/modules/setup-export/tar.ts): dependency-free deterministic ustar writer; [build](../../../../../src/modules/setup-export/build.ts) streams tar→gzip→private storage with hashing and the size bound.
- [service](../../../../../src/modules/setup-export/service.ts): preview, idempotent request (command receipts), streaming download with per-chunk authorize/scopedRoot/assertObjects.
- [worker](../../../../../src/modules/setup-export/worker.ts): `runExport`, queue consumer + expiry/staleness sweep, one-line `workExports(boss)` registration for the integrator.
- [panel](../../../../../src/app/export-panel.tsx): U7 states with idle-safe polling; mount line delivered to the integrator.

## Tasks & Acceptance

**Execution:**
- [x] Additive migration 007 with the pinned `app.export_request` name and `export` lineage kind (Manual — applied only by `scripts/migrate.ts` at integration; never run by this package).
- [x] Contracts, manifest capture, tar/gzip builder, request/download/sweep services, panel (synthetic only).
- [x] Integration suite `tests/integration/export.test.ts` incl. beyond-criteria second-owner/deleted-root manifest comparison and artifact-ID unreachability (compiles; validated at integration only).
- [x] Browser cases `tests/browser/export.spec.ts` (compiles; runs at integration after route/mount wiring).
- [x] Unit suite `tests/unit/export.test.ts` for the ustar writer, gzip round-trip and contracts (executed on this branch).
- [ ] Independent review, full gate at integration, then `status: 'built'` by the integrator.

**Acceptance Criteria:**
- Given owner A and owner B with material, when A exports, then the manifest matches A's inventory exactly, contains no B rows, and the artifact is downloadable only by A's fresh session with `no-store`.
- Given deletion or revocation during the capture-to-commit window, when the build settles, then the request is `canceled`, no export object/file exists, and download denies.
- Given an expired artifact, when downloading or sweeping, then access denies and the active copy is purged idempotently; regeneration is a new explicit command.
- Given duplicate commands, when replayed, then exactly one artifact results.

## Implementation Notes

- Package P5 of `execution-plan-remaining-stories.md`; work done in worktree `project-worktrees/p5-export` on branch `pkg/p5-export` off baseline d851f8f. Route branches, `study-app.tsx` mount and `src/worker/main.ts` registration are delivered as integrator snippets, not applied (parallel-run file ownership).
- Checks actually executed on this branch (2026-10-22, Node v24.22.0): tsc `--noEmit` (only the two documented `next-env.d.ts` dev-cache errors remain in this cache-less worktree — environmental, imports preserved per AGENTS.md), `tsc -p tsconfig.worker.json` clean, ESLint clean, oxlint 0/0, lint coverage 113 rules + probes, module boundaries pass, unit suite 115 passed (110 baseline + 5 new). NOT run here (no `.local/`, single PG cluster belongs to the main workspace): `db:start`, `migrate`, `test:integration`, `build`, `test:e2e`, `test:restart`, `checks`, `extractor:build`. Integration/browser/restart evidence is pending until the integrator wires and runs them.
- The export artifact is a lifecycle object whose `parent_ids` are all inventoried lifecycle objects, so the existing recursive invalidation/purge covers exports; `tests/integration/export.test.ts` verifies download denial via that fence. `purgeExportRoots`/`exportRootsForOwner` are the module-owned ports P6 (S9) consumes; P6 still needs to wire them into `purgeRoot`/whole-personal deletion.
- Semantics recorded for review: deletion strictly before manifest capture yields a consistent post-deletion snapshot (never containing deleted lineage); deletion between capture and commit cancels; deletion after ready denies download via the fences. P1/P4 derivative tables are enumerated by pinned name when present, skipped with an honest per-category label when absent; exact row counts for those categories appear only in the manifest, not the preview.
- Build window: the staged artifact key uses the shared 5-minute staging lease (crash-reconciled like extraction staging); the 512 MiB artifact bound keeps builds well inside it. No runtime fallback exists if the local worker is down — requests stay `queued` and are honestly failed by the staleness sweep.
- All fixtures above are synthetic; no real data, providers or external calls are involved anywhere in this package.

## Plan Change Log

- 2026-10-22 (P5 author, under the plan's recorded S8 deviation): the §3 P2 interface-pin sentence "P5's confirm must consult `app.setup_preference.revision`" addresses plan-confirmation behavior, which P3 (S5) owns; S8 export neither confirms drafts nor lists preferences among its pinned categories (§3 P5 scope and delivery-checks S8). Not implemented here; flagged for the integrator so P3/P2 keep the confirmation-side pin.
- 2026-10-22 (P5 author): pg-boss queue `export-setup-v1` is registered idempotently by `workExports(boss)` at worker startup; if an operator wants the queue available before the first worker start, the integrator may add the matching `createQueue` to `scripts/migrate.ts` — not done by this package to avoid the shared migration-owner file.

## Review Triage Log

## Design Notes

Single-transaction capture, immutable keys, commit-time fence: the manifest is authoritative only if every inventoried object plus its full ancestor chain is still active when the artifact commits; otherwise the build cancels. The artifact object inherits every inventoried lineage through `parent_ids`, so deletion/invalidation propagates without export-specific flags. Deterministic ustar (mtime 0, identity-only entry names — document filenames never become archive paths), hashed twice: content hashes in the manifest (order-insensitive canonical form) and sha256 of the compressed artifact bytes.

## Verification

- Branch-executed (Manual, this worktree): both typechecks, ESLint + oxlint + coverage, boundaries, unit 115.
- Integration (pending, integrator): migration apply, PG integration suite incl. beyond-criteria second-owner/deleted-root and artifact-ID-unreachability cases, browser cases with the wired routes/panel/worker, full `npm run checks`.

## Code Review
