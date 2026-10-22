---
title: Epic 1 remaining-stories parallel execution plan
created: 2026-10-22
authority: Assistant-authored planning under the user's standing decide-all delegation
baseline: 206a749 (story 1.2 built, review closed, full gate passed)
scope: S3,S4,S5,S7(infrastructure),S8,S9,S10,S13,S11 + blocked records for S6/S7-closure/S12
status: ready-for-assignment
---

# Epic 1 remaining-stories parallel execution plan

Read before any implementation work: `AGENTS.md`, `project-overview.md`, the epic
([epic-private-study-setup.md](epic-private-study-setup.md)), the story contracts
([delivery-checks.md](delivery-checks.md), sections S1–S13 + F1–F6), the UX contract
([setup-experience.md](setup-experience.md), U0–U8), and `docs/bounded-document-extraction.md`
before touching anything parser-adjacent. This plan assigns every remaining locally
implementable entry to a self-contained work package so several agents can work in
parallel without file collisions, then defines the integration order.

## 0. Current state (do not re-verify, trust and build on it)

- Baseline commit **206a749** on branch `feat/implmentation-of-step-2-and-3`: Story 1.1
  built+reviewed; Story 1.2 built with all five quick-review findings fixed, full local
  gate green (audit0, lint 113+probes, boundaries, both typechecks, unit 110,
  integration 55, production build, browser 28, restart smoke). Parser re-admitted on
  musl 1.2.6-r3 (CVE-2026-107891); see `docs/bounded-document-extraction.md`.
- `migrations/003-consent-admission.sql` exists untracked — it is P1's drafted starting
  point, not applied yet; P1 may amend it freely before first apply.
- Working tree is otherwise clean. `next-env.d.ts` is byte-identical to HEAD (dev imports).

## 1. Hard constraints for every agent (non-negotiable)

1. **Local synthetic only.** No live AI calls, no external accounts/purchases/contracts,
   no deployment, no real data, no OCR/remote imports, no new npm dependency without
   recording why (current dependency set suffices for all packages).
2. **Never touch:** `src/worker/parser/`, `src/worker/txt-extract.c`,
   `scripts/build-extractor.ts`, `src/app/demo/`, `src/adapters/openai-compatible.ts`
   and `src/contracts/ai-provider.ts` (dormant adapter — must stay unreachable from
   client components), `.local/` contents, `next-env.d.ts` (leave byte-exact HEAD),
   `AGENTS.md`, other packages' files (§3 ownership).
