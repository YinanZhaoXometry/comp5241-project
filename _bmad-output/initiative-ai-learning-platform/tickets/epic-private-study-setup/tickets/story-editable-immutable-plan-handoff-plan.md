---
title: 'Editable immutable plan and exact confirmation handoff'
type: 'feature'
ticket: 5
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
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The confirmed Manual plan has no shared exact-revision handoff for epic 2, and the editor does not yet state every U5 invariant (edited-after-confirmation, deleted-source handoff rejection, readiness honesty).

**Approach:** Deliver S5 + U5: extend the existing Manual plan editor with verified coverage/missing-explanation labeling and the authorized exact-revision handoff query that returns confirmed plan/source/goal/objective identities plus provenance while rejecting absent confirmation, unauthorized/deleted lineage and stale substitution. No generation job and no completion award.

## Boundaries & Constraints

**Always:** Local synthetic data; read-only handoff over existing immutable tables; ownership and lifecycle fences on every identity; duplicate confirmation stays one receipt; manual work labeled Manual.

**Never:** Live AI, generation jobs, completion awards, accounts/costs, deployment, real data, new npm dependencies, ticket advancement past `built`, editing `src/app/api/v1/[...path]/route.ts` or `src/app/study-app.tsx` (integrator applies delivered snippets).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Exact handoff | Confirmed plan + acknowledged selection | Exact planRevisionId/selectionId/extractions + provenance + confirmedAt, single-transaction read | Per-chunk re-authorization on streamed output |
| Absent confirmation | Draft only | No handoff content | CONFLICT; never substitutes the draft |
| Unauthorized/deleted lineage | Other owner, revoked session, deleted source/plan | No content | FORBIDDEN_OR_NOT_FOUND / UNAUTHENTICATED; mid-stream deletion errors remaining chunks |
| Duplicate confirmation | Same commandKey replay; different command, same revision | One receipt; one `app.plan_confirmation` row | Replay returns the identical receipt |
| Stale draft | Goal/topic preference change after draft save | Confirm of the older draft CONFLICT; history preserved | Fresh save re-bases and confirms |

</frozen-after-approval>

## Code Map

- [handoff](../../../../../src/modules/materials-setup/handoff.ts): read-only exact-revision query + guarded `preferenceRevision` read of the pinned `app.setup_preference` name.
- [service](../../../../../src/modules/materials-setup/service.ts): savePlan records the preference baseline; confirmPlan enforces the guarded stale-draft CONFLICT.
- [repository](../../../../../src/modules/materials-setup/repository.ts): `insertPlan` persists the nullable baseline.
- [migration](../../../../../migrations/005-plan-handoff.sql): one additive nullable column; the handoff query itself is zero-DDL.
- [editor](../../../../../src/app/plan-editor.tsx): U5 labeling, edited-after-confirmation state, confirmed-view pinned sources and readiness honesty.
- [tests](../../../../../tests/integration/handoff.test.ts), [browser](../../../../../tests/browser/handoff.spec.ts): exactness, denials, one-receipt regression, beyond-criteria races.

## Tasks & Acceptance

**Execution:**
- [x] Verify/extend editor coverage/missing-explanation labeling (estimates labeled, flags not fetched citations) and add the edited-after-confirmation and readiness-honesty U5 states (confirmed-view pinned sources, disabled explained course action, library honesty verified in place).
- [x] Deliver the zero-DDL handoff query returning exact confirmed identities + provenance, rejecting absent confirmation, unauthorized/deleted lineage and stale substitution.
- [x] Wire the cross-package P2 pin: `app.setup_preference.revision` consulted by pinned name, guarded on relation/row existence; confirm of a draft older than a goal/topic change CONFLICTs.
- [x] Add migration 005 (one nullable `preference_revision` column) applied only by the migration owner; no new table, no other DDL.
- [x] Regression-test the one-receipt duplicate confirmation; beyond-criteria two-tab edit/confirm and source-deletion-between-admission-and-commit tests; browser honesty cases.

