# AGENTS.md

## Project Purpose

GenAI-powered learning platform for COMP5241 (PolyU software engineering course project). Read `project-overview.md` at the workspace root before doing any work — it is the authoritative requirements source.

## Current State

Documentation/planning-only workspace. The active BMad initiative is `_bmad-output/initiative-ai-learning-platform/`; it has requirements, product policies, an adopted shared architecture under `architecture-shared-technical/` and six epics. `private-study-setup` is refined with thirteen planned entries plus UX/feasibility companions; five epics remain unrefined. No leaf is started or application code/build system installed. Git now exists; historical no-Git notes predate initialization. Architecture selects a TypeScript/Next.js modular monolith, separate worker and PostgreSQL as planning, not a runtime-verified stack. Read the initiative, adopted spine and relevant epic companions before downstream work. Add actual build/lint/test commands and source layout only once scaffolding exists.

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
- Current authorization is planning only: no application implementation, external accounts, purchases/contracts, deployment, real-data processing or pilot execution. Do not infer build commands from the selected seed or report documentation checks as application tests.
