# Contributing — developer guide

How to pick up work in this repository. This project is planned with the
[BMad Method](https://docs.bmad-method.org/): the method is installed under
`_bmad/` and all planning artifacts it generated live under
`_bmad-output/initiative-ai-learning-platform/`. Code changes follow that
planning chain — nothing is built outside an approved story plan.

## Read this first (in order)

1. [project-overview.md](project-overview.md) — authoritative course-project requirements.
2. [AGENTS.md](AGENTS.md) — hard operational constraints: allowed sandboxes, module
   boundaries, current authorization scope. Applies to human developers too.
3. `_bmad-output/initiative-ai-learning-platform/initiative-ai-learning-platform.md` —
   the requirements baseline (R1–R22) every story traces back to.
4. `…/architecture-shared-technical/architecture-shared-technical.md` — binding rules
   AD-1–AD-18 and activation gates G1–G6 (module write ownership, exact-version
   approval, lifecycle fences, …).
5. `…/tickets/epic-private-study-setup/delivery-checks.md` — story contracts S1–S13 and
   feasibility gates F1–F6 for the current epic.
6. [README.md](README.md) — exact setup commands and the recorded verification evidence.

## Environment setup

macOS arm64 only. Full detail in [README.md](README.md#local-prerequisites-and-operation);
the essentials:

```sh
nvm install 24.22.0        # first time only
nvm use                    # selects 24.22.0 from .nvmrc
cp .env.example .env       # first time only; then: source .env
npm ci --ignore-scripts --no-fund
npm run db:start && npm run migrate
npm run extractor:build && npm run provision
npm exec playwright install chromium
npm run build
```

- **Run `nvm use` (then `source .env`) in every terminal.** `.nvmrc` pins 24.22.0;
  this machine's nvm default is the EOL Node 23, and relying on the default is how
  the earlier Node23 accident happened.
- Never start the Homebrew default PostgreSQL cluster — only `.local/pg18` via
  `npm run db:start`. All listeners bind loopback only.
- Provisioned synthetic credentials go to an ignored private file. Open it locally;
  never paste credentials into chat, commits or issues.
- Run the app with `npm run start` and `npm run worker` in separate terminals, then
  open http://127.0.0.1:3000 (`npm run dev` for development mode; recorded browser
  tests use the production build).

## Development workflow

Work moves **one story per session**, in the order defined by the epic's
`tickets/tickets.toml` (thirteen entries, S1–S13; the top-level `tickets.toml` fixes
epic delivery order and dependencies):

1. **Pick the next entry** from
   `…/tickets/epic-private-study-setup/tickets/tickets.toml` and read its story
   contract in
   [delivery-checks.md](_bmad-output/initiative-ai-learning-platform/tickets/epic-private-study-setup/delivery-checks.md),
   its UX states in `setup-experience.md` and any referenced AD/G rules.
2. **Write/confirm a story plan** under the epic's `tickets/` directory (see the two
   existing `story-*.md` files for the format). Plans are **frozen after approval** —
   the frontmatter says so; changing scope requires explicit human renegotiation,
   and an oversized story requires explicit re-slicing, never silently dropped
   acceptance.
3. **Implement locally with synthetic data only.** Only original generated non-personal
   fixtures; no real documents, external accounts, AI-provider calls, deployment or
   real-data processing. Story-specific authorization limits (e.g. the dormant adapter
   in [docs/ai-provider-adapter.md](docs/ai-provider-adapter.md)) are binding.
4. **Run the full gate**: `npm run checks` (audit, lint+coverage, module boundaries,
   both typechecks, unit, extractor build, isolated DB+migrations, PG integration,
   production build, Chromium e2e, real-process restart). No skipped, weakened or
   suppressed tests. It hard-fails unless darwin + Node 24.22.0 is selected.
