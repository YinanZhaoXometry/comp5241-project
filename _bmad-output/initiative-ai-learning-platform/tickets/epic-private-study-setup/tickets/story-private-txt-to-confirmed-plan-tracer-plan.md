---
title: Private TXT-to-confirmed-plan tracer
type: feature
ticket: 1
created: 2026-10-21
status: built
approved: 2026-10-21
execution_gate: local-verified-reviewed-runtime-exception
baseline_revision: d123d79317055a801f2957b985e05cfd45b20b1b
route: full
route_source: auto
risk: high
review: "quick"
review_source: "pinned"
lenses_ran: [quick]
review_loop_iteration: 0
context:
  - "{project-root}/_bmad-output/initiative-ai-learning-platform/tickets/epic-private-study-setup/runtime-preflight.md"
  - "{project-root}/_bmad-output/initiative-ai-learning-platform/tickets/epic-private-study-setup/delivery-checks.md"
  - "{project-root}/_bmad-output/initiative-ai-learning-platform/tickets/epic-private-study-setup/setup-experience.md"
  - "{project-root}/_bmad-output/initiative-ai-learning-platform/architecture-shared-technical/architecture-shared-technical.md"
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** No application proves private material-to-plan ownership, persistence or deletion.

**Approach:** One local TXT → worker preview → confirmed Manual one-mini-course plan journey with real sessions/PostgreSQL/private files and adversarial checks; not full epic acceptance.

## Boundaries & Constraints

**Always:** Synthetic-only; F1 before starter use. Adopted Next/TypeScript modules and separate worker; Better Auth DB sessions, cookie cache off, read-only GET/POST refresh. Current actor/subject/action and lineage checks everywhere. One migration owner; one SQL client for authorization/revision/state/receipt/enqueue. No-store, CSRF/origin checks, safe errors, content-free logs.

**Never:** External accounts/costs/AI calls/deploy/real data/pilot; fake AI/completion; public signup/self-promotion; future formats/diagnostics/exports/full retention/restore. No dependency overrides, suppressed checks or unapproved runtime. Tracer deletion/denial remain required.

## I/O & Edge-Case Matrix

| Scenario | Input / state                                   | Expected behavior                                                                    | Error                          |
| -------- | ----------------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------ |
| Tracer   | A, valid TXT                                    | Queued/extracting/preview; topic/four goals; save/confirm Manual mini-course         | Honest pending/failure by 120s |
| Invalid  | >20 MiB, empty/binary/non-TXT, malformed DTO    | Reject; no orphan copies/jobs                                                        | INVALID_INPUT                  |
| Privacy  | B/instructor/admin, revoked/expired session     | Deny material/text/plan/operation/stream; clear controlled UI                        | Generic denial/authentication  |
| Replay   | Duplicate command, changed body, stale revision | One committed result or conflict                                                     | CONFLICT                       |
| Delete   | Root removal racing extraction                  | Immediate denial; cancel/discard late output; remove copies; unrelated root survives | Safe pending cleanup           |

</frozen-after-approval>

## User-approved runtime amendment — overrides only the earlier Node stop

2026-10-21: after the pending HIGH-severity Node release was explained, the user said **"i do not consider this blocker, continue"**. This explicitly renegotiates the runtime prerequisite in the frozen text and older F1/G1 wording **only for local synthetic S1 implementation**. Proceed with an official supported Node 24 LTS release (24.22.0 at the last check), verified download checksum and separately installed executable; prefer the fixed patch if available. Do not stop solely because the announced fix is pending, use EOL Node 23, claim the issue fixed/F1 passed, or extend this exception to other findings or broader use. Recheck/update when the fix ships and before broader use. Bind all local services to loopback. All other tests, dependency audit, privacy, transaction and scope boundaries stay unchanged; no overrides/suppressions or remote Git operations.

## User-approved lint amendment — supersedes the preset pause

Latest instruction, 2026-10-21: **Replace the lint stack, preserve the required checks, and continue Story 1 locally with synthetic data only.** Replace the vulnerable Next preset/unsupported ESLint9 using normally resolved, exact-pinned maintained tools; Next/React/TS/application scope stays unchanged. Candidate: supported ESLint10/typescript-eslint plus native Oxlint Next/React/import/accessibility rules, but verify official docs, actual rule coverage/diagnostic behavior, peer compatibility and full native lockfile audit before accepting any choice. Do not merely remove the preset, weaken checks, permit unknown mappings, use overrides/suppressions or infer a new vulnerability exception. Inventory all effective prior preset rules/severities and document an executable mapping or equally strong alternative check for each; use deliberately invalid fixtures to demonstrate representative Next, React/hooks, TS, import and accessibility checks actually fail. Preserve a separate lint command alongside typecheck/unit/PGintegration/browser/build. Verify the full new lockfile audit and clean install/signatures. Then continue all remaining S1 work and matrix checks without another approval interview. Read historical stops as superseded only by these two explicit amendments.

