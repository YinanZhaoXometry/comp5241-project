---
title: 'Bounded four-format extraction and explicit preview'
type: 'feature'
ticket: 2
created: '2026-10-21'
status: 'built'
baseline_revision: 'a04f898632c101e2a238e053084a37c948e74138'
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

**Problem:** Story 1 supports only TXT and singleton sources.

**Approach:** Deliver S2/F2 and U2: bounded four-format ingestion, per-file previews and immutable acknowledged selection feeding the existing Manual plan.

## Boundaries & Constraints

**Always:** Local synthetic data; ownership, immutable revisions, all-source fences, unchanged checks. Recheck/update Node before execution. If its fix remains pending, approval explicitly extends the existing Node-only local exception to S2; F1 remains incomplete. No other advisory waiver. Preserve unrelated Word-lock deletion.

**Never:** Live AI, accounts/costs, deployment, real data, OCR, remote imports, macro/code execution, ticket advancement or later-story expansion. Preserve demo/adapter behavior.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Legal boundary | Four formats; up to ten inputs, 20 MiB each | Readable at-limit fixtures succeed; immutable text/locations/warnings | Explicit resource failure, never truncated success |
| Invalid input | Oversize/eleventh, MIME disguise, encrypted/corrupt/no-text/archive | No usable extraction | Safe per-file reason; replace/remove/retry |
| Mixed batch | Some files fail or remain pending | Account for every slot; explicitly acknowledge successful revisions | No silent exclusion or unreviewed plan source |
| Replay/races | Duplicate, cancel, restart, stale selection, deletion | One result; saved originals; no late commit/use | Conflict/retry state; honest status by 120 seconds |

</frozen-after-approval>

## Code Map

- [contracts](../../../../../src/contracts/setup.ts): strict commands, singleton `extractionId`.
- [service](../../../../../src/modules/materials-setup/service.ts): receipts/confirmation; owner pending limit ≠ batch count.
- [extraction](../../../../../src/modules/materials-setup/extraction.ts): retain attempt/session/generation fences; [storage](../../../../../src/adapters/private-files.ts) assumes UTF-8.
- [schema](../../../../../migrations/001-tracer.sql): additive migration only; immutable triggers.
- [lifecycle](../../../../../src/modules/lifecycle-platform/service.ts): extend removal/purge/reconciliation; implement transitive traversal.
- [queue](../../../../../src/adapters/queue.ts): retain `extract-txt-v1`. Seatbelt TXT copier ≠ document isolation.

## Tasks & Acceptance

**Execution:**
- [x] Add parser/image/probes; extend [build](../../../../../scripts/build-extractor.ts): pin Python image digest, pypdf 6.21.1 hash, assessed non-Expat replacement/zlib/licenses; audit image/dependencies. Streaming ZIP/XML, not host Poppler/libzip. Local synthetic F2 evidence only; broader activation remains blocked.
- [x] Extend mapped contracts/storage and [HTTP](../../../../../src/platform/http.ts): bounded binary originals, validated text/provenance, authorized attachment-only downloads.
- [x] Add migration via [migration owner](../../../../../scripts/migrate.ts); extend [repository](../../../../../src/modules/materials-setup/repository.ts)/service: ordered slots, atomic ten-input admission, immutable acknowledgments, exact source references, singleton backfill.
- [x] Extend extraction/queue/worker/lifecycle: bounded concurrency, content-free v1-compatible jobs, cancel/retry/restart cleanup; all-ancestor read/save/confirm/commit fences and transitive invalidation.
- [x] Extend [UI](../../../../../src/app/study-app.tsx), plan editor/API: per-file preview/warnings, remove/replace/retry, acknowledged selection/conflicts; retain one Manual mini-course.
- [x] Test matrix in unit/PG/browser suites and restart smoke; record F2/setup evidence; independent review.

**Acceptance Criteria:**
- Given singleton records/v1 jobs, when migrating/restarting, then authorized plans survive without duplicate copies.
- Given A+B, when deleting A during extraction/confirmation, then derivative access/commits fail and copies purge; B remains usable.
- Given another owner/revoked session, when accessing new endpoints/jobs, then deny without private-content logs.
- Given hostile DOCX, when parsing, then external observations prove bounded resources, no egress/traversal/private reads and complete cleanup.

## Implementation Notes

