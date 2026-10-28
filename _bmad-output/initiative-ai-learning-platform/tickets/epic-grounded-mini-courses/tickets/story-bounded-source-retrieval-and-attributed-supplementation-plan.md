---
title: 'Bounded source retrieval and attributed supplementation'
type: 'feature'
ticket: 2
created: '2026-10-27'
status: done
baseline_revision: 'f55d239'
route: 'full'
route_source: 'auto'
risk: 'high'
review: ''
review_source: ''
lenses_ran: []
review_loop_iteration: 0
context:
  - '{project-root}/AGENTS.md'
  - '{project-root}/_bmad-output/initiative-ai-learning-platform/tickets/epic-grounded-mini-courses/delivery-checks.md'
  - '{project-root}/_bmad-output/initiative-ai-learning-platform/architecture-shared-technical/architecture-shared-technical.md'
  - '{project-root}/_bmad-output/initiative-ai-learning-platform/ux-ai-learning-platform/EXPERIENCE.md'
  - '{project-root}/docs/project-structure.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Generated lessons dead-end where the learner's uploads lack a needed explanation — the epic must fill gaps with identified, checked external sources without turning AI citations into verification or opening an uncontrolled egress surface.

**Approach:** Build the AD-11 bounded fetch boundary (allowlisted public-source HTTPS fetch adapter with DNS/IP-bound validation, per-redirect revalidation, private/loopback/metadata/non-HTTPS/oversize/credential denial — distinct from upload import, stdlib-only) plus a consent-gated supplement pass over a ready course: the processor proposes candidate sources for each gap (fixture-driven, zero egress), the bounded fetcher retrieves them, the pipeline verifies every claimed passage against the fetched content, and verified supplements persist with identity/location/passage/retrieval-time/hash records, render with a SUPPLEMENT badge distinct from uploads, show conflicts side by side, and stop honestly on unsupported claims with no scored item. Live fetch waits for F-B: this build ships the validated adapter plus fixture-driven pipelines with zero egress.

**Gate decisions (2026-10-27, recorded by the build session):** the owner's "continue to implement all the rest tickets of epic 2" direction authorizes this and the remaining entries; per-ticket checkpoints proceed under the standing decision delegation (surfaced, unanswered → logged, renegotiable). Purpose widened cumulatively by migration (v6: adds gap descriptions and generated-lesson summaries to the consented categories) — existing grants honestly lapse; one owner re-grant gates the supplement pass. Live fetch admission (F-B) stays unadmitted: `.local/source-fetch.json` does not exist and nothing reads a live endpoint in this build.

## Boundaries & Constraints

**Always:**
- Reuse the 2.1 machinery exactly: S5 handoff + existing course read paths, `admitDispatch`/`settleDispatch` (v6 config), command-receipt replay, restart-safe queue job (id = request id, retryLimit 0, 120 s cap), stranded-pending self-heal, honest failure codes; supplements attach to a specific ready course version and inherit its lineage fences.
- Fetch boundary per AD-11: allowlist-only public sources; HTTPS-only; resolve DNS and deny loopback/private/link-local/metadata (incl. 169.254.169.254, fc00::/7, fe80::/10, 100.64/10) ranges; bind the actual connected address to the validated one (custom `lookup`); revalidate scheme+allowlist+DNS/IP on EVERY redirect hop (manual redirect following); Content-Length + streamed byte caps; no credential/cookie forwarding; record source identity, passage/section locator, retrieval time, and content hash.
- Verification is never the model's claim: a supplement persists only when its claimed passage is lexically verified inside the fetched content and supports the gap's claim; AI-proposed citations, fetch success, and model agreement are not verification. Unsupported → honest state, no scored item, nothing persisted as content; conflicts render both sources side by side (upload excerpt vs supplement passage) and are never silently resolved.
- Zero egress in this build: automated gates and the default worker path use the injected fixture fetch port (deterministic passages); the live bounded fetcher is complete but resolves to honest `fetch-unavailable` without an admitted `.local/source-fetch.json` (absent here; F-B owns admission). Declined consent performs zero proposal dispatch and zero fetch.
- Deletion/export: supplements are root derivatives — new lifecycle kind `'supplement'` (015-rebuild precedent), purge through the lifecycle port with the course tables; export gains a `supplements` category with an honest deliberate skip (inclusion decided by entry 8); no scored/practice semantics (entry 5), no why-explorer use yet (entry 6), no per-activity contracts.
- Additive migration `016` (v6 config INSERT, `supplement_request` + `course_supplement` tables, kind CHECK rebuild) via `scripts/migrate.ts` only; no new dependencies (node stdlib: dns/https); tests unit+integration+browser, zero skips; `docs/project-structure.md` + a `docs/bounded-source-fetch.md` guide in the same change; Node v24.22.0, loopback-only.