**Acceptance Criteria:**
- Given a confirmed plan, when the handoff is queried, then it returns exactly the confirmed revision, acknowledged selection and selected extractions with Manual provenance, never a draft.
- Given an absent confirmation, foreign owner, revoked session, deleted/invalidated lineage or mid-stream source deletion, then the handoff denies with no substitute content.
- Given duplicate confirmations (replayed, raced, or different-command), then exactly one receipt row and one confirmation row exist.
- Given a goal/topic preference change after a draft save, then confirming that older draft CONFLICTs and a fresh save confirms.
- Given any confirmed flow, then no generation job and no completion award is created.

## Implementation Notes

- 2026-10-22 (package P3, branch `pkg/p3-handoff`, baseline d851f8f): implemented on branch only; DB-backed suites (integration/browser/restart/build) were NOT run in the package worktree by design (§1.8) and are validated at integration. Branch checks actually run: typecheck, typecheck:worker, lint, boundaries, unit — results recorded in the delivery report; no DB-backed pass is claimed.
- All fixtures are original synthetic content; all plan editing is Manual; no AI, provider or worker changes.

## Plan Change Log

- 2026-10-22 — Cross-package pin implemented against `app.setup_preference` (P2's 004 migration) before that table exists on this branch: `preferenceRevision()` reads the pinned name and treats SQLSTATE 42P01 (relation absent) or a missing owner row as "no preference recorded", skipping the stale-draft check instead of failing. Once P2 lands, the check activates without code change.
- 2026-10-22 — DDL deviation, kept minimal: the handoff query itself is zero-DDL as directed, but the stale-draft pin needs to know which preference revision a draft was saved against, so `005-plan-handoff.sql` adds one nullable column `app.plan_revision.preference_revision` (no new table; `app.handoff_receipt` not needed). NULL (legacy drafts, preference-less owners) skips the check so legacy confirmations never break.
- 2026-10-22 — Integration-test seeding assumption: the P2-pin test seeds only `(owner_id, revision)` on `app.setup_preference`. If P2's final schema makes further columns NOT NULL without defaults, that seed insert must be extended when integrating (it will fail loudly there, not silently pass). The test branches on `to_regclass('app.setup_preference')` and asserts the specified behavior in either world — it never skips.
- 2026-10-22 — Error-code choice: absent confirmation maps to CONFLICT (state precondition), deleted/unauthorized lineage to FORBIDDEN_OR_NOT_FOUND (lifecycle fences), reusing only the six frozen codes; no `errors.ts` change.
- 2026-10-22 — Scope notes: `study-app.tsx` library honesty ("Plan confirmed — course not generated") verified as already present and left untouched (integrator-owned); route/mount snippets delivered to the integrator; no study-app mount line is needed because the editor is already mounted.

## Review Triage Log

## Design Notes

The handoff is a single-transaction read over immutable tables (`plan_revision` → `plan_confirmation` → `selection_revision` → `selection_source` → `batch_slot` → `extraction_revision`); mutable latest-draft pointers are never read. Streamed responses re-authorize the full object set per 16 KiB chunk, which is what turns "source deletion between admission and commit" into a fail-closed partial read. `batchRow`'s `FOR UPDATE` serializes handoff reads against concurrent confirmations. Provenance is honestly `Manual`; no fetched-citation or eligibility claim exists anywhere in the path.

## Verification

- Branch (executed): `npm run typecheck && npm run typecheck:worker && npm run lint && npm run boundaries && npm test`.
- Integration (deferred by plan §1.8): migrate 005, `tests/integration/handoff.test.ts` (exact handoff, denials, one-receipt duplicates, two-tab substitution, deletion races, P2 pin), `tests/browser/handoff.spec.ts`, then the full gate before flipping status to `built`.

## Code Review
