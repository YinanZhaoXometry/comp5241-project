---
title: AI Learning Platform PRD — Addendum
status: draft
created: 2026-10-21
updated: 2026-10-21
---

# PRD Addendum — AI Learning Platform

User-contributed and research depth that belongs in downstream documents (architecture, UX specs, positioning) or earns a place beside the PRD without belonging in it. Canonical sources remain the initiative companions; this addendum is a citable digest, not a second source of truth. The run's decision log is [`.memlog.md`](.memlog.md) in this folder.

## A. Landscape and Positioning (2026-10-21 research digest)

*Context for §1/§8.4 of the PRD. Per initiative C5, this establishes no unique-feature advantage and is not a requirements source.*

**Comparables (2025–2026):**

| Product | What it is / positioning |
|---|---|
| Khanmigo (Khan Academy) | Socratic tutor + teacher assistant; free US teachers (Microsoft-sponsored), ~$4/mo learners; 180+ countries (Khan Academy blog, 2025-12). |
| Coursera Coach | In-course GenAI Q&A/summaries/practice; 1M+ learners, ~9.5% higher quiz pass-rate correlation (Coursera blog/IR, 2024–2025). |
| Quizlet Q-Chat | "First fully-adaptive AI tutor" (2023) — **discontinued June 2025** (Quizlet notice). Signal: consumer AI tutors don't retain by default. |
| NotebookLM (Google) | Upload-your-own-sources grounded assistant; 2025 student features (flashcards/quizzes/practice), FERPA/COPPA compliance stance. Generates study aids, not approved publishable courses. |
| Sana Labs | Enterprise AI-native LMS/LXP consolidation play. |
| Mindstone | AI upskilling; pivoted to workforce AI-skills certification (Pearson/EBSCOlearning, 2024–25). |
| Synthesis Tutor | Adaptive elementary-math tutor; praised for math-anxious learners; narrow scope, ~$45/mo (Unite.AI, 2025-10). |
| Duolingo Max | AI roleplay ("Video Call") + "Explain My Answer"; 2025 "AI-first" memo → backlash + partial walk-back. |
| Coursebox / Mini Course Generator | Document/prompt → full course with quizzes; self-serve authoring, **no governed instructor-approval/versioning workflow**. |

**The gap this platform occupies:** no comparable combines (a) upload-own-material → mini-course generation **with instructor exact-version approval**, (b) structured **targeted-retest recovery** after failed questions, (c) **spaced review coupled to course completion**, and (d) **instructor enrollment + participation tracking over AI-generated open-domain content**. Pieces exist separately everywhere; the combination is the product thesis.

**Timing enablers:** RCT-level tutoring evidence (Harvard physics RCT — Kestin et al., Scientific Reports 2025: ~2× learning gains vs in-class active learning); mature grounded generation over uploaded sources; falling inference costs.

**Landscape risks the PRD already guards against:** student-facing hallucination (→ FR-5/FR-6); engagement ≠ learning and trust backlash (→ SM-C1, C6); academic-integrity/offloading concerns (→ formative-only scope, active recall FR-12).

**Unverified/low-authority claims excluded from the PRD:** Duolingo "$1B revenue" figures, NotebookLM "Gemini Notebook" rebrand (Reddit-derived, 2026-07). Do not cite without verification.

Main sources: nature.com (Kestin 2025), blog.google, blog.khanacademy.org, quizlet.com/blog, sanalabs.com, coursebox.ai, minicoursegenerator.com, cdt.org, apa.org, turnitin.com, home.dartmouth.edu (full list in the run memlog/PRD §8.4).

## B. Architecture Digest (for downstream readers of this PRD)

*Canonical: [architecture-shared-technical.md](../architecture-shared-technical/architecture-shared-technical.md). Planning-level only — "binding for downstream planning until explicitly revised, not implemented or individually user-selected"; authorizes nothing.*

- **Shape:** modular monolith with ports and adapters; one TypeScript codebase; Next.js web process + separate background worker; PostgreSQL authoritative state. No microservices/Redis/vector DB/event sourcing in the initial seed.
- **Planning pins (not a tested lockfile):** Node 24.22.0 (pending security release = blocking recheck), Next.js 16.4.2, React 19.3.1, TypeScript 6.0.3, Better Auth 1.7.12 (DB-backed opaque cookie sessions), PostgreSQL 18.6, pg 8.23.1, pg-boss 12.38.0, Zod 4.6.7.
- **Unprovisioned target topology:** managed Node web+worker, managed PostgreSQL, private S3, isolated runner pool.

**AD-1–AD-18 one-liners** (asterisk = constrains product behavior, echoed in PRD §9):