## Code Map

- Reuse [S1/F1](../delivery-checks.md), [U0/U1/U2/U4/U5/U8](../setup-experience.md), shared AD-1–AD-4/7/9/11/15–18. Current source has thin web HTTP/UI, shared module-owned services, PostgreSQL/queue/private-file/TXT adapters, separate worker and unit/integration/browser/restart harnesses; see the root README for navigable entry points.
- [Preflight](../runtime-preflight.md): local-only runtime-risk exception plus authorized lint replacement; F1 not fully passed. Root manifests/configs/lockfile, isolated project PG18, application/harness and ignored verified runtime now exist. Explicitly export project-local Node24 PATH, NPM_CONFIG_USERCONFIG=/dev/null and NEXT_TELEMETRY_DISABLED=1 in EACH terminal call (exports reset); runtime is `.local/runtime/node-v24.22.0-darwin-arm64`, not nvm. Private starter was regenerated under explicit Node24. Preserve ticket metadata/BMad/other epics.

## Tasks & Acceptance

**Execution:**

- [x] Runtime/preflight — local checksum-verified Node24 exception, official starter regeneration, clean pinned install/audit/provenance; pending Node fix remains open, not F1 fully passed.
- [x] Root configs/scripts/lint coverage/manual-only CI — replacement coverage and separate Vitest/Playwright/type/lint/build/audit checks; no remote fonts/Compiler/Cache Components.
- [x] Migrations/platform/PostgreSQL — isolated PG18; ordered migration owner, no runtime DDL, scoped single-client transactions.
- [x] Identity/auth/provisioning — private A/B/instructor/admin fixtures, real sessions, GET-read-only/POST refresh/revocation fences.
- [x] Contracts/materials/adapters/worker — bounded streaming/isolated TXT, lineage, one-client enqueue/unique effects, staging reconciliation.
- [x] Lifecycle/setup — immutable plan revisions/exact confirmation; immediate fences, physical cleanup and late-output suppression; unrelated roots survive.
- [x] UI — minimal sign-in/library/setup, preview/goals/Manual plan, saved/conflict/pending/denial/removal states, keyboard/focus/360px/desktop.
- [x] Tests/docs — full local gate and independent review corrections pass; no ticket advance or broader-use claim.

**Acceptance Criteria:**

- Given approved runtime/lockfile/PG18, when separate checks run, then web/auth/worker compile, lint/audit and all test layers pass without overrides, with versioned evidence.
- Given synthetic actors/TXT, when A finishes and processes restart, then the exact Manual plan reopens without fake course generation/completion; unauthorized direct results remain denied.
- Given rollback/duplicates/deletion/revocation races, when independent clients inspect responses/ownership/copies, then no orphan job, duplicate effect, stale commit or resurrected copy exists; unrelated data survives.

## Implementation Notes

