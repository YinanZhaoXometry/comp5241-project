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