- **AD-1** Module boundaries and dependency direction.
- **AD-2** Atomic commands; PostgreSQL owns truth.
- **AD-3\*** Identity ≠ authorization (per-operation scope checks, revocation epochs).
- **AD-4\*** Ownership/lineage/deletion fences (7-day purge, 24-hour export expiry, 90-day archive purge, 30-day backup expiry).
- **AD-5\*** Immutable publication and dependency identity (enrollment pinned to a release until explicit informed switch).
- **AD-6\*** Exact-version instructor gate including dynamic output (no streaming bypass; provisional AI grades).
- **AD-7\*** Shared evidence without diagnostic cycles (immutable typed evidence; skippable diagnostic; Unknown ≠ Needs practice).
- **AD-8\*** Scoring, targeted credit and monotonic completion (snapshot at attempt start; 80% via exact integer arithmetic).
- **AD-9\*** Durable idempotent jobs (120-second honest-pending rule).
- **AD-10\*** Policy-enforced provider boundary (consent/retention evidence; private external processing default off; standard Anthropic retention fails D5).
- **AD-11\*** Extraction and retrieval are untrusted (sandboxed, bounded, preview, SSRF defenses).
- **AD-12\*** Activity schemas, narration and code isolation (six families; accessibility equivalents; narration offline by default; runners isolated — "a disabled placeholder does not satisfy R17").
- **AD-13\*** One review clock, bounded reminders (IANA timezone/DST semantics).
- **AD-14\*** Reporting is a scoped read model.
- **AD-15** One Zod-validated `/api/v1` contract at every entry point.
- **AD-16** Environments and deployment topology.
- **AD-17** Migrations and recovery (RPO 24h / RTO 8h targets, unmeasured).
- **AD-18\*** Verification and resource admission (G1–G6 executable; no efficacy/compliance/PMF claims).

**Open feasibility gates G1–G6:** G1 runtime/lockfile recheck (Node security release; managed PostgreSQL 18 and queue transaction-rollback verification); G2 real-data processors (model snapshot, no-training/deletion terms — blocks real data); G3 extraction/source support (parser pins, DOCX-bomb/SSRF fixtures); G4 narration + isolated runner proof; G5 operations/deletion (retention inventory, purge races, restore replay); G6 quality/pilot capacity (measured cost/load/latency, fixture rights, accessibility).

## C. Policy Pointer (D1–D8)

Operative rules live in [product-policies.md](../product-policies.md) — D1 structure/completion, D2 setup/personalization/evidence, D3 assessment/recovery, D4 sources/approval, D5 materials/access/lifecycle, D6 review/reminders/reporting, D7 delivery order/quality gates, D8 one-participant pilot. The PRD quotes only the numbers it needs; D-documents govern on conflict.

## D. Delivery Mapping (epics → FRs)

| # | Epic | FRs owned | After |
|---|---|---|---|
| 1 | private-study-setup | FR-2, FR-7, FR-21, FR-22 | — |
| 2 | grounded-mini-courses | FR-1, FR-6, FR-8, FR-11, FR-12 | 1 |
| 3 | assessment-and-progress | FR-10, FR-13, FR-14, FR-20 | 1, 2 |
| 4 | spaced-review | FR-15 | 1, 3 |
| 5 | instructor-courses | FR-3, FR-4, FR-5, FR-16 | 1–4 |
| 6 | subject-and-activity-breadth | FR-9, FR-17, FR-18, FR-19 | 2, 3, 5 |

All 22 FRs covered exactly once (FR-N ↔ R-N). Epic 1 is story-refined (thirteen entries + UX contract + delivery checks); epics 2–6 await refinement (PRD §10, item 5).

## E. UX State Groups (epic-1 UX contract)

[setup-experience.md](../tickets/epic-private-study-setup/setup-experience.md) defines named state groups **U0–U8** (access boundary; library/resumable setup; materials/extraction/preview; processing disclosure/controls; topic+goal; plan preview/edit/confirm; optional starting check; owner export; deletion/retention receipt). No UJ-* IDs pre-exist; the PRD's UJ-1…UJ-5 are new and this PRD is their home. Downstream UX work should carry U0–U8 forward and cross-map to UJ-1–UJ-5. Every visible setup branch is bound to acceptance/feasibility checks S1–S13 in [delivery-checks.md](../tickets/epic-private-study-setup/delivery-checks.md).

## F. Pilot Protocol Summary (D8)

Personal-upload journey on unit-testing fundamentals (unit vs integration tests; Arrange–Act–Assert on a small pure function); rights-verified bounded text fixture (license check precedes execution); three fresh unaided baseline items → one mini-course + required test → natural recovery (scripted labeled case if no natural failure) → seven-day delayed fresh-item check before viewing review; reference rubric independent of the generating model; descriptive reporting only. TCP three-way-handshake example is illustrative of the deeper-why feature, not the pilot.

## G. Parked Brief Proposals (not adopted, not dropped)

- **Plan rationale in the confirmed-plan preview** — the brief's discovery addendum proposed showing *why the proposed route fits the stated goal*; neither R21 nor delegated D2 adopts it explicitly. Parked as a `[NOTE FOR PM]` on FR-21; decide during UX refinement of the plan-preview screen.
- **"Best course" → testable criteria** — the brief proposed defining course quality through testable criteria; only the negative half (no efficacy/"best course" guarantees) is settled policy. Parked for content-quality refinement in epic 2.