- 2026-10-21 — Final current result: independent Quick review plus follow-ups resolved all ten findings; no deferrals. Full post-correction checks pass unit4/PG15/browser10, audit0, lint113/probes, boundaries/types, sandbox, migrations, build and actual web+worker restart. Plan built locally; Node-only exception remains open and no ticket/remote/use authority advances. Earlier entries below are historical checkpoints, not current claims of absent source or failed checks.
- 2026-10-21 — Main agent completed missing work after empty handoffs and independently ran the full `npm run checks` pipeline: audit0, all lint/boundary/types, unit4/PG9/browser6, sandbox probe, migrations, build and real web+worker restart smoke pass. Initial browser failure was shared sensitive-route limiter exhaustion plus incorrect401 masking; fixed429 and split role cases with isolated fixture state, preserving and testing real throttling. Private operator actors provisioned. See README/preflight and lint evidence for exact versions/limits. No providers/real data/deploy/remote execution; F1 runtime exception still open. Next: staged-diff/matrix audit and independent review.
- 2026-10-21 — First replacement implementation handoff returned no meaningful report, leaving partial unverified source. Main agent independently ran full native audit (0 vulnerabilities), lint coverage (113 inventory, eight negative probes, positive JSX reference probe) and unit suite (4 passed). Typecheck correctly fails on missing lifecycle service/extraction modules imported by integration tests. Continue completing—not rewriting or dropping—the planned extraction/deletion/worker/web/transaction/browser paths. Existing partial source and scripts are now the code map; no application acceptance or matrix row is complete. Verify lint mappings against actual effective baseline, record pg-boss12.30.0 selection rationale, and review synthetic-only local database/auth/queue safety before starting tests. No block/permission question is needed merely for unfinished work.
- 2026-10-21 — Latest explicit user instruction authorizes replacing the lint stack while preserving checks and continuing local synthetic S1. Earlier keep-preset pause is superseded; approval/baseline/frozen intent preserved. Resume Step3 from actual bootstrap, verify lint first, then implement the rest; no other security exception or broader-use authorization.
- 2026-10-21 — Main-agent verification reproduced the audit under explicit project-local Node24/npm11. Checked stable/canary Next plugin dependencies and ESLint10/plugin peer ranges; no normal compatible fix was verified. Offered a maintained replacement lint stack with coverage/audit checks. User explicitly selected **Keep the exact Next ESLint preset and pause**. Stop with the existing preset, no override/suppression/replacement and all acceptance open; retain Node-only exception. No application server or test ran; do not proceed to review/completion for nonexistent application implementation.
- 2026-10-21 — Loaded all four frontmatter context files in full. Installed official Node 24.22.0 arm64 separately under ignored local storage after checksum verification, generated pinned official starter privately and established exact root manifests/configuration/lockfile. Native audit failed with five HIGH findings from one unpatched braces advisory in the official Next ESLint chain; latest registry/advisory checks confirm no patched release. Stopped under the unchanged non-Node security gate. No application source, worker, migrations, actors or test suite implemented. PostgreSQL 18.6 binaries installed after user explicitly chose to continue Homebrew's shared-dependency install; no database server started. See [preflight](../runtime-preflight.md) for outcomes and side effects. Ticket metadata/baseline/frozen intent remain unchanged.
- 2026-10-21 — User selected **Approve and continue**. Re-read the unchanged draft from disk and recorded approval; the frozen intent block is now locked. Approval authorizes implementation only after the recorded runtime/security gate passes, not a waiver of F1. Preserve the existing baseline revision.
- 2026-10-21T02:06:48+08:00 — Rechecked the uncached official security announcement, distribution index and latest Node 24 checksum listing. They still do not establish a fixed release for the announced HIGH issues: latest 24 remains 24.22.0, with 22.23.3/26.12.0 also predating the announced fixes. Marked execution blocked before application implementation/handoff or installation. Plan approval remains valid; resume with F1 recheck, not another intent-approval interview. No application checks have run.
- 2026-10-21T02:12:54+08:00 — User asked to explain and resolve F1. Direct official HTTP evidence and an independent read-only cross-check still identify no supported release fixing the pending advisory, including alternative 22/26 lines. Added phased resolution guidance to the preflight: runtime acceptance precedes starter use; actual lockfile/compile/lint/audit and database/queue tests follow, not a circular pre-scaffold demand. F1 remains blocked by upstream release verification, not permission; no frozen intent or acceptance changed, installation performed or application tests claimed.

## Plan Change Log

- 2026-10-21 — Recorded user-approved lint amendment outside unchanged frozen intent. Updated current status/context and bootstrap task; no product acceptance, denial/deletion/transaction matrix or test expectation removed.
- 2026-10-21 — User chose to preserve the exact Next ESLint preset and pause rather than authorize a different lint approach. Updated blocked handoff only; no product scope, frozen intent or test expectation changed.
- 2026-10-21 — Execution is now blocked by a separate, newly measured dependency-audit finding. The local Node exception remains valid; no broader exception, implementation acceptance, task completion or scope change was inferred.
- 2026-10-21 — User explicitly removed the pending Node release as a local development blocker. Added the bounded runtime amendment outside the unchanged frozen block, updated the first task/context and started implementation. This supersedes earlier blocked notes, not any other acceptance, test or external-use boundary. Baseline unchanged.

## Review Triage Log

