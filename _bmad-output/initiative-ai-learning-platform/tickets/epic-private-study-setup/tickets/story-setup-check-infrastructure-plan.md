---
title: 'Optional starting check infrastructure (S7 infrastructure subset)'
type: 'feature'
ticket: 7
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

**Problem:** S7's optional starting check has no infrastructure; it also cannot close, because its take-path acceptance depends on S6's eligible structured generator (F3 blocker).

**Approach:** Build ONLY the S7 infrastructure subset + UX U6: an optional 3–5-item check offered equally with "Skip for now" from a confirmed plan, with typed setup-diagnostic evidence and no completion/score/recovery semantics. Items come from a manually authored synthetic bundle pinned to the confirmed plan revision — explicitly NOT generator output.

## CLOSURE PENDING S6 ELIGIBILITY

**This ticket does not close S7.** The take-path acceptance — a validated check produced on an eligible generator path — stays OPEN until S6's F3 blocker (no eligible processor/model/terms, no account/region/budget/operator authorization) clears. Generator-mock output does not satisfy that acceptance; the manually authored synthetic bundle here is labeled synthetic infrastructure, not a passing take path. Do not advance this ticket past 'planned' until the package passes the full gate at integration, and never record S7 closure or S12 done.

## Boundaries & Constraints

**Always:** Local synthetic data; ownership/scoped authorization; immutable bundles and single-record evidence; per-item answer/rationale withheld until that item's submission; unanswered = Unknown; skip path finishes setup without penalty and stays equally visible; distinct recorded paths for skip/partial/finish/double-submit/unclear-flag/plan-edit/deletion.

**Never:** Live AI or generator mocks presented as real output; completion credit, scores, grades, recovery or scored-course attempts; new npm dependencies; ticket advancement past authorization; edits to route.ts/study-app.tsx (integrator applies delivered snippets); touching files owned by other packages.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Offered | Confirmed plan supporting the item links | Equally visible Take / Skip; 3–5 items, answers withheld | Take without confirmation fails server-side |
| Unavailable | Plan cannot support objective/source links | Honest Unavailable state; Skip still finishes setup | No fabricated/renumbered items |
| Submission | Answer or skip per item, unaided/assisted | Typed evidence row; reveal only that item's answer/rationale | Double submit replays one record; contradicting choice CONFLICTs; skip is final |
| Stale/deleted | Plan re-confirmed or lineage deleted | Old evidence historical on its pinned revision; submissions deny | CONFLICT on stale use; purge with the root |
| Leakage | Pre-submission HTML/API/payloads | No answer keys or rationales anywhere | Beyond-criteria test asserts absence incl. streamed bytes |
| Completion conversion | Direct attempt | No score/credit/completion fields exist; unknown action paths 404 | Evidence never grants credit |

</frozen-after-approval>

## Code Map

- [migration](../../../../../migrations/006-setup-diagnostic.sql): pinned tables `app.diagnostic_bundle`, `app.diagnostic_item`, `app.diagnostic_evidence`; bundle ids are lifecycle objects (kind `diagnostic`, parent = confirmed plan revision) so existing recursive fences cover check use; cascades keep purge correct.
- [contracts](../../../../../src/contracts/diagnostic.ts): strict commands; read models with no answer/rationale before submission and no score/credit fields anywhere.
- [bundle](../../../../../src/modules/setup-diagnostic/bundle.ts): MANUALLY AUTHORED synthetic fixture (Manual label), hand-validated; rejects unsupported plans instead of fabricating items.
- [repository](../../../../../src/modules/setup-diagnostic/repository.ts): module-owned persistence + `purgeDiagnostics` port (parity with `purgeMaterial`) for P6/S9.
- [service](../../../../../src/modules/setup-diagnostic/service.ts): take/skip/submit/finish/flag with command-receipt idempotency, revision pinning, one-bundle-per-confirmed-revision.
- [component](../../../../../src/app/check-stage.tsx): U6 states; mount line delivered to integrator.
- Tests: [unit](../../../../../tests/unit/diagnostic.test.ts), [integration](../../../../../tests/integration/diagnostic.test.ts) (incl. beyond-criteria leakage + conversion-denial checks), [browser](../../../../../tests/browser/check.spec.ts).