5. **Independent review** (per the story plan's `review` field) must complete before a
   story counts as done. Findings get reproduced, fixed and regression-tested before
   re-review. Record outcomes honestly — "not verified" and "blocked" are valid states.
6. **Advance ticket metadata** only after review; update README's verification record
   and the relevant evidence docs as part of the story.

Current state at the time of writing: S1 (TXT tracer) built and reviewed; S2
(four-format extraction) built with the full gate passing but **independent review
pending** — do not report it, F1 or release readiness as passed. See
[docs/bounded-document-extraction.md](docs/bounded-document-extraction.md).

## Code layout and boundaries

| Path | Owns |
| --- | --- |
| `src/app` | Thin UI/HTTP only (plus the isolated `/demo` prototype) |
| `src/contracts` | Domain contracts — may not import adapters/modules/platform/next/pg |
| `src/modules` | Shared web/worker services — never import app/worker/next |
| `src/adapters` | Postgres, queue, private storage, extractors, dormant AI adapter |
| `src/worker` | Worker process + `src/worker/parser/` (sandboxed parser image) — never imports app/next |
| `migrations/` | Ordered SQL; applied only by `scripts/migrate.ts` — runtime cannot migrate |
| `tests/unit`, `tests/integration`, `tests/browser`, `tests/fixtures` | Executable synthetic evidence |

These directions are machine-enforced by `scripts/check-boundaries.mjs` (including:
the OpenAI SDK must stay transitively unreachable from client components). The full
annotated map — including `scripts/`, `migrations/`, the BMad planning directories
and the ignored-but-load-bearing `.local/` — is in
[docs/project-structure.md](docs/project-structure.md); update it in the same change
that adds or moves a directory. Two
sandboxes are admitted — the Seatbelt TXT helper and the Docker/Colima parser
container — and the parser fails closed without fresh matching admission evidence;
read [docs/bounded-document-extraction.md](docs/bounded-document-extraction.md)
before touching parser, sandbox or batch code.

## React handler conventions (the course-stage pattern)

`src/app/course-stage.tsx` is the worked example for the handler shape this
codebase converged on after the epic-2 react-hooks compiler fights (purity and
ref rules rejected the earlier ref-based wait machinery). New client-component
handler code follows it:

- **Command-envelope caches live in state, not refs.** Per-item/per-depth
  `Map`s are held in `useState`, so handlers fired from the rendered view stay
  ref-free and impure-free — the compiler rules hold by construction, and a
  lost response replays the SAME command while a retry mints a fresh one.
- **Effect-owned polling with scalar deps.** The dispatch handler only
  dispatches; the pending WAIT (polling loop, the 120-second honest cap,
  settle focus) is owned by a `useEffect` whose dependency array is SCALARS
  (ids and booleans) — an object dep would reset the interval and its clock on
  every server read. Handler-owned interval polls that predate this rule (the
  generate/supplement waits) still use the `poll`/`supPoll` refs and are the
  accepted exception; do not add new ones.
- **DOM-id focus choreography.** The element that should receive focus next is
  recorded as STATE (`{ kind, id }`), and a `useEffect` resolves it through
  `document.getElementById` with a few-frame retry under load. Refs are never
  read during render, and focus is never stolen by polling.

## Shared dev-database fixture drift (`processor_configuration`)

The integration and browser suites seed their OWN synthetic processor
configurations with a `max(version)+1` insert (e.g. `consent.test.ts` /
`restore.test.ts`), so the shared `.local/pg18` dev database accumulates
hundreds of clearly-labeled fixture rows — on the machine that ran the epics,
versions far above the honest chain are fixtures and `max(version)` is a
fixture, never an honest row. The honest migration rows use FIXED ids
(`52410003-0000-4000-8000-0000000000NN`, one per version) and insert in two
styles: migration 003 seeds versions 1 and 2 with PLAIN inserts, so a squatted
version fails that migration loudly instead of silently shadowing; the
cumulative purpose-widening migrations (012/013/015/016/018, versions 3–7)
insert `ON CONFLICT (version) DO NOTHING`, so on a long-lived dev DB a fixture
that claimed one of those versions first silently shadows the honest row (this
machine: v3/v4/v6/v7 squatted, v5 repaired by un-recording and re-applying its
migration). A fresh database gets the honest cumulative chain either way.
Nothing needs repairing — discover the honest rows in one place with:

```sh
/opt/homebrew/opt/postgresql@18/bin/psql "host='$PWD/.local/pg-socket' port=55432 user=tracer_bootstrap dbname=tracer_synthetic" \
  -c "SELECT version,id,provider,eligibility FROM app.processor_configuration
      WHERE id::text LIKE '52410003-0000-4000-8000-%' ORDER BY version"
```

Optional, clearly-labeled cleanup wedge (run it manually from the repo root;
it deletes ONLY unreferenced synthetic fixture rows — never migration-UUID
rows, and fixtures still referenced by immutable decisions or dispatch
admissions stay because of their foreign keys):

```sh
/opt/homebrew/opt/postgresql@18/bin/psql "host='$PWD/.local/pg-socket' port=55432 user=tracer_bootstrap dbname=tracer_synthetic" \
  -c "DELETE FROM app.processor_configuration p
      WHERE p.id::text NOT LIKE '52410003-0000-4000-8000-%'
        AND NOT EXISTS (SELECT 1 FROM app.processing_decision d WHERE d.configuration_id=p.id)
        AND NOT EXISTS (SELECT 1 FROM app.dispatch_admission a WHERE a.configuration_id=p.id)"
```

The suites re-seed their fixtures on the next run, so this changes no suite's
behavior; the ordered-version contract is untouched (no renumbering, no
honest-row deletion).

## Gotchas

- **`next-env.d.ts`**: the user's development imports stay uncommitted. Before
  production checks run `next typegen` for matching production imports, then restore
  the development imports/cache afterwards. Never suppress the conflict.
- **Parser admission**: `.local/parser-admission-blocked-20261021.json` is quarantined
  and must never be restored; the worker stops without fresh matching admission.
- **Docker/Colima**: use the default local Unix socket only; never expose a daemon TCP
  port; only `extractor:build` may download the pinned image/wheel/scanner DB.
- **Reporting**: local gate passes are synthetic evidence, not deployment, provider or
  release approval — say exactly what was and wasn't verified.

## Working with AI agents

When a ZCode (or similar) agent works in this repo it reads [AGENTS.md](AGENTS.md);
keep that file current when constraints change. The BMad workflow is also installed
as agent skills (`bmad-build`, `bmad-review`, `bmad-agent-dev`, …), which drive the
same plan → build → review cycle described above.