**Never:**
- No live network fetch in any gate or default path (F-B); no search-engine querying, no cross-scope retrieval, no external vector service, no private excerpts in fetch URLs; no silent replacement of uploads; no scored items from supplements; no browser-side remote loads (CSP untouched).
- No new AI provider admission, no changes to 2.1's course generation contract beyond the supplement extension points; never write another module's tables.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Gap supplemented (happy) | ready course + plan gap + consent granted v6 + POST supplements | 202; job; supplement record: badge, identity, location, passage, retrieval time, hash; lesson view shows it beside uploads | — |
| Conflict | fetched passage conflicts with upload claim | both sources rendered side by side; no rewrite | — |
| Unsupported claim | fetched content lacks the claimed passage | honest unsupported state; no supplement content persisted; no scored item | — |
| Fetch failure | fixture/live fetch errors or times out | honest retryable failure (saved input); retry = new command | — |
| Zero-egress guarantee | no admitted fetch config | proposal-only never fetches live; fixture port or `fetch-unavailable`; no outbound packet from any test | — |
| Guard validations | URL: non-HTTPS / host not allowlisted / IP private,loopback,link-local,metadata / redirect to any of those / oversize / credentials | fetch denied before/at connection; recorded as honest denial | — |
| Consent not granted | decision ≠ granted under v6 | honest blocked state; zero dispatch, zero fetch, no request row | — |
| Cross-owner / deleted / ungenerated | B on A's root; deleted root; no ready course | 404 no-leak / 404 / CONFLICT "generate first" | — |
| Restart mid-job / duplicate delivery / command replay | queue survives restart; job redelivered; same commandKey | exactly one settled result; status-guard no-op; identical receipt | pending past 120 s self-heals to `timeout` |
| Root/personal deletion | supplements exist | port purge removes supplement tables + `'supplement'` objects; export lists `supplements` deliberately skipped | no late persistence |

</frozen-after-approval>

## Code Map

- `src/modules/course-generation/*` (2.1) — extend: service gains `requestSupplements`/`getSupplements` beside the course verbs; worker gains the supplement phase; `getCourse` unchanged. Supplement pass pins `objectIds = [courseObjectId, planRevisionId, selectionId, ...extractionIds]` (≤16).
- `src/adapters/ai-live.ts` — `AI_BUDGET`/config-load pattern to mirror for `.local/source-fetch.json` (`loadSourceFetchConfig()`, absent/invalid → null → `fetch-unavailable`).
- `src/adapters/openai-compatible.ts` — transport-injection pattern for the fetch port (validation logic pure, transport injectable → fixture port in tests, zero network).
- `src/modules/ai-setup/worker.ts` + `course-generation/worker.ts` — the settle-before-persist job shape to mirror (fenced re-read → propose → fetch → verify → settle → single-tx persist + ledger).
- `migrations/015-course-generation.sql` — precedent for v6 INSERT (`52410003-…-000000000006`, cumulative purpose + widened categories, ON CONFLICT DO NOTHING), kind-CHECK rebuild, derivative tables (UNIQUE admission; per-course positioning), ON DELETE CASCADE from generated_course.
- `src/adapters/queue.ts` / `scripts/migrate.ts` / `src/worker/main.ts` — add `SUPPLEMENT_QUEUE = 'supplement-fetch-v1'` policy (retryLimit 0, 120 s, 24 h) + subscription.
- `src/modules/lifecycle-platform/derivatives.ts` — extend the `course-generation` port (or sibling) with supplement purge + preview counts; `repository.ts` kind union + `'supplement'`.
- `src/contracts/{courses,export}.ts` + `src/modules/setup-export/{manifest,service}.ts` — supplement schemas/serving shapes (answers never involved) + `supplements` skip category.
- `src/app/api/v1/[...path]/route.ts` — `studies/{root}/supplements` GET/POST branches (202 + protectedResponse).
- `src/app/course-stage.tsx` — "Gaps & supplements" section in the ready view: consent-gated action, honest pending/failed/retry, badge + side-by-side conflict + unsupported states; keyboard-operable, polling never steals focus.
- `src/platform/config.ts` — loopback enforcement precedent; fetch validation must never weaken it.
- Tests: `tests/unit/course-generation.test.ts` (add fetch-validation + verification units), `tests/integration/course-generation.test.ts` (supplement flows), `tests/browser/course.spec.ts` (badge/conflict/retry journey); `docs/bounded-document-extraction.md` style for the new fetch guide.

## Tasks & Acceptance

