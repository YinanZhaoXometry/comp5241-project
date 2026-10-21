# AGENTS.md

## Project Purpose

GenAI-powered learning platform for COMP5241 (PolyU software engineering course project). Read `project-overview.md` at the workspace root before doing any work — it is the authoritative requirements source.

## Current State

Story 1 has a running, independently reviewed local synthetic TXT-to-Manual-confirmed-plan tracer. Review findings were fixed with regression coverage; final checks passed: unit4, PG15, browser10, real-process restart, audit0, lint and both typechecks. The active BMad initiative is `_bmad-output/initiative-ai-learning-platform/`; `private-study-setup` is refined with thirteen entries and five other epics remain unrefined. The latest user instruction on 2026-10-21 is **Replace the lint stack, preserve the required checks, and continue Story 1 locally with synthetic data only.** It supersedes the prior preset pause. Supported ESLint10/typescript-eslint/hooks plus native Oxlint replace the vulnerable Next preset;113 prior rule entries and negative probes preserve coverage. Real web/worker/auth/private storage/PG18 migrations and narrow root deletion exist; full later-epic AI/lifecycle work does not. Canonical plan baseline remains unchanged; ticket metadata has not been advanced. Read README and plan/preflight for exact results/limitations; local passes do not close F1's accepted runtime-security exception or authorize release.

## Local implementation commands

- Every terminal call must explicitly select `.local/runtime/node-v24.22.0-darwin-arm64/bin` on PATH, `NPM_CONFIG_USERCONFIG=/dev/null`, `NEXT_TELEMETRY_DISABLED=1`; exports have reset between calls. Never use default EOL Node23.
- `npm run checks`: audit, lint+coverage, module boundaries, both typechecks, unit, sandbox probe, isolated database+migrations, PG integration, build, Chromium and real-process restart. Individual commands are in package.json; README describes setup/provisioning and private credential handling.
- macOS arm64 TXT helper uses OS deny-all Seatbelt with fixed buffer/CPU/wall/output limits; RSS guard is not a kernel hard memory cap. No other parser/code-execution sandbox is admitted. Config rejects non-loopback DB/origin. Existing Homebrew default clusters must not be used; only `.local/pg18`.
- Sources: `src/app` thin UI/HTTP, `src/contracts`, module-owned `src/modules`, `src/adapters`, separate `src/worker`; one `scripts/migrate.ts` owns auth→app→queue schema. Runtime cannot migrate. `tests/unit`, `tests/integration`, `tests/browser`, restart smoke; no skips/overrides/suppressions.

## Core Requirements (from project-overview.md)

- **Mini-courses** with interactive content and activities covering: software engineering fundamentals, effective use of AI coding agents, and soft/product skills in software development.
- **Content/activity formats**: text and images, interactive simulations, role play / mock interviews, mini-games, AI-narrated animations and slides, online coding.
- **Personalization**: AI tailors content to learners from different backgrounds (accessible to non-CS majors; useful to CS graduates preparing for AI-era careers).
- **Instructor features**: customize existing mini-courses (manually or with AI); generate new mini-courses from topics/requirements; import students; track participation and engagement.
- **Open-domain generation**: users can generate mini-courses for other subjects; learners can generate their own topics and self-learning paths.

## Course Constraint

The final presentation must explain how Anthropic's **AI Fluency 4D framework** applies to this project: Delegation, Description, Discernment, Diligence. Keep this deliverable in mind when designing features and workflows.

## Conventions

- Shared technical rules are AD-1–AD-18 in the adopted architecture spine; preserve module write ownership, exact-version instructor approval, scoped authorization, immutable attempts/evidence and lifecycle/revocation fences.
- Architecture G1–G6 remain activation/feasibility gates. In particular, recheck the Node security release, compile/lint the actual lockfile and verify provider retention, restore safety and isolated-code execution before use. Standard API no-training terms do not establish seven-day deletion compliance.
- Current authorization permits story 1 of `private-study-setup` only: local implementation and necessary dependency installation using synthetic data. After the pending Node security-release risk was explained, the user explicitly said "i do not consider this blocker, continue" on 2026-10-21. This accepts that specific risk for local-only development with a checksum-verified supported Node release; do not keep stopping solely because the announced fix is pending, and do not claim it is fixed or F1 fully passed. Preserve all other compatibility, audit, privacy, transaction and test checks; recheck/update the runtime when the fix ships and before any broader use. The epic's `runtime-preflight.md` records the exception and evidence. The user also authorized a reviewed clean Git baseline commit. External accounts, costs/purchases/contracts, AI-provider calls, deployment, real-data processing and pilot execution remain forbidden. Bind development servers to loopback only. Do not infer build commands from the selected seed or report documentation checks as application tests.
