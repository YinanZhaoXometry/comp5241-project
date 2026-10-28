# Project structure

This is the canonical annotated map of the repository. **Keep it in the same
change that adds, renames or moves a directory** — a stale map is worse than
none. What deliberately does *not* live here: the binding rules and rationale
(AD-1–AD-18, gates G1–G6) are in the
[architecture spine](_bmad-output/initiative-ai-learning-platform/architecture-shared-technical/architecture-shared-technical.md);
setup commands and verification evidence are in [README.md](../README.md);
area-specific guides are alongside this file in [docs/](.).

## Overview

```
project-new/
├── src/                    application code — layered, boundaries enforced (see below)
│   ├── app/                thin UI/HTTP only; no direct postgres/pg imports
│   │   ├── api/v1/[...path]/route.ts   single HTTP entry; delegates to modules
│   │   ├── page.tsx · study-app.tsx · plan-editor.tsx · materials.tsx    private tracer UI
│   │   ├── privacy-panel.tsx · goal-stage.tsx · check-stage.tsx ·        S3/S4/S7 stage panels
│   │   │   export-panel.tsx · danger-zone.tsx                            S8/S9 panels
│   │   │   course-stage.tsx                                              epic-2 S1–S6 player shell: numbered
│   │   │                                                                 lesson sequence, sticky sidebar (<850px
│   │   │                                                                 top nav), content-item tracker with explicit
│   │   │                                                                 per-version mark-done + optional enrichment,
│   │   │                                                                 the S5 practice set — per-card recall
│   │   │                                                                 cards with attempt-before-answer, typed
│   │   │                                                                 feedback blocks (correctness, canonical
│   │   │                                                                 answer, rationale, source, evidence kind),
│   │   │                                                                 assisted-declaration toggle and fresh
│   │   │                                                                 retries — and the S6 why-explorer per
│   │   │                                                                 lesson: successive deeper levels (purpose,
│   │   │                                                                 assumptions/trade-offs) grounded in visible
│   │   │                                                                 sources, always-visible keyboard stop
│   │   │                                                                 control, honest exhaustion past the stored
│   │   │                                                                 evidence (zero dispatch) and no unlock
│   │   │   assessment-stage.tsx                                          epic-3 assessment panel: story-1
│   │   │                                                                 scored path (pre-start disclosure,
│   │   │                                                                 80% mark / 10000 points / scoring
│   │   │                                                                 criteria → single-choice items → one
│   │   │                                                                 submission → honest boundary verdict
│   │   │                                                                 with per-item reveal and attempt
│   │   │                                                                 history → derived roadmap line) plus
│   │   │                                                                 the story-2 recovery path on a failed
│   │   │                                                                 grade: focused review grouped per
│   │   │                                                                 objective ("Needs practice", cause
│   │   │                                                                 unnamed), the target ledger with
│   │   │                                                                 initial results, a fresh same-demand
│   │   │                                                                 retest flow and per-group recovery
│   │   │                                                                 credit beside the original verdict —
│   │   │                                                                 never merged, never averaged — plus
│   │   │                                                                 story 3's scoring surface: per-item
│   │   │                                                                 disclosed partial-credit rubrics with
│   │   │                                                                 per-choice credit hints (credit named,
│   │   │                                                                 never the answer), scale-rendered
│   │   │                                                                 point amounts, instructor pass-mark
│   │   │                                                                 override provenance when a snapshot
│   │   │                                                                 carries one, and a Provisional label
│   │   │                                                                 path that can award nothing — plus
│   │   │                                                                 story 4: the completion-awards line
│   │   │                                                                 (version-scoped, listed, never
│   │   │                                                                 overwritten) under the award-derived
│   │   │                                                                 roadmap line, and the study-version
│   │   │                                                                 switcher — changed-required-work
│   │   │                                                                 disclosure first, exact
│   │   │                                                                 acknowledgment to move, prior
│   │   │                                                                 awards never erased
│   │   ├── shell/          product + instructor page shells (sidebar/topnav, honesty label)
│   │   ├── screens/        static styled screen content (library, course, practice, …)
│   │   └── library·course·practice·progress·recovery·roadmap·review·why·       static product pages
│   │       starting-check·plan-ai·data·instructor/*                            (no business logic)
│   ├── contracts/          domain contracts; import no adapters/modules/platform/next/pg
│   │   ├── setup.ts        tracer setup/plan contracts
│   │   ├── documents.ts    bounded document/extraction contracts
│   │   ├── batches.ts      batch admission/selection contracts
│   │   ├── consent.ts · preferences.ts · diagnostic.ts · export.ts   S3/S4/S7/S8 contracts
│   │   ├── provenance.ts   epic-2 S7 versioned provenance + downstream
│   │   │                       handoff document contract (immutable-per-version
│   │   │                       block + monotonic derivatives block;
│   │   │                       attempt-independent by construction)
│   │   ├── assessment.ts   epic-3 scored-attempt + targeted-recovery +
│   │   │                       scoring-surface contracts: command schemas
│   │   │                       (ordinary and retest start/submit), the
│   │   │                       server-side snapshot schemas (answer key
│   │   │                       never in a pre-grade view), the none/offered/
│   │   │                       active/graded state union with the derived
│   │   │                       roadmap node, story 2's recovery views — the
│   │   │                       per-group target ledger, fresh-retest
│   │   │                       snapshots/views and the RecoveryState served
│   │   │                       beside (never merged into) the attempt
│   │   │                       result — and story 3's additions: per-item
│   │   │                       optional disclosed partial-credit rubrics
│   │   │                       (nonnegative scaled-integer credits, never
│   │   │                       keyed on the answer), the per-snapshot
│   │   │                       declared finite precision (pointsScale 1 or
│   │   │                       100, legacy rows defaulting to 1), the
│   │   │                       snapshotted { source, provenance, value }
│   │   │                       pass-mark override contract (source "default"
│   │   │                       in personal study — no instructor writer
│   │   │                       exists), and the provisional-grade decision
│   │   │                       type that structurally carries no pass and
│   │   │                       can never award completion — plus story 4's
│   │   │                       award/manifest/switch contracts: the
│   │   │                       version-scoped CompletionAwardView list +
│   │   │                       current-release award on the state, the
│   │   │                       parent-manifest schema (unique child
│   │   │                       releases, required/optional), and the strict
│   │   │                       switch command whose acknowledged change set
│   │   │                       must equal the server-computed diff exactly
│   │   ├── ai-provider.ts  provider-neutral text-completion port (dormant)
│   │   └── courses.ts      epic-2 S1–S6 generated-course + supplement +
│   │                         player + why contracts (content v4 = v3
│   │                         full-lesson set with per-lesson treatment
│   │                         framing and the code-derived adaptation record
│   │                         PLUS the practice set: one recall card per plan
│   │                         objective, answers/rationales withheld
│   │                         server-side and released only in per-card
│   │                         submission feedback with the learner-declared
│   │                         evidence kind; v3/v2/v1 legacy union wrap serves
│   │                         unchanged — the stored single recall becomes the
│   │                         one-card set view; mark-done command; verified
│   │                         supplement records; S6 why exploration — WHY_QUEUE
│   │                         jobs, per-(course, lesson, depth) explanation
│   │                         derivatives with fixed dimension sequencing and
│   │                         the honest exhaustion verdict as a serving state)
│   ├── modules/            shared web/worker services; never import app/worker/next
│   │   ├── identity-access/    auth, sessions, role fences, synthetic provisioning
│   │   ├── materials-setup/    uploads, extraction, batches, plans, handoff (queries/repository/service)
│   │   ├── processing-consent/ versioned disclosure, owner consent, dispatch admission (S3)
│   │   ├── setup-preferences/  resumable goal/topic/preferences with pinned revision (S4)
│   │   ├── setup-diagnostic/   synthetic check bundles, evidence, skip path (S7 infrastructure)
│   │   ├── setup-export/       consistent manifest snapshot + tar.gz artifacts (S8; the
│   │                       epic-2 S8 scope decision flips generated-course
│   │                       content, practice evidence and why explanations
│   │                       INTO the artifact as owner derivative content,
│   │                       keeps fetched supplement passages the one honest
│   │                       class skip — identity/location metadata only rides
│   │                       along inside each exported course)
│   │   ├── course-generation/  epic-2 S1–S6 tracer: confirmed-plan → generated
│   │   │                       course (handoff-consuming service, restart-safe worker
│   │   │                       running the local synthetic fixture behind
│   │   │                       TextCompletionPort, versioned course/objective/source
│   │   │                       lineage); S3 player shell serving — content v2
│   │   │                       full-lesson set, legacy v1 wrap, explicit
│   │   │                       per-version content-item mark-done (017 tracker table),
│   │   │                       content-free generated signal for library/plan copy;
│   │   │                       S2 supplements.ts — plan-gap derivation, strict proposal
│   │   │                       parsing, deterministic passage verification/conflict and
│   │   │                       the zero-egress fixture fetch port (see
│   │   │                       docs/bounded-source-fetch.md); S4 adaptation.ts —
│   │   │                       deterministic background classifier (beginner/
│   │   │                       advanced/neutral), per-track prompt instruction and
│   │   │                       fixture framing, cross-track fact-identity validator;
│   │   │                       S5 practice set + typed feedback — one recall card
│   │   │                       per plan objective with per-card source-bound
│   │   │                       withheld answers, submitPracticeCard (assisted flag,
│   │   │                       fresh retries, replay-idempotent feedback) and typed
│   │   │                       practice evidence rows (019 app.practice_attempt)
│   │   │                       cascading with the course lineage; S6 why.ts — pure
│   │   │                       evidence availability (sections + verified supplements,
│   │   │                       the structural exhaustion precondition), the bounded
│   │   │                       why prompt, the strict parser (restatement rejection,
│   │   │                       global-index citation resolution) and the synthetic
│   │   │                       why fixture, with one explanation derivative per
│   │   │                       (owner, course version, lesson, depth) in 020
│   │   │                       app.why_explanation cascading with the course
│   │   │                       lineage; S7 getProvenance — the read-only, owner-
│   │   │                       scoped, lineage-fenced provenance handoff document
│   │   │                       (pinned reads byte-stable across supersession)
│   │   ├── assessment-progress/  epic-3 assessment module: story 1's scored
│   │   │                       attempt tracer — one required objective-linked
│   │   │                       test from the manually checked synthetic bank,
│   │   │                       snapshotted at start (blueprint/questions/
│   │   │                       answer key/answer rules/rubric/point scale/
│   │   │                       80% default mark) into 021 app.test_attempt,
│   │   │                       submitted exactly once and graded by unrounded
│   │   │                       scaled-integer cross-product (79.96% does not
│   │   │                       pass 80%), attempts listed never overwritten —
│   │   │                       plus story 2's targeted recovery: a failed
│   │   │                       grade ledgers every failed objective group
│   │   │                       open in the same transaction (022
│   │   │                       app.recovery_target), startRetest/
│   │   │                       submitRetest run fresh same-demand retests
│   │   │                       from a manually checked fresh pool (022
│   │   │                       app.retest_attempt mirrors the root blueprint
│   │   │                       per group, positions renumbered, root pass
│   │   │                       mark/rubric pinned through the chain), a group
│   │   │                       clears only at the root mark by the same
│   │   │                       cross-product, and the roadmap node derives
│   │   │                       from earned awards (story 4) — original
│   │   │                       score never rewritten, credit shown separately
│   │   │                       — plus story 3's scoring surface, with NO
│   │   │                       stored-shape change (the snapshot jsonb
│   │   │                       carries the additions; no migration exists):
│   │   │                       declared-credit earning (full points, a
│   │   │                       disclosed rubric's exact scaled-integer
│   │   │                       credit, or zero), the hundredths-scale
│   │   │                       partial-credit fixture bank + builder beside
│   │   │                       the unchanged full-credit pools, the carried
│   │   │                       pass-mark override snapshotted at start
│   │   │                       (build-time contract; personal study stays
│   │   │                       default-80), scale-aware point display, and
│   │   │                       the provisional-grade fence — only a final
│   │   │                       graded pass or full recovery completes —
│   │   │                       plus story 4's monotonic completion-award
│   │   │                       layer (023 app.completion_award +
│   │   │                       app.studied_release): required items done +
│   │   │                       passed-or-fully-recovered awards a UNIQUE
│   │   │                       version-scoped mini-course award inserted
│   │   │                       once at each contributing verb's transaction
│   │   │                       (submitAttempt, submitRetest and epic-2's
│   │   │                       markItemDone through the exported
│   │   │                       recordCompletionIfEarned hook — never
│   │   │                       updated, revoked or re-derived), parent
│   │   │                       manifests award only when every required
│   │   │                       child release is awarded (optional never
│   │   │                       block; synthetic multi-child fixtures through
│   │   │                       the module's own writer), the roadmap node
│   │   │                       derives FROM award rows, and the explicit
│   │   │                       version switch (switchCourseVersion +
│   │   │                       disclosure GET) moves the studied-release
│   │   │                       pointer only after the changed required work
│   │   │                       is disclosed and exactly acknowledged —
│   │   │                       prior awards never erased
│   └── lifecycle-platform/ deletion fences, cleanup, lifecycle orchestration,
│   │                           derivative ports, dependencies preview (S9),
│   │                           retention registry/scheduler + archive contract (S10)
│   ├── adapters/           infrastructure; may not be reached from client components
│   │   ├── postgres/       pg client (app code must go through modules)
│   │   ├── queue.ts        pg-boss one-client enqueue
│   │   ├── private-files.ts private object storage + protected streaming
│   │   ├── txt-extractor.ts    Seatbelt TXT helper wrapper
│   │   ├── document-extractor.ts · document-sandbox.ts   four-format parser dispatch/admission
│   │   ├── protected-journal.ts  protective journal store/delivery/replay (S13)
│   │   ├── source-fetch.ts  AD-11 bounded public-source fetch adapter — allowlist/
│   │   │                       DNS/IP/redirect/size/credential guards, stdlib-only,
│   │   │                       fixture-driven with zero egress; live admission is
│   │   │                       gate F-B's (docs/bounded-source-fetch.md)
│   │   └── openai-compatible.ts  dormant Chat Completions adapter (see docs/ai-provider-adapter.md)
│   ├── platform/           config (loopback-only enforcement), errors, HTTP helpers,
│   │                       shared command-envelope helpers (commands.ts: requestHash/parse)
│   └── worker/             worker process; never imports app/next
│       ├── main.ts         queue consumer / extraction jobs
│       ├── txt-extract.c   macOS Seatbelt-confined TXT helper (sandbox 1 of 2)
│       └── parser/         Python parser image source: Dockerfile, parser.py,
│                             seccomp.json, disable_xmp.py (sandbox 2 of 2; Docker/Colima,
│                             fails closed without fresh admission — see
│                             docs/bounded-document-extraction.md)
├── docs/backup-restore.md  S13 encrypted local snapshot + protective restore procedure
├── docs/bounded-source-fetch.md  epic-2 S2 bounded fetch boundary + fixture mode
│                                  (F-B owns live admission)
├── migrations/             ordered SQL, applied only by scripts/migrate.ts at dev time;
│   │                       runtime cannot migrate; additive changes must preserve v1 data
├── scripts/                dev-time tooling, run via package.json scripts
│   ├── checks.mjs          orchestrates the full local gate (npm run checks)
│   ├── backup.ts · restore.ts   encrypted local snapshot + protective restore (S13)
│   ├── check-boundaries.mjs   machine-enforced import-direction rules
│   ├── check-lint-coverage.mjs · lint-policy.mjs · lint-baseline.mjs   lint stack coverage
│   ├── migrate.ts · local-db.ts          schema runner; .local/pg18 cluster start/stop
│   ├── build-extractor.ts                parser image build/audit/admission (extractor:build)
│   ├── provision-synthetic.ts            synthetic role credentials (provision)
│   └── restart-smoke.ts                  real web/worker restart evidence (test:restart)
├── tests/
│   ├── unit/               contracts, documents, adapter transport (vitest)
│   ├── integration/        real PostgreSQL: tracer, batches, documents, migrations,
│   │                       parser stack, consent, preferences, handoff, diagnostic,
│   │                       export, lifecycle, retention, restore, course-generation
│   │                       (incl. the epic-2 S8 integration set: mid-flight
│   │                       deletion races, consent-denial/ineligibility,
│   │                       four-family idempotency, the 120-second honesty
│   │                       set and post-deletion read denials), provenance
│   │                       (the epic-2 S7 synthetic consumer), assessment
│   │                       (the epic-3 scored-attempt tracer, its story-2
│   │                       targeted-recovery chain: ledger at grade time,
│   │                       fresh same-demand retests, partial clearing,
│   │                       supersession pinning, retake re-ledgering,
│   │                       denial sweep and original-row immutability, and
│   │                       story 3's scoring surface: the partial-credit
│   │                       fixture graded exactly at its declared hundredths
│   │                       scale through the real verbs, the carried
│   │                       instructor override pinned mid-attempt while the
│   │                       next attempt snapshots the current policy, and
│   │                       the final-grade label on every graded view)
│   ├── browser/            Playwright: tracer, pages (static product pages), batches,
│   │                       consent, preferences, handoff, check, export, lifecycle,
│   │                       course, journey (epic-2 S10 integrated study suite),
│   │                       attempt (epic-3 boundary honesty + roadmap line, the
│   │                       recovery journey: focused review, retest flow,
│   │                       side-by-side credit honesty and second-account
│   │                       denial, and the story-3 partial-credit journey:
│   │                       rubric disclosed pre-answer, per-choice credit
│   │                       hints, exact declared credit earned at the
│   │                       hundredths scale, honest 79.99% boundary) —
│   │                       production build
│   └── fixtures/           original synthetic documents only
├── docs/                   guides: ai-provider-adapter, bounded-document-extraction,
│                           bounded-source-fetch, backup-restore, lint-coverage,
│                           project-structure (this file)
├── _bmad/                  the installed BMad Method tooling itself — do not edit casually
├── _bmad-output/           BMad-generated planning artifacts for this initiative (below)
├── .local/                 ignored local runtime state (below)
└── test-results/           ignored Playwright output
```