**Execution:**
- [ ] `migrations/016-source-supplements.sql` — v6 config INSERT (cumulative purpose; categories add gap descriptions + generated-lesson summaries; honest retention notice); `app.supplement_request` (admission UNIQUE, terminal-monotonic statuses) + `app.course_supplement` (course_id CASCADE, position, url/origin identity, locator, passage, content_hash, retrieved_at, outcome supported|conflict|unsupported, failure-free content rows only); kind CHECK + `'supplement'`; idempotent guards.
- [ ] `src/adapters/source-fetch.ts` — pure URL/DNS/IP/redirect/size/credential validators + `createBoundedFetch(config, transport?)` (stdlib https + custom validated `lookup`, manual per-hop redirects, streamed byte cap) + `loadSourceFetchConfig('.local/source-fetch.json')`; no live call anywhere without admitted config.
- [ ] `src/contracts/courses.ts` — supplement job/record/serving schemas + `SUPPLEMENT_QUEUE`; gap schema derived from confirmed plan `missingExplanations` + lesson outcome context.
- [ ] `src/modules/course-generation/supplements.ts` — proposal parsing (strict, fixture-deterministic candidates: allowlisted host + path + claim + expected-passage digest), verification (normalized lexical containment of the claimed passage inside fetched content + claim-support check), conflict detection (upload excerpt vs supplement passage on the same outcome).
- [ ] `src/modules/course-generation/service.ts` — `requestSupplements` (ready-course precondition, v6 admission, budget, pending row, enqueue, receipt; same-course replay returns existing) + `getSupplements` (owner-scoped, lineage-fenced, per-gap states).
- [ ] `src/modules/course-generation/worker.ts` — `runSupplementFetch(job, completion?, fetchPort?)`: fenced re-read → one proposal completion → per-candidate bounded fetch (fixture default) → verify BEFORE settle → settleDispatch → single-tx (`registerObject 'supplement'` + supplement rows + markReady + ledger); every failure honest (`invalid-output`, `fetch-unavailable`, `fetch-denied:<reason>`, `rejected-late`, timeout self-heal).
- [ ] `src/modules/course-generation/repository.ts` — supplement row mapping + queries; `src/modules/lifecycle-platform/derivatives.ts` — purge/preview extension; `src/contracts/export.ts` + setup-export — `supplements` skip category.
- [ ] `src/adapters/queue.ts` + `scripts/migrate.ts` + `src/worker/main.ts` — queue wiring.
- [ ] `src/app/api/v1/[...path]/route.ts` — supplements GET/POST.
- [ ] `src/app/course-stage.tsx` — gaps & supplements UI (badge "Supplement — external source", identity/location/time, side-by-side conflict columns, unsupported notice, retryable failure + retry, consent-gated action with v6-gate copy).
- [ ] `tests/unit/course-generation.test.ts` (+ new `tests/unit/source-fetch.test.ts` if cleaner) — URL/IP/redirect/size/credential validator matrix, fixture port determinism, verification/conflict units (I/O-matrix edge cases).
- [ ] `tests/integration/course-generation.test.ts` — happy supplement, conflict, unsupported, fetch-denied fixture, consent-blocked zero-effect, cross-owner/ungenerated/deleted denials, restart-idempotency + stranded self-heal, purge, export skip.
- [ ] `tests/browser/course.spec.ts` — supplement journey (badge, side-by-side, honest failure), keyboard run, no outbound requests.
- [ ] `docs/bounded-source-fetch.md` (new) + `docs/project-structure.md` — adapter rules, F-B admission prerequisites, fixture mode; map update.

**Acceptance Criteria:**
- Given a ready course with a plan gap and v6 consent, when supplements are requested, then each gap resolves to a verified attributed supplement (badge, identity, location, retrieval time, hash), a side-by-side conflict, or an honest unsupported state — and never a scored item or silent rewrite.
- Given any fetch target or redirect hop that is non-HTTPS, unallowlisted, or resolves to a private/loopback/link-local/metadata address, or an oversized/credentialed request, then the fetch is denied before content handling and recorded honestly.
- Given no admitted fetch configuration, when the pipeline runs in any gate or default path, then zero network egress occurs (fixture ports only) and live-fetch attempts report honest `fetch-unavailable`.
- Given consent not granted, a foreign owner, a deleted root, or no ready course, when supplements are requested, then an honest denial with zero persisted effect.
- Given restart, duplicate delivery, command replay, or a stranded pending row, then exactly one settled supplement result per command.
- Given root/personal deletion, when purge runs, then supplement tables and `'supplement'` objects are purged and the export records the `supplements` skip honestly.

## Implementation Notes

## Plan Change Log

## Review Triage Log

### Quick lens pass (2026-10-27, 7 findings, verified by the orchestrator)