3. **Migrations:** additive SQL only, applied only by `scripts/migrate.ts`. Use your
   package's preassigned number (§3). After a migration is applied once, its bytes are
   frozen — an editor appending a trailing newline breaks the hash gate ("Applied
   migration changed"); if that fires, restore byte-exact content, never relax the check.
4. **Module boundaries** (`scripts/check-boundaries.mjs`): contracts import no
   adapters/modules/platform/next/pg; modules never import app/worker/next; worker never
   imports app/next; app never imports `adapters/postgres`/`pg` directly; the OpenAI SDK
   and openai-compatible adapter must stay transitively unreachable from client code.
5. **Patterns to copy, not invent** (read these first): command idempotency via
   `commandSchema` + `lifecycle.replay/receipt`; owner-scoped authorization via
   `authorize` + `lifecycle.scopedRoot`; ancestor fences via
   `lifecycle.assertObjects`; content-free receipts; `privateHeaders` +
   `protectedResponse` for any bytes; per-story tests in `tests/unit` or
   `tests/integration` + browser cases in `tests/browser`; no skips/suppressions.
6. **Error codes:** reuse the six in `src/platform/errors.ts`
   (UNAUTHENTICATED / FORBIDDEN_OR_NOT_FOUND / INVALID_INPUT / CONFLICT / RATE_LIMITED /
   RETRYABLE_FAILURE). Do not edit `errors.ts` without integrator approval — the
   INVALID_INPUT message text is stale ("TXT only") and is reserved for the S11 sweep.
7. **Runtime:** every command under Node v24.22.0
   (`export PATH="$HOME/.nvm/versions/node/v24.22.0/bin:$PATH" NPM_CONFIG_USERCONFIG=/dev/null NEXT_TELEMETRY_DISABLED=1`).
   The login shell's nvm lazy-load shim is broken for non-interactive shells; set PATH directly.
8. **Check serialization:** only the integration workspace may run PG-dependent suites
   (`db:start` holds loopback:55432; one cluster only). Package branches may run
   `npm run typecheck`, `npm run lint`, `npm test` (unit) freely. Everything else —
   `migrate`, `test:integration`, `build`, `test:e2e`, `test:restart` — runs at
   integration (§5). Production builds additionally need the documented dance: move
   `.next/dev` aside, `npm exec next typegen`, build/checks, then restore dev cache and
   dev imports (`docs/ai-provider-adapter.md` end; AGENTS.md).
9. **Ticket lifecycle:** create your package's leaf ticket file
   `tickets/story-<slug>-plan.md` (copy the frontmatter/section shape of
   `tickets/story-bounded-four-format-extraction-and-explicit-preview-plan.md`,
   `ticket:` = your entry id, `status:` starts `'planned'`, becomes `'built'` only after
   your package passes the full gate at integration). Never advance anything past
   `built`; never claim F3/F5/F6 evidence you did not produce; never mark S6, S7
   closure or S12 done.
10. **Honesty rules:** manual work is labeled Manual; synthetic fixtures are labeled
    synthetic; no completion credit anywhere; no fabrication of provider eligibility,
    retention, backup or deployment claims. “Not verified/blocked” are valid recorded
    outcomes.

## 2. Blocked scope — record, never build

| Entry | Blocker | Action |
|---|---|---|
| S6 (live AI topic inference / plan drafting) | F3: no eligible processor/model/terms, no account/region/budget/operator authorization; standard Anthropic retention fails D5 | P1 delivers the fail-closed boundary it consumes. Record `unknown` in the S6 leaf ticket **only if** creating one; otherwise leave entry status untouched in `tickets/tickets.toml` |
| S7 closure (validated 3–5-item check on an eligible path) | Depends on S6's eligible structured generator; mocks do not satisfy acceptance | P7 builds infrastructure + skip path; its leaf ticket records `status: built` **with an explicit "closure pending S6 eligibility" note** — the take-path acceptance stays open |
| S12 (integrated suite + release) | F6: no provisioning/deployment/budget approval; "a blocked release cannot be recorded Done" | Nothing built. Epic closure therefore waits for F3+F6 regardless of local progress — state this in every summary |
| F1 completion | The announced Node security fix is still pending upstream | Covered by the user's 2026-10-21 explicit exception; recheck the runtime when the fix ships; do not claim F1 passed |

**Recorded deviations (user-delegated, flagged for the next human review):** S8/S9/S10/S13
proceed over the derivative types that exist (originals, extractions, plans/confirmations,
consent/decision records, dispatch admissions, diagnostic evidence if P7 has landed)
instead of waiting on blocked S6/S7 — their contracts explicitly anticipate ports that
later epics extend. S7 infrastructure is built without closure (above). `tickets.toml`
`after` edges are treated as review-time context, not runtime gates, for exactly these
entries; this is recorded in the epic memlog, not silently.

## 3. Work packages, ownership and interface pins

Naming/numbering is **preassigned** — claim nothing outside your ownership column.
All paths relative to repo root. "UI mount" = the single line your component needs in
`src/app/study-app.tsx`; deliver components in your own file and hand the exact mount
snippet to the integrator — **only the integrator edits `study-app.tsx` and
`src/app/api/v1/[...path]/route.ts`** (this is what makes parallel work safe).

### P1 — S3 Consent, policy admission, durable processing controls

- **Scope:** delivery-checks §S3 + UX U3. Versioned disclosure/configuration storage
  separate from owner consent; ineligible config stays blocked regardless of
  `allow=true`; decline/withdraw with no external effect; admission validates
  session/scope, ancestor fences, consent-to-current-disclosure and quota before any
  dispatch; dispatch admissions are content-free receipts; withdrawal serializes
  against dispatch (authorize() row-locks the principal); late-result rejection via a
  `settle` that re-checks fences/withdrawal and is idempotent; synthetic network-spy
  tests prove zero calls on every denied path and exactly one tracked accepted effect
  on the allowed synthetic path.
- **Owns:** migration `003-consent-admission.sql` (drafted: `app.processor_configuration`
  seeded ineligible, `app.processing_decision` PK(owner,command_key),
  `app.dispatch_admission` with outcome + `settled_at`); `src/contracts/consent.ts`;
  `src/modules/processing-consent/` (repository/service with `getDisclosure`, `decide`,
  `withdraw`, `admitDispatch(client,…)` called inside the caller's transaction,
  `settleDispatch`); routes `GET/POST /api/v1/processing*`; component
  `src/app/privacy-panel.tsx` (U3 states incl. prominent "synthetic test configuration"
  label when `synthetic_test`); tests `tests/integration/consent.test.ts` (incl. the
  beyond-criteria two-client withdrawal/dispatch race and quota/stale-version/fence
  blocks) + `tests/browser/consent.spec.ts`; leaf ticket `story-consent-and-fail-closed-processor-admission-plan.md`.
- **Interface pins for others:** current disclosure state exposed as
  `GET /processing` → `{ configuration: {version, provider, purpose, categories,
  retentionNotice, eligibility, syntheticTest}, decision: 'none'|'granted'|'declined'|'withdrawn' }`.
  Export inventory (P6) and delete preview (P8) read `app.processing_decision` +
  `app.dispatch_admission` **read-only** by these names.

### P2 — S4 Short goals, corrected topic, resumable preferences

- **Scope:** delivery-checks §S4 + UX U4 (and U1 draft-resume fields). Server-saved
  goal/topic/source-selection stage state with explicit save status and revision
  conflicts; exactly the four goal routes with only Other's short clarification;
  optional background/time preferences; validated changeable IANA timezone
  (`Intl.supportedValuesOf('timeZone')`); changing relevant inputs invalidates future
  confirmation of the changed draft without erasing history; session-expiry recovery;
  360px/keyboard. Manual topic labeled Manual — no fake inference.
- **Owns:** migration `004-setup-preferences.sql` (`app.setup_preference`:
  PK owner_id; stage, goal, topic, clarification, background, time_preference,
  timezone, revision); `src/contracts/preferences.ts`; `src/modules/setup-preferences/`;
  routes `GET/PUT /api/v1/preferences*` (PUT takes commandSchema-style idempotency);
  component `src/app/goal-stage.tsx`; tests `tests/integration/preferences.test.ts`
  (four routes, short Other, invalid zone, stale second-tab save, expiry recovery) +
  browser cases in own file; leaf ticket `story-short-goals-and-resumable-preferences-plan.md`.
- **Interface pins:** `GET /preferences` → `{stage, goal, topic, clarification,
  background, timePreference, timezone, revision}`. P5's confirm must consult
  `app.setup_preference.revision`: a goal/topic change after draft save must make
  confirm of the older draft CONFLICT (design: P5 reads P2's revision column by the
  pinned name; if P2 lands after P5 in integration, P5 codes against the pin).

### P3 — S5 Editable immutable plan + exact confirmation handoff

- **Scope:** delivery-checks §S5 + UX U5. Extend the existing manual plan editor with
  coverage/missing-explanation labeling (fields already exist — verify semantics), and
  deliver the **authorized exact-revision handoff**: a read-only query returning exact
  confirmed plan/source/goal/objective identities + provenance for epic 2, rejecting
  absent confirmation, unauthorized/deleted lineage and stale substitution; duplicate
  confirmation = one receipt (exists — add explicit regression); two-tab edit/confirm +
  source-deletion-between-admission-and-commit test; library "Plan ready for course
  generation" honesty (exists — verify). No generation job, no completion award.
- **Owns:** migration `005-plan-handoff.sql` only if a receipt/pin table is genuinely
  needed — prefer zero-DDL (handoff is a query over existing immutable tables; if you
  add a table, keep the pinned name `app.handoff_receipt`);
  `src/modules/materials-setup/handoff.ts` (+ minimal service.ts wiring — P3 is the
  **sole wave-1 owner of `src/modules/materials-setup/`**); route
  `GET /api/v1/studies/{id}/handoff`; U5 gaps in `src/app/plan-editor.tsx` (sole owner);
  tests `tests/integration/handoff.test.ts` (beyond-criteria races included) + browser
  case; leaf ticket `story-editable-immutable-plan-handoff-plan.md`.

### Wave-2 packages (start after wave 1 is integrated)

### P4 — S7 infrastructure (optional starting check, skip-first) — *closure stays open*

- **Scope:** delivery-checks §S7 infrastructure subset + UX U6. Offered equally with
  "Skip for now" from a confirmed plan; skip finishes setup without penalty; typed
  setup-diagnostic evidence with actor/scope/pinned confirmed-plan revision; per-item
  answer/rationale withheld until that item's submission; unanswered = Unknown;
  double-submit, unclear-item flag, partial paths distinct; **no completion/score/
  recovery semantics**. Items come from a **manually authored synthetic bundle pinned
  to the confirmed plan revision**, clearly labeled synthetic — NOT generator output;
  the ticket records that take-path acceptance on an eligible generator stays open
  until S6's blocker clears.
- **Owns:** migration `006-setup-diagnostic.sql` (`app.diagnostic_bundle`,
  `app.diagnostic_item`, `app.diagnostic_evidence` — **pinned names**; P6's export
  inventory and P8's delete preview enumerate these tables by name); 
  `src/contracts/diagnostic.ts`; `src/modules/setup-diagnostic/`; routes
  `/api/v1/studies/{id}/check*`; component `src/app/check-stage.tsx`; tests
  `tests/integration/diagnostic.test.ts` (must include the beyond-criteria check:
  inspect pre-submission API/payloads for answer leakage — assert none) + browser case;
  leaf ticket with explicit closure-pending note.

### P5 — S8 Authenticated consistent personal-setup export

- **Scope:** delivery-checks §S8 + UX U7. Category preview → consistent snapshot
  (single-transaction manifest of object IDs + storage keys + hashes across: originals,
  extraction revisions+metadata/warnings, plan revisions+confirmations,
  processing decisions, dispatch admissions, diagnostic evidence if P6 tables exist —
  enumerate by pinned names, skip-with-honest-label if absent); async
  queued/running/ready/failed/expired durable states; artifact = tar.gz in private
  storage registered as a lifecycle object whose `parent_ids` are the inventoried
  objects (so existing recursive fences/invalidation cover exports — verify with
  tests); expiry ≤24h enforced at download AND by sweep; download reauthorizes fresh
  session/owner/fences, `no-store`, never a public GET; duplicate command → one
  artifact; deletion/revocation during build denies and cancels.
- **Owns:** migration `007-setup-export.sql` (`app.export_request` PK(owner,command_key)
  + state/expiry/manifest hash/artifact object id); `src/contracts/export.ts`;
  `src/modules/setup-export/` (+ a `runExport` function wired in `src/worker/main.ts` —
  coordinate the one-line worker registration with the integrator); routes
  `POST/GET /api/v1/exports*` + `GET /api/v1/exports/{id}/download`; component
  `src/app/export-panel.tsx`; tests `tests/integration/export.test.ts` (beyond-criteria:
  manifest vs inventory from a second owner + deleted-root fixture; artifact-ID
  unreachability) + browser case; leaf ticket.

### P6 — S9 Root-scoped deletion + complete late-work suppression

- **Scope:** delivery-checks §S9 + UX U3/U8. Dependency preview by category with
  cancel-default; selected-root vs whole-personal delete (new command, own route);
  transitive A+B (exists — extend to exports/diagnostics); pre-return denial of
  reads/use/exports/handoffs/diagnostics via registered ports; withdrawal-offers-
  deletion link (P1's withdrawal state must surface the option); late recommit
  rejection for extraction/diagnostic/export/download; idempotent purge; seven-day
  active-copy deadline visibility (scheduler enforcement itself is P7's).
- **Owns:** `src/modules/lifecycle-platform/` exclusively (service/repository/
  operations); migration `008-lifecycle-completion.sql` only for genuinely new
  protective-state columns/tables (e.g. `app.deletion_request` for whole-personal +
  preview journal); extends `purgeRoot`/`purgeObjects` to new derivative tables
  (read-only imports of other modules' purge helpers follow the existing
  module-owned-port pattern — see `purgeMaterial` comment); route additions
  `POST /api/v1/studies/{id}/dependencies` (preview) + `POST /api/v1/personal/removal`;
  UI deltas in `src/app/danger-zone.tsx` (new component extracted from study-app's
  current inline section); tests `tests/integration/lifecycle.test.ts` (multi-client
  races: deletion vs dispatch/diagnostic-submit/export-ready/download) + browser cases;
  leaf ticket.

### Wave-3 packages

### P7 — S10 Bounded retention and archive contract

- **Scope:** delivery-checks §S10. Retention registry over explicit active-copy
  inventory: export artifacts 24h, deletion active-purge 7d deadline status/alert,
  content-free metadata/receipts 30d, synthetic ninety-day course-archive
  notice/export/purge fixture with synthetic course-controller records (no instructor
  enrollment pretend-integration); duplicate scheduler execution safe; failure/retry +
  receipt cleanup; **refuse unregistered derivative persistence** (a registry check
  other modules call when registering copies). Clock-controlled tests manipulate
  timestamps like existing tests, never the system clock.
- **Owns:** migration `009-retention-registry.sql` (`app.retention_registry`,
  `app.archive_contract` pinned names); `src/modules/lifecycle-platform/retention.ts`
  (P6 is done and merged by then — coordinate any same-file touches through the
  integrator); scheduler hook in `src/worker/main.ts` maintenance loop (one-line,
  via integrator); tests `tests/integration/retention.test.ts` (beyond-criteria:
  expired-copy inventory vs actual files/rows; no receipt resurrects data); leaf ticket.

### P8 — S13 Isolated backup and protective restore

- **Scope:** delivery-checks §S13. One local encrypted PostgreSQL + private-file
  snapshot (use `pg_dump` from the `.local/pg18` toolchain + `openssl` CLI encryption
  with a key file under `.local/` — **no new npm dependency**, no secret in repo/chat);
  independently stored content-free protective journal (append-only, records
  post-snapshot deletions/withdrawals/session revocations by pinned event shape);
  restore procedure: ordered auth/application/queue schema compatibility, restore,
  invalidate ALL sessions, replay journal (deletion/withdrawal/revocation reconcile)
  before any traffic/jobs/egress, fail closed if journal incomplete; types without
  live modules use explicit adapter fixtures; record timed procedure vs RPO24h/RTO8h
  honestly (local evidence cannot certify managed hosting).
- **Owns:** migration `010-protective-journal.sql` (`app.protective_journal` pinned);
  `src/adapters/protected-journal.ts` + journal-append hooks in the already-merged
  S3 withdrawal / S9 deletion paths (minimal, via integrator); `scripts/backup.ts`,
  `scripts/restore.ts` (npm scripts `backup`/`restore` added to package.json via
  integrator); tests `tests/integration/restore.test.ts` (restore into a scratch
  database created by the test; beyond-criteria: queued work present at snapshot,
  direct access/dispatch/reminder attempted pre-reconciliation must all deny);
  `docs/backup-restore.md` evidence (configuration, expiry proof, redacted timings,
  operator procedure); leaf ticket.

### Wave-4 (single agent, after everything else)

### P9 — S11 Refactor sweep + closure bookkeeping

- **Scope:** delivery-checks §S11. Enumerate deferred cleanup only (known items: stale
  INVALID_INPUT message in `errors.ts`; any duplication the wave integrations created).
  No behavior/schema/test-strength changes; run the full gate unchanged; explicit
  no-op if nothing is justified. Then closure bookkeeping: update
  `tickets/tickets.toml` comments, epic Notes with the recorded deviations (§2),
  `AGENTS.md` Current State, README Verification/Known-limits, `.memlog.md`, and a
  final summary that states plainly: **the epic is NOT closed** — S6, S7 closure and
  S12 remain blocked on F3/F6 authorization; everything locally implementable is
  built and gated.

## 4. Waves and parallelism at a glance

| Wave | Parallel packages | Why safe in parallel |
|---|---|---|
| 1 | P1 (S3) ∥ P2 (S4) ∥ P3 (S5) | Disjoint modules/migrations/routes; route.ts + study-app.tsx edited only by integrator; P3 sole owner of materials-setup |
| 2 | P4 (S7i) ∥ P5 (S8) then P6 (S9) | P4/P5 disjoint; P6 starts after P5's export registry exists (S9 fences exports) — or parallel against the pinned `app.export_request` name if the user prefers 3-way |
| 3 | P7 (S10) → P8 (S13) | S13 consumes S10's registry classes; sequential |
| 4 | P9 (S11 sweep + bookkeeping) | Touches everything; strictly last |

## 5. Integration protocol (one workspace, this repo)

1. Each package works on its own branch off `206a749` (recommend `git worktree add`
   per package so agents get separate directories; `.local/` is per-directory, so
   package worktrees must NOT run db-backed suites — §1.8 exists for this reason).
2. Integrator merges in wave order (P1→P2→P3, etc.). First merge of a wave that adds a
   migration runs `npm run db:start && npm run migrate` before anything else.
3. After each merge: `npm run typecheck && npm run lint && npm test`, then
   `npm run test:integration`. Before `npm run build`/`test:e2e`/`test:restart`:
   the typegen dance (§1.8) with restore afterward. Only after the full sequence is
   green does the merged package's ticket flip to `status: 'built'`, and a milestone
   commit is made.
4. UI mounts and route wiring: packages deliver exact snippets
   (`route.ts` branch + `study-app.tsx` mount); the integrator applies them during the
   merge and runs the package's browser cases.
5. Conflict rule: if two packages genuinely need the same line (unexpected), the
   integrator resolves and records it in both tickets' Plan Change Log.

## 6. Ready-to-paste agent prompts

For each package, the assigning prompt is:

> Work in `<worktree path>` on branch `<branch>`. You are package `<P#>` of
> `_bmad-output/initiative-ai-learning-platform/tickets/epic-private-study-setup/execution-plan-remaining-stories.md`.
> Read, in order: `AGENTS.md`, `project-overview.md`, that plan (§1 constraints, §2
> blocked scope, §3 your package), `delivery-checks.md` section `<S#>`, and the UX
> sections named in your package. Implement exactly your package's scope with its
> preassigned migration number, file paths and interface pins; create your leaf ticket;
> add the tests your package lists; run typecheck/lint/unit on your branch (no
> DB-backed suites — §1.8). Do not touch files outside your ownership column; deliver
> your route.ts/study-app.tsx mount snippets in your final report for the integrator.
> Local synthetic only; no live AI, deployment, real data, new dependencies, or
> claims about S6/S7-closure/S12.

## 7. Definition of "epic finished" for reporting

After P9: every locally implementable entry (3,4,5,7-infrastructure,8,9,10,13,11) is
`built` with gate evidence; S6/S7-closure/S12 are recorded blocked with their exact
unmet authorization (F3/F6); epic-level "Done when" #5 is explicitly unmet — the epic
cannot honestly close until an eligible processor and release authorization exist.
Any claim beyond that is a defect in the report.