## `_bmad/` vs `_bmad-output/`

`_bmad/` is the BMad Method installation (method scripts, render, toolsmith) —
tooling, not project content. `_bmad-output/initiative-ai-learning-platform/` holds
this project's planning chain and is the source of truth for *what to build next*:

- `initiative-ai-learning-platform.md` — requirements baseline R1–R22.
- `brief-adaptive-learning/` — approved product brief (+ addendum).
- `product-policies.md` — delegated policy defaults D1–D8.
- `architecture-shared-technical/` — AD/G rules, source checks, and `reviews/`.
- `tickets/tickets.toml` — the six epics in delivery order with dependencies;
  one subdirectory per epic.
- `tickets/epic-private-study-setup/` — the refined first epic: `epic-*.md`,
  `delivery-checks.md` (story contracts S1–S13, gates F1–F6), `setup-experience.md`
  (UX states U0–U8), `runtime-preflight.md` (recorded exceptions/evidence), and
  `tickets/` with the ordered story list and approved `story-*.md` plans
  (frozen after approval).
- `plan-screenshot-study-prototype.md`, `plan-openai-compatible-adapter-foundation.md`
  — separately approved narrow plans beyond the story chain.
- `.memlog.md` files — BMad working memory logs; history, not instructions.

## `.local/` (git-ignored, but load-bearing)

