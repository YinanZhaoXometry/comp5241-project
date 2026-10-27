---
title: 'Refactor sweep'
type: 'refactor'
ticket: '2.9'
created: '2026-10-27'
status: 'draft'
baseline_revision: ''
route: 'full'
route_source: 'auto'
risk: 'medium'
review: ''
review_source: ''
lenses_ran: []
review_loop_iteration: 0
context:
  - '{project-root}/AGENTS.md'
  - '{project-root}/CONTRIBUTING.md'
  - '{project-root}/docs/project-structure.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Eight build entries left recorded friction that is cleanup-eligible: test-hygiene gaps that caused real incidents (disk exhaustion, config-version races, parser cold-start flakes), an undocumented UI-handler convention that cost hours this epic, and small duplication the reviews flagged.

**Approach:** A cleanup-only sweep over the recorded deferred items, preserving every accepted UX/privacy/lifecycle/contract semantic: (1) restore-test snapshot hygiene (failed runs leave `.local/backups` dumps — the 12 GB incident; bound and sweep test snapshots); (2) processor_configuration test-fixture hygiene on the shared dev DB (document the max+1 pattern's shadowing effect and add a clearly-labeled cleanup/wedge so the honest rows stay discoverable — WITHOUT changing the ordered-version contract or any suite's behavior); (3) the react-hooks pure-handler convention (documented in CONTRIBUTING: state-held envelope caches, effect-owned polling with scalar deps, DOM-id focus choreography — the pattern this epic converged on after the compiler fights); (4) small mechanical deduplications flagged by reviews where zero-risk (e.g. repeated poll-cap boilerplate extraction ONLY if it does not touch behavior); nothing else. Every change runs the unchanged regressions; anything semantic becomes its own entry.

**Gate decisions (2026-10-27):** covered by the owner's "continue to implement all the rest tickets of epic 2" direction; the sweep's scope is the deferred/review-recorded items only — if investigation shows an item is not cleanup, it is recorded and left for its own entry (a no-op is an acceptable outcome per the S9 contract).

## Boundaries & Constraints

**Always:**
- Cleanup only: no behavior, contract, UX-copy, privacy, lifecycle or test-expectation semantics change; all regressions run unchanged and green before and after; zero skips/suppressions introduced.
- The ordered processor_configuration contract is untouchable (no version renumbering, no deletions of honest rows, no test-behavior change — hygiene means documentation + clearly-labeled discoverability aids at most).
- Snapshot hygiene must not weaken the restore tests' real-failure paths: bound what accumulates (test-run residue), never the operator's real backup inventory semantics.
- CONTRIBUTING/docs updates in the same change; `docs/project-structure.md` if paths change; Node v24.22.0, loopback-only, no new dependencies.

**Never:**
- No new features, no deferred-review items that need semantics decisions (those go to deferred-work or entry 10 notes), no scope creep beyond the recorded items, no "while I'm here" refactors of working code without a recorded review finding.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Restore-test failure | a restore test fails mid-run | test snapshots from the run are swept; disk cannot accumulate GBs across failing runs | — |
| Fixture discoverability | dev DB with squatted versions | honest config rows remain discoverable (documented query/wedge); suites unchanged | — |
| Convention doc | new handler code | CONTRIBUTING names the pure-handler pattern and the map of accepted shapes | — |
| Regressions | full gate before/after | identical green; any diff is a semantic change → reverted to its own entry | — |

</frozen-after-approval>

## Code Map

- `tests/integration/restore.test.ts` + `scripts/backup.ts`/`restore.ts` — where snapshots accumulate; a bounded test-scope sweep (afterAll/finally) is the likely shape.
- `tests/integration/{consent,ai-check,ai-draft,preferences}.test.ts` + `tests/browser/{consent,course}.spec.ts` — the max+1 grant() pattern; docs only unless a zero-risk wedge exists.
- `CONTRIBUTING.md` — the react-hooks pure-handler convention section (course-stage.tsx as the worked example).
- `src/app/course-stage.tsx` — ONLY if a flagged duplication extracts with zero behavior change; otherwise untouched.
- `scripts/checks.mjs` — parser warm-up before e2e ONLY if the flake analysis supports it without weakening honesty (the cold-start timeouts were environmental; a warm-up matches production reality).

## Tasks & Acceptance

**Execution:**
- [ ] Snapshot-residue sweep for the restore suite (bounded, semantics-preserving).
- [ ] Config-fixture discoverability documentation (+ zero-risk wedge if one exists).
- [ ] CONTRIBUTING pure-handler convention section.
- [ ] Any zero-risk mechanical deduplication from review records (or explicitly recorded as skipped).
- [ ] Full unchanged regressions before/after; record the diff inventory in the plan.

**Acceptance Criteria:**
- Given a failing restore run, when it finishes, then no unbounded snapshot residue remains.
- Given the dev DB's squatted config versions, when a developer reads the docs, then the honest rows and the shadowing mechanism are discoverable in one place.
- Given the full gate, when run before and after the sweep, then it is green both times with no expectation changes.
- Anything not done is recorded with its reason (no-op is acceptable).

## Implementation Notes

## Plan Change Log

## Review Triage Log

## Design Notes

- The epic's own records are the sweep's backlog: the 2.2 disk incident, the 2.4/2.8 config-drift notes, the 2.6 react-hours, and the review-flagged dead code (already removed in-place). If an item turns out semantic, record and skip — the S9 contract allows a recorded no-op.

## Verification

**Commands:**
- `nvm use && NPM_CONFIG_USERCONFIG=/dev/null NEXT_TELEMETRY_DISABLED=1 npm run checks` — green before and after (this entry's own gate is the unchanged full suite).

**Manual checks (if no CLI):**
- Force one restore-test failure; confirm no residue; inspect the new docs sections.