| Finding                                                                   | Verdict | Checked evidence and route                                                                                                                                                                                                                     |
| ------------------------------------------------------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Late A responses restore UI after session change                          | high    | Verified async open/upload/editor callbacks omit the existing generation fence; polling alone cannot protect their later writes. Patch: apply the already-present generation check to these demonstrated completions.                          |
| Editable fields during save confirm different content                     | high    | Verified pending save clears dirty unconditionally while inputs stay editable. Patch: disable the existing form fieldset for the pending command; no new state/protocol.                                                                       |
| Reload confirms unseen latest revision                                    | high    | Verified reload retains local plan but leaves clean flag unchanged. Patch: retained edits must be dirty until explicitly resaved.                                                                                                              |
| Removal key shared between unrelated roots                                | medium  | Verified map key is constant and upload does not clear it. Patch: use root-specific key, preserving same-root retry idempotency.                                                                                                               |
| Retryable-failed view no longer polls                                     | medium  | Verified retry state excluded from existing polling predicate. Patch: include it so automatic recovery remains visible.                                                                                                                        |
| Purged receipt ignores unregistered staged output                         | medium  | Verified staging has owner but no root and leases survive crashes. Patch: conservatively keep cleanup pending while that owner's staging exists; existing expiry reconciliation clears it before final purge. No new lineage schema/claim.     |
| Root-specific cleanup failure prevents worker/supervision                 | high    | Verified first thrown purge aborts entire maintenance/startup. Patch: isolate existing per-root/per-copy cleanup failure, retain pending rows and continue unrelated reconciliation/supervision.                                               |
| Exhausted retry remains advertised retryable                              | medium  | Verified failedOperation never considers already-configured queue retryCount/limit. Patch: use existing queue metadata through same-client adapter when setting terminal failure. No new retry endpoint or policy.                             |
| Follow-up: save's post-command read can substitute another client's draft | high    | Reproduced in browser: P's response held, Q saved independently, completion enabled confirmation while P displayed. Patch: compare the receipt's immutable draft ID with post-command read, preserve dirty edits on mismatch.                  |
| Follow-up: killed final attempt bypasses catch                            | medium  | Reproduced durable crash boundary in PG: app extracting, queue failed, reconciliation did not settle it. Patch: existing maintenance reconciles terminal/missing queue state through existing failedOperation; no new retry surface or policy. |

All findings concern demonstrated states and admit bounded corrections using
existing fences/commands/queue metadata; no intent change or new public surface.
Implementation subagents cannot be resumed by this host, so main agent applies
the patches and adds failing regression tests before full re-verification.

Resolution: all ten verified findings corrected. Original reviewed cases and the
two follow-up races have regression coverage; focused RED runs demonstrated the
editor/crash/cleanup failures before their fixes. Final `npm run checks` passes
audit0, lint113/probes, boundaries, web+worker types, unit4/PG15/Chromium10, sandbox,
migrations, build and real web+worker restart. Independent follow-up inspection
confirmed both final exact-draft and terminal-crash guards. No findings deferred.

## Design Notes

SQL cannot roll back files: registered staging, server-generated keys and bounded reconciliation are required. Extraction stays outside transactions; commit rechecks ancestor generations/current authorization. Queue deduplication is not effect idempotency.

## Verification

Current local evidence (2026-10-21): clean install with lifecycle scripts disabled;
native full audit0;253 registry signatures/121 attestations; ESLint+native Oxlint
effective severity/options and stronger restrictions verified for113 entries with
8 negative probes/positive JSX reference; web+worker typecheck, dependency direction,
unit4, real PG integration15, production build, Chromium10 and actual process restart
smoke pass. Latest strengthened integration run includes explicit runtime DDL denial,
rollback of receipt+state+job, and invalid-input file/job inventory. No tests skipped.
The earlier missing modules and browser throttle masking failures were corrected,
not hidden. Screenshot inspected: legible layout/statuses and focus tested; no
WCAG certification claim. Bun types supply only the imported `bun:sqlite` declaration
required by Better Auth core; Bun is not installed/run and skipLibCheck stays false.

| Frozen matrix row | Ran-and-passed covering evidence                                                                                                                                       |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tracer            | Browser full upload/preview/four-goal/Manual save+confirm+reopen journey; integration persistence and121-second pending; actual web+worker restart smoke               |
| Invalid           | Unit strict/authority/UTF8 contracts; PG invalid extension/empty/binary/oversize rejects with identical file/job/staging inventories; browser malformed DTO400         |
| Privacy           | Browser captured material/text/plan/operation requests replayed as B/instructor/admin and after revocation, UI cleared; integration expiry/mutation/late-worker denial |
| Replay            | PG identical/changed upload, duplicate/simultaneous confirmation and stale save checks; one queue/effect/revision/receipt                                              |
| Delete            | PG paused extraction/deletion race: immediate denial, canceled operation, no late rows/physical copies, unrelated root usable; browser confirmation/cancel/removal     |

Full staged unified diff was read, including source/test/config/docs and lock root
metadata; generated lockfile integrity/resolution is independently checked by clean
install, signatures and native audit. Quick review and corrections complete; no
finding deferred. Build workflow creates a local conventional commit; no ticket
advance or remote operation.
Accepted pending Node security release is unresolved, not F1/release passed.