Everything the repo deliberately keeps out of version control lives here: the
isolated PG18 cluster (`pg18/`, `pg-socket/`), Playwright browsers, private object
storage (`private-objects/`), synthetic credentials (`synthetic-credentials.json` —
never paste anywhere), DB/runtime config, the compiled TXT helper (`bin/`), the
parser admission/audit evidence (`parser-admission.json`, `parser-audit.json`, and
the quarantined `parser-admission-blocked-20261021.json` which must never be
restored), starter templates and local screenshot artifacts. Node itself is *not*
here — it is nvm-managed (see `.nvmrc`). Losing `.local/` means re-running the
README setup from scratch.

## Root configuration files

- `.nvmrc` — pins Node 24.22.0 (`nvm use`); must stay in sync with `engines`.
- `.env.example` — documented environment variables; copy to the git-ignored
  `.env` and `source .env` per terminal.
- `package.json` — scripts are the only supported entry points (`npm run …`);
  engines pin Node 24.22.0 / npm 11.19.1.
- `eslint.config.mjs` + `oxlint.config.mjs` — the dual lint stack; rule coverage
  is verified by `check-lint-coverage.mjs` (see [lint-coverage.md](lint-coverage.md)).
- `tsconfig.json` / `tsconfig.worker.json` — web and worker typecheck separately
  (`typecheck`, `typecheck:worker`).
- `next.config.ts` — loopback binding, security headers, the narrow CSS-Module
  loader exception for `*.module.css` (path-agnostic; applies to all module CSS).
- `next-env.d.ts` — generated; the user's development imports stay uncommitted
  (see Gotchas in [CONTRIBUTING.md](../CONTRIBUTING.md)).
- `playwright.config.ts` / `vitest.config.ts` — browser and unit/integration test setup.