- 2026-10-21 replacement/full-gate result: source-built lxml6.1.3/libxml2 2.15.4/libxslt1.1.45; Expat extensions absent from merged runtime rootfs, failed actual imports/no loaded mapping, hash-guarded downstream pypdf XMP interpretation disabled before decoding. Six focused isolated regressions passed after genuine RED. Upstream libxml2 untrusted-data warning is recorded; only controlled synthetic scope, no broader activation/waiver. Fresh `npm run checks` passed audit0/lint113+probes/boundaries/both types/unit110/integration52/build/browser27/restartPDF plus all resource/denial/hostile observations. Frozen matrix audited to those unfiltered passing suites. Independent Quick review remains next.
- 2026-10-21 continuation decision: Human selected “Assess a non-Expat replacement and continue.” Assessment and necessary public dependency downloads are authorized within the existing local/synthetic scope; no new risk waiver is assumed and no repeat Story 2 approval is required. lxml 6.1.3 is a candidate only; inspect its exact wheel-native libraries and advisories before selection. Keep active admission absent until the replacement passes source assessment, audit, probes and the full regression gate.
- Current blocker (2026-10-21): official Expat sources expose newer 2.9.0 fixes and validated unresolved non-public issues; bundled 2.8.5 cannot be certified unaffected. Image audit0 did not detect this bundled component. No non-Node waiver exists. Active admission quarantined; readiness fails closed and the build now rejects the candidate before document fixtures/admission. See [F2 evidence](../../../../../docs/bounded-document-extraction.md). Preserve implementation; do not mark built or advance tickets. A safe alternative parser assessment or explicit human risk decision is required before proceeding.
- Parent verification before that blocker: unit110, integration46 (all four files), existing tracer10/demo12 browser cases plus focused new batch5, real restart with queued PDF/replayed receipt/singular copies, lint113/probes, boundaries and both types passed. First combined browser run failed two new harness cases; corrected deadline/isolated roles passed without weakening application limits. Final combined gate and independent review remain pending, not implied by these partial results.
- Added outside-process hostile-fixture observations after a real RED test: daemon isolation/diff/timing/removal for traversal, expansion, external relationship and XXE private-read. No syscall-trace or packet-capture claim. Legacy migration, 120-second pending, duplicate upload, A+B deletion, cancel/late-result and attachment bytes have actual executed coverage.

- 2026-10-21: Human approved and requested implementation. Official uncached Node recheck still lists 24.22.0 with the verified archive checksum and pending-release wording; proceed under the explicitly approved S2-local Node-only exception, not an F1 security pass. Baseline and unrelated Word-lock deletion preserved.
- First implementation handoff returned without a report. Partial parser/contracts/migration/batch/lifecycle files exist; application HTTP/UI/worker readiness, full tests and evidence documentation are unfinished. Do not treat this partial state as complete. Local parser admission records Python 3.14.8/pypdf 6.21.1/Expat 2.8.5/zlib 1.3.2, image `sha256:752d33fcc38068c30300d1df89b9536fe68e2ada9602a9d8b76ac4691fb2c84d`, audit findings empty, memory/CPU/wall/output kill observations. Reverify after parser changes. Parent typecheck failed: Docker environment lacks Next-required `NODE_ENV` and build assertion uses an invalid overload. Finish the entire approved plan and report actual commands/results, including any remaining limitations.

## Plan Change Log

## Review Triage Log

- 2026-10-22 — Quick review (2026-10-21, one context-free lens) returned 1 decision + 4 patch findings; all five resolved under the standing decide-all delegation, none deferred:
  1. (Decision, took recommended option 1) `getStudy` now returns `operation: null` for non-singleton batches instead of a fictional aggregate; the only consumers read slot state directly, and singleton batches keep the real `app.operation` identity. Regression: batches integration "exposes a real aggregate operation only for legacy singleton batches".
  2. (Patch) `uploadSlot` now applies the same owner-wide pending-extraction cap (10) as the v1 upload inside its committing transaction; overflow is RATE_LIMITED with no registered object, operation, staging row or stored copy. Regression: "applies the owner-wide pending-extraction cap … without orphan copies".
  3. (Patch) The 1 Hz study poll is gated on `slots.some(state ∈ queued|extracting|retryable-failed)`; idle studies no longer re-read full extracted text. Existing retry-polling browser case masks slot state too, plus a new case proving zero polls on an idle study.
  4. (Patch) Delete receipts re-read the affected batch revision after per-slot `touchSource` inside the transaction, so the public token equals the final revision for batch-root and slot-material deletions. Regression: "delete receipts carry the final affected batch revision".
  5. (Patch) Dead export `matchesSignature` deleted from `contracts/documents.ts`; enforcement remains in `parser.py` admission checks and `disguisedBinary`/MIME validation.
- 2026-10-22 — Re-verification after fixes: `npm run checks` passed in full (audit0; lint 113 entries + probes; boundaries; both typechecks; unit 110; extractor rebuild; migrate; PG integration 55; production build via the authorized `next typegen` dance with the dev cache restored afterward; browser 28; real-process restart). Gate initially failed on two environmental regressions, both fixed without weakening checks: (a) the updated Trivy database flags CVE-2026-107891 on the pinned base's musl 1.2.6-r2 — fixed release 1.2.6-r3 pinned in both parser stages and the image fully re-admitted (see `docs/bounded-document-extraction.md`); (b) trailing newlines appended to both applied migration files by an editor after the last passing gate — applied byte-exact content restored, hash check unchanged.

## Design Notes

Independent roots plus batch aggregate; selection pins manifest revision, extraction IDs/exclusions. Individual previews, not 200 MiB polls.