- **false** — "docs/bounded-source-fetch.md not part of the change": the file exists on disk (9.4 KB, untracked); the orchestrator's diff-staging grep accidentally excluded `docs/bounded*` from the staged diff. No gap in the change; staging filter corrected for later passes.
- **high** — `addressDenial` IPv6 gaps: `::127.0.0.1`, `::a00:1`, hex-form `::ffff:7f00:1`, and full-form `0:0:0:0:0:0:0:1`/`0:0:0:0:0:0:0:0` pass as public (only compressed forms are handled) — latent SSRF hole in the shipped F-B-ready boundary. → patch (full IPv6 normalization: v4-compatible/v4-mapped tails in dotted AND hex form, all-zero-with-tail loopback/unspecified; unit matrix extended).
- **medium** — worker can commit supplement rows + a `'supplement'` object for a request already failed `timeout` (inserts not status-guarded; `markReady` no-ops but the transaction continues). The same ordering shape exists in 2.1's `runCourseGeneration`. → patch (terminal UPDATE … RETURNING gates the whole persist in both workers; inserts only when the pending→ready transition actually happened).
- **medium** — `deriveGaps` silently truncates declared gaps at 8 with no notice. → patch (state carries the declared-gap total and a truncation notice rendered in the stage).
- **low** — selector-less `getSupplements` resolves to the previous ready course while the current revision's course is pending/failed, diverging from `getCourse`. → patch (mirror getCourse's resolution).
- **medium** — supplements GET failure leaves the section on "Loading supplement state…" forever with no retry. → patch (honest load-failed notice + retry, consistent with the stage's other states).
- **medium** — the fetch boundary forwards arbitrary query strings (`?token=secret`), so "no private excerpts in fetch URLs" rests only on the proposal schema. → patch (boundary denies any non-empty query outright — supplement pages need none — and the unit asserting queries allowed flips).

Verdict counts: high 1, medium 4, low 1, false 1, maybe-false 0. All real findings route to patch (no intent_gap / bad_plan).


## Design Notes

- The proposal and the fetch are separate untrusted steps: the processor only ever proposes candidates (allowlisted host + claim + expected passage digest); verification is deterministic code over fetched bytes. This is what makes "AI citation ≠ verification" structural, not procedural.
- Fixture fetch port: deterministic mapping from candidate URL → passage text (hash-stable), including fixture rows for conflict/unsupported/denied/oversize cases, so every display state is reachable without egress.
- v6 (not reusing v5) because the proposal input includes a new data category (gap descriptions, generated-lesson summaries); the S7 one-honest-re-grant precedent applies.
- Supplement records reference the course version they explain; entry 6 (why) and entry 8 (lifecycle classes) consume them from there.

## Verification

**Commands:**
- `nvm use && NPM_CONFIG_USERCONFIG=/dev/null NEXT_TELEMETRY_DISABLED=1 npm run migrate` — 016 additive.
- `npm run boundaries && npm run typecheck && npm run typecheck:worker && npm run lint` — green.
- `npm run test && npm run test:integration` — all suites green, zero skips.
- `npm run build && npm run test:e2e` — course spec (with supplements) green; typegen dance, restore dev state after.
- `npm run test:restart` — green (course + supplement beats).
- Full `npm run checks` at the wave boundary after this entry.

**Manual checks (if no CLI):**
- Sign in as A, re-grant under the v6 disclosure, open a generated course, request supplements, verify badge/location/conflict/unsupported states and that nothing egresses (no `.local/source-fetch.json` present).

### Patch round (2026-10-27)

All six real findings patched by the same implementation subagent and re-verified by the orchestrator: full IPv6 normalization in `addressDenial` (hextet expansion, v4-compatible/v4-mapped tails in dotted AND hex form, full-form loopback/unspecified; unit matrix extended); `validateFetchUrl` denies non-empty query strings ("query" reason); both worker persist transactions are claim-first (`UPDATE … WHERE status='pending' RETURNING` gates `registerObject`/inserts/ledger — two new mid-flight-race integration tests); `declaredGapCount` + `gapCount`/`gapsTruncated` surface an honest truncation notice; selector-less `getSupplements` mirrors `getCourse`'s resolution; a failed supplements GET renders an honest load-failed notice with re-read. Post-patch verification: boundaries, both typechecks, lint (113+probes), unit 186/186, integration 139/139, covering browser specs green.

### Environmental incident (2026-10-27, recorded not code)

Two mid-verification integration runs failed in epic-1 suites (restore ×4 cascading from one tar/pg_dump failure, tracer 20MiB ENOSPC) — root cause was DISK EXHAUSTION: `.local/backups` had accumulated 12 GB of encrypted snapshots from repeated restore-suite runs (189 files; failures leave dumps behind because the test's own purge never runs once creation fails). Cleared the synthetic artifacts (12 GB freed, 52% capacity) and both suites plus the full integration run went green (139/139). Not caused by this diff; the residue-vs-failure loop is a pre-existing test-hygiene gap worth an epic-sweep look (candidate for 2.9).