## Tasks & Acceptance

**Execution:**
- [x] Migration 006 with pinned table names; kind-check extension recorded for integrator coordination.
- [x] Contracts, module (bundle/repository/service), component, unit+integration+browser tests authored.
- [x] Branch checks run: typecheck, typecheck:worker, lint, boundaries, unit.
- [ ] Integrator: apply route + mount snippets, run migration, full gate (integration/browser/build/restart) — required before any status change.

**Acceptance Criteria (infrastructure subset only):**
- Given a confirmed plan, when offered, then Take and Skip are equally visible and Skip finishes setup without penalty.
- Given a taken check, when reading any pre-submission payload, then no answer key or rationale appears; after submitting an item, only that item's answer/rationale is revealed.
- Given duplicate/contradicting/stale/deleted paths, then one recorded outcome per item, CONFLICT on contradictions, historical evidence preserved on its pinned revision, purge with the root.
- Given any recorded state, then no completion/score/recovery/credit semantics exist or can be produced from the evidence.

## Implementation Notes

- 2026-10-22 (P4, package branch `pkg/p4-diagnostic`): Implemented on the baseline `d851f8f`. The take path uses the manually authored synthetic bundle only. The check "result" per item is `correct|incorrect|unknown` recorded as typed evidence with actor/scope/pinned revision/assistance/unclear flag; it is explicitly not a grade and grants nothing. Skip is recorded as a content-free command receipt (action `skip-check`), finish as `finish-check`, unclear-flag as `flag-item`; item evidence rows are immutable except the one-way unclear flag. A skipped item is final (cannot be answered afterwards) to keep evidence immutable and paths distinct.
- Item-link validation: the fixture supports confirmed plans with ≥3 outcomes and ≥2 acknowledged sources; others are honestly Unavailable and Skip finishes setup. This is a fixture property, not a product rule; an eligible generator (blocked S6) would replace the catalog.
- The bundle's lifecycle object is registered with raw SQL inside the module (kind `diagnostic`) because `lifecycle-platform/repository.registerObject`'s kind union is owned by P6; behavior mirrors it (root lock + ownership checks + parent assertions).

## Plan Change Log

- 2026-10-22 — Migration extends the shared `app.lifecycle_object` kind check to include `'diagnostic'` (precedent: migration 002 added `'selection'`). Coordination note for the integrator: any later migration that rewrites this check (e.g. an export kind) must include `'diagnostic'`.
- 2026-10-22 — P1/P2 tables (`app.setup_preference`, `app.processing_decision`, …) do not exist on this branch; no code reads them. The check is offered from the confirmed plan regardless of processing consent (manual path, no AI), so no P1 dependency was needed.
- 2026-10-22 — A `tests/unit/diagnostic.test.ts` was added beyond the package's listed test files to hand-validate the authored bundle independently of any generator (supports the "manually validate bounded fixture items" requirement); no other scope added.
- 2026-10-22 — Skipped-item finality (no late answering) chosen under delegated design; recorded here as a design decision for review, not an assumed product rule.

## Verification

- 2026-10-22 branch results (package worktree, Node v24.22.0): `npm run typecheck` passed; `npm run typecheck:worker` passed; `npm run lint` passed (ESLint 0 warnings/errors, Oxlint 0/74 files, coverage 113 inventoried rules + 8 negative probes + JSX positive probe); `npm run boundaries` passed; `npm test` passed (unit: 4 files, 115 tests — includes the 5 new manual-bundle validation tests). The worktree has no `.local/`, so the temporary Next dev route-types cache was generated by briefly starting the loopback dev server on port 3199 (no requests, no DB) and stopping it; `next-env.d.ts` was restored byte-exact to HEAD after the run had normalized its quote style.
- NOT run here (blocked on this worktree by design, validated at integration): `db:start`, `migrate`, `tests/integration/diagnostic.test.ts`, `tests/browser/check.spec.ts`, `build`, `test:restart` — all DB-backed or production suites.
- At integration: apply route/mount snippets, `npm run db:start && npm run migrate`, full gate; only then `status: 'built'` with the closure-pending note retained.

## Code Review