Fixed-image local Linux parser, stdin/stdout only: nonroot/read-only, no mounts/secrets/network/ports/capabilities, no-new-privileges, restrictive seccomp. Pin local daemon; no content logs/runtime pulls. Ceilings: 512 MiB hard memory/no swap, one CPU, 10 CPU seconds, 30-second wall kill, 16 PIDs/64 FDs; text 20 MiB plus metadata 256 KiB. DOCX: 2,048 entries, actual expansion 64 MiB aggregate/32 MiB member; reject traversal/duplicates/symlinks/encryption/macros/OLE/external relationships/DTD/entities. Never extract to disk. Prove limits/orphan cleanup; isolation failure blocks parsing, never native fallback.

Locations: PDF pages, DOCX part/paragraphs, namespace-aware XML; literal UTF-8 TXT/Markdown line ranges. Bound metadata even for newline-dense at-limit text. Warn on layout/nontext omissions; reject empty-password encryption too. Record official parser/container references with F2 evidence.

## Verification

- `npm run checks` — preserve every gate; add real parser/probes, not mocked F2 evidence.
- RED→GREEN: four exact-20-MiB fixtures, concurrent eleventh admission, selection forgery, ancestor races, cancel/restart copy inventory.
- Record versions/licenses/provenance/isolation measurements. Preserve Next cache compatibility; no skips/suppressions. Verify keyboard/360px/desktop and demo/tracer regressions.

## Code Review

### 2026-10-21

**Code review complete.** 1 `decision-needed`, 4 `patch`, 0 `defer`, 0 rejected. Independent quick review (one context-free lens) of every change since baseline `a04f898`, tracked and untracked (76 modified/deleted files +9,672/−1,945, 19 new files; 15,346 diff lines in one pass). All five findings were verified against the surrounding code; verdicts: four medium, one low. The lens confirmed the frozen intent, matrix and all four acceptance criteria are otherwise implemented and covered (additive migration 002 with legacy backfill/immutability tests, transitive A+B invalidation with B surviving, cross-owner/revoked-session denial on every new endpoint, outside-parser hostile-DOCX observations with resource ceilings and cleanup, per-slot 120-second honest pending), that the quarantined Expat admission stays rejected, and that no ticket was advanced.

- [ ] [Review][Decision] getStudy aggregate `operation` for multi-slot batches is fictional — `operation.id` is the batch rootId (no `app.operation` row carries it; `GET operations/{id}` would 404) and `state` falls back to `slots[0].state`, mislabeling mixed batches (e.g. "preview" while a slot still awaits upload, "canceled" for a batch with an awaiting-upload slot). No current consumer, but any fix changes the public study payload shape [src/modules/materials-setup/service.ts:77]. Options: (1) Return `operation: null` for non-singleton batches and have the UI derive poll-activeness from `slots`. (2) Keep the aggregate but make `state` honest ("extracting" while any slot is active, otherwise omit `id`). (3) Drop the `operation` field from the study payload entirely. Recommended: (1) — honest, matches the only real consumer need, smallest contract change.
- [ ] [Review][Patch] Batch upload path drops the owner-level pending-extraction cap [src/modules/materials-setup/batches.ts:68-97] — v1 `upload` refuses a 10th queued/extracting operation per owner (service.ts:36-37); `uploadSlot` enqueues with only the ≥3 concurrent-staging cap, and batch count is unbounded (10 live slots each), so one learner can queue unbounded jobs/originals. Fix: apply the same owner cap before `createOperation`/`enqueue` in `uploadSlot`'s committing transaction.
- [ ] [Review][Patch] Unconditional 1 Hz study polling re-reads and re-ships full singleton extracted text [src/app/study-app.tsx:77-84; src/modules/materials-setup/service.ts:76] — the poll lost its queued/extracting/retryable-failed gate, and `getStudy` reads up to 20 MiB of extracted text on every call for singleton batches although the UI previews via `sources/{rootId}/{extractionId}`; contradicts the Design Note "Individual previews, not 200 MiB polls". Fix: gate the interval on `slots.some(state ∈ queued|extracting|retryable-failed)`; explicit post-action reloads already cover the rest.
- [ ] [Review][Patch] Delete receipt reports a revision the batch will not have [src/modules/lifecycle-platform/service.ts:23-36; src/modules/materials-setup/batches.ts:65-67] — the receipt returns `item.revision + 1` captured before `touchSource` runs once per slot root, so an N-slot batch ends at R+N; slot-material deletes return the material sequence. Safe direction (spurious CONFLICT), but the public token is wrong. Fix: re-read the affected batch revision after the loop, inside the transaction.
- [ ] [Review][Patch] Dead contract export `matchesSignature` [src/contracts/documents.ts:26-29] — referenced nowhere in src/tests/scripts; implies an admission-time signature check that never runs (enforcement is in parser.py and `disguisedBinary` at extraction). Fix: delete it.

Rejected: none.