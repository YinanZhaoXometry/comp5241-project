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
│   │   └── demo/           isolated unauthenticated screenshot prototype ("No live AI")
│   │       └── screens/    revised-spine sample screens (product/instructor/states views)
│   ├── contracts/          domain contracts; import no adapters/modules/platform/next/pg
│   │   ├── setup.ts        tracer setup/plan contracts
│   │   ├── documents.ts    bounded document/extraction contracts
│   │   ├── batches.ts      batch admission/selection contracts
│   │   ├── consent.ts · preferences.ts · diagnostic.ts · export.ts   S3/S4/S7/S8 contracts
│   │   └── ai-provider.ts  provider-neutral text-completion port (dormant)
│   ├── modules/            shared web/worker services; never import app/worker/next
│   │   ├── identity-access/    auth, sessions, role fences, synthetic provisioning
│   │   ├── materials-setup/    uploads, extraction, batches, plans, handoff (queries/repository/service)
│   │   ├── processing-consent/ versioned disclosure, owner consent, dispatch admission (S3)
│   │   ├── setup-preferences/  resumable goal/topic/preferences with pinned revision (S4)
│   │   ├── setup-diagnostic/   synthetic check bundles, evidence, skip path (S7 infrastructure)
│   │   ├── setup-export/       consistent manifest snapshot + tar.gz artifacts (S8)
│   │   └── lifecycle-platform/ deletion fences, cleanup, lifecycle orchestration,
│   │                           derivative ports, dependencies preview (S9),
│   │                           retention registry/scheduler + archive contract (S10)
│   ├── adapters/           infrastructure; may not be reached from client components
│   │   ├── postgres/       pg client (app code must go through modules)
│   │   ├── queue.ts        pg-boss one-client enqueue
│   │   ├── private-files.ts private object storage + protected streaming
│   │   ├── txt-extractor.ts    Seatbelt TXT helper wrapper
│   │   ├── document-extractor.ts · document-sandbox.ts   four-format parser dispatch/admission
│   │   ├── protected-journal.ts  protective journal store/delivery/replay (S13)
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
│   │                       export, lifecycle, retention, restore
│   ├── browser/            Playwright: tracer, demo, batches, consent, preferences,
│   │                       handoff, check, export, lifecycle — production build
│   └── fixtures/           original synthetic documents only
├── docs/                   guides: ai-provider-adapter, bounded-document-extraction,
│                           backup-restore, lint-coverage, project-structure (this file)
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
  loader exception for `src/app/demo`.
- `next-env.d.ts` — generated; the user's development imports stay uncommitted
  (see Gotchas in [CONTRIBUTING.md](../CONTRIBUTING.md)).
- `playwright.config.ts` / `vitest.config.ts` — browser and unit/integration test setup.
