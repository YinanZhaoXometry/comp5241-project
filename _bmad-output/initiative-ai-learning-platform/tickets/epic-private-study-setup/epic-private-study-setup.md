---
type: epic
title: Learners privately turn materials into a study plan
parent: initiative-ai-learning-platform
covers: [R2, R7, R21, R22]
sources:
  [
    _bmad-output/initiative-ai-learning-platform/initiative-ai-learning-platform.md,
  ]
companions:
  [
    _bmad-output/initiative-ai-learning-platform/product-policies.md,
    _bmad-output/initiative-ai-learning-platform/architecture-shared-technical/architecture-shared-technical.md,
    _bmad-output/initiative-ai-learning-platform/tickets/epic-private-study-setup/setup-experience.md,
    _bmad-output/initiative-ai-learning-platform/tickets/epic-private-study-setup/delivery-checks.md,
  ]
after: []
refined: true
status: in-progress
risk: high
---

# Learners privately turn materials into a study plan

## Description

Deliver the first usable web path: authenticate, upload private learning material, preview extraction, select a short goal, confirm/edit the plan and take or skip a diagnostic. Include owner export/deletion, processing consent and platform setup from the start. This is useful study preparation, not a placeholder lesson or a claim that a course has been completed.

## Outcome

A learner has a persistent, confirmable plan grounded in their own privately held material and can control its data lifecycle; other accounts cannot access it.

## Requirements

These local IDs refine the four owned parent capabilities; they do not replace initiative IDs. Detail is in the UX and story-contract companions. `refined: true` means specified for planning, not executed or authorized to start.

- **R1 — Private materials** (parent R2): personal uploads and their derivatives are visible only to the uploading learner. Verify owner access and denied direct/list/download/job-result access from another learner, instructor and ordinary admin; preserve denial after session revocation and deletion.
- **R2 — Short goal setup** (parent R7): offer Exam preparation, Understand a topic, Apply a skill and Other, with only critical conditional follow-ups and no required purpose essay or universal exam date. Verify each route, short Other input, back/edit and saved-work recovery.
- **R3 — Confirmable plan and optional diagnostic** (parent R21): learners confirm/correct inferred topic and goal, edit and confirm a personal plan before full generation, and take or skip a 3–5-item starting check. Verify exact plan/source revision handoff, stale-edit conflict and both diagnostic branches without completion exemptions; instructor outcomes are not editable here.
- **R4 — Processing and lifecycle controls** (parent R22): disclose/obtain external-processing opt-in, minimize processor data and allow authenticated owner export/deletion of personal materials and all derivatives. Verify declined/withdrawn consent denial, immediate access/use/reminder revocation, seven-day active purge, thirty-day backup expiry with protective restore suppression, and the ninety-day archived-course notice/export/purge contract. Actual processor/institution compatibility is a release gate, not a planning claim.

## Constraints

- Parent C1–C7, D1–D8 and shared AD-1–AD-18 remain binding. Input limits are 20 MiB/file and ten files per generation; support text-based PDF, DOCX, TXT and Markdown with extraction preview, not OCR/general archives/remote-URL import.
- Start with synthetic accounts/material and a real local/manual tracer; manual work is labeled Manual, never passed off as AI. Actual AI inference/planning and a working optional diagnostic remain required later stories. No course-completion, scoring/recovery, published instructor route or review delivery is introduced by setup.
- UX states, acceptance criteria and feasibility evidence are specified below/by companions, not verified now. No application implementation, live processors, external accounts/contracts, deployment, real-data processing or pilot execution is authorized. No assignee, estimate or delivery date is invented.

## Done when

1. The authenticated upload → extraction preview → short goal → editable plan tracer works end to end, including corrected topics, critical conditional questions and a genuinely skippable 3–5-item check without a completion waiver.
2. Owner and cross-owner/instructor denial checks hold for material and all derivatives; consent refusal sends nothing externally. Unsupported, unreadable and oversized inputs fail honestly with saved input under D5/D7.
3. Export/deletion, immediate access/use revocation, active-copy purge and backup-restore suppression meet D5 using testable evidence. Provide the general course-archive lifecycle contract and fixture checks now; epic 5 verifies it against its actual instructor records before that route is available.
4. Platform scaffold, automated checks and deployment setup are included in the first stories; once separately authorized and G1 guarantees are verified, deliver this slice to the selected production environment and run integrated permitted/denied journeys there. No deployment occurs merely because this epic exists.
5. All thirteen story contracts and their relevant feasibility gates have actual passing evidence; the synthetic/manual tracer alone cannot close the epic. Relevant UX states work by keyboard at 360px and desktop, processing has an honest outcome by 120 seconds, and no unresolved critical/high security or material setup/data-lifecycle defect remains. G4 coding/narration is later breadth work, not falsely marked verified here.

## Boundaries

- Owns authenticated identity/roles foundation, safe material extraction, confirmed personal plan, processing consent and personal/derived-data export/deletion contracts.
- Hands material/plan/source locations and consent/lifecycle controls to epic 2; evidence ownership/deletion to epic 3; user/timezone/deletion settings to epic 4; course-role/archive primitives to epic 5. Later epics extend derivative coverage rather than create independent deletion rules.
- Full generated lessons, why exploration and active recall belong to epic 2; scored tests/recovery/roadmap completion to epic 3; reminders to epic 4; instructor authoring/enrollment to epic 5.
- No public upload sharing, self-granted instructor role, ordinary admin content browsing, real-data provider processing before guarantees, or hard prerequisite locks.

## References

- parent — [initiative requirements](../../initiative-ai-learning-platform.md), R2/R7/R21/R22; Constraints C1–C7, Boundaries and G1/G2.
- policy companion — [product policies](../../product-policies.md), D1/D2/D5/D7; D3 evidence separation for the diagnostic.
- architecture companion — [shared technical architecture](../../architecture-shared-technical/architecture-shared-technical.md), all AD-1–AD-18; especially AD-1–AD-4, AD-7, AD-9–AD-11 and AD-15–AD-18 for platform, confirmed plan and lifecycle. Shared IDs bind downstream; G1–G6 are not claimed passed.
- delivery breakdown — [ordered epic contracts](../tickets.toml), epic 1 and consumer dependencies.
- UX companion (SPEC-authored) — [setup experience](setup-experience.md), screens U0–U8, shared failure/accessibility behavior and transition rules; assistant-selected under delegation, not individually user-selected visual design.
- story companion (SPEC-authored) — [story contracts and feasibility](delivery-checks.md), S1–S13 acceptance checks, F1–F6 evidence gates and handoffs; every entry references its nearest section. IDs are stable, not sort order: S13 restore follows S10 retention and precedes S11/S12.
- story breakdown — [ordered implementable entries](tickets/tickets.toml); local R1–R4 coverage, dependencies, human steps and start-blocking unknowns. No leaf has been pulled or started.

## Notes

- Decision: 2026-10-21 — selected under continuing delegated planning authority; first epic includes platform setup, not a standalone horizontal scaffold epic.
- Decision: 2026-10-21 — initial tracer is one authenticated private upload to a persistent confirmed plan, with its denied-owner path; tests belong in every story.
- Decision: 2026-10-21 — adopt the reviewed shared architecture under delegated planning authority; no requirements, whole-epic gates or build authorization change.
- Decision: 2026-10-21 — the user requested implementable stories, including UX states and feasibility checks. Refine this epic under continuing delegation; the other five remain unrefined. Adopt the two SPEC-authored companions without changing parent ownership or whole-epic gates.
- Decision: 2026-10-21 — tracer bullet is story 1: sign in with real database sessions, upload one synthetic TXT, receive worker-extracted preview, choose a goal/topic, save/confirm a learner-authored one-mini-course plan, reopen it and remove its root with owner denial checks. It includes the initial starter/CI/runtime check; it is neither a fake AI demonstration nor full epic acceptance.
- Decision: 2026-10-21 — use twelve entries in one ordered lane because each expands shared setup/revision/lifecycle contracts and fixtures consumed by the next. Put extraction abuse checks next, then consent, goals, plan versioning, actual AI planning, optional diagnostic, export, complete deletion, retention/restore, Refactor sweep and closing end-to-end/release verification. The sweep cannot absorb unfinished functionality.
- Assumption: controlled operator-provisioned learner accounts are sufficient for the initial private slice; users sign in/out, and no self-service instructor promotion is available. Provisioning/recovery must be demonstrated securely before authorized release, without asking the assistant for credentials. Public signup/identity-provider expansion needs separate scope/processor review; verified course invitations remain epic 5.
- Assumption: a compact four-stage setup with persistent library/privacy controls is the chosen UX default. Manual planning remains available when AI consent is declined; unavailable optional diagnostics can be skipped without penalty. This does not waive functioning AI planning/diagnostic acceptance.
- Decision: 2026-10-21 — independent Ticket/Set/Dependencies/Tree validation split the oversized retention/restore story: S10 retains expiry/archive enforcement, new S13 owns protective backup/restore, then S11 sweep and S12 closing suite. Preserve existing IDs and use thirteen entries, next ID 14. Initial migration ownership and minimal synthetic learner/instructor/admin principals belong in S1, not a downstream epic.
- Decision: 2026-10-21 — live inference before complete lifecycle/release gates is limited to separately authorized synthetic, non-personal evaluation with eligible processor/account/region/budget/operator evidence. No such permission exists now; all actual personal data and deployed use still wait for F5/F6. Epic 1 owns the first setup/diagnostic adapter/configuration; epic 2 extends generation/retrieval and re-gates changed purposes/models rather than inheriting blanket consent.
- Decision: 2026-10-21 — extraction remains the next implementation uncertainty after the tracer: parsing limits/isolation must establish usable safe source revisions before consent/setup integration. The existential F3 processor issue is explicitly visible now as a blocker; it is not deferred for discovery until S6 or bypassed by manual output.
- Open question: **F1/F2/F3/F5/F6:** capture actual runtime, extraction, processor, lifecycle/restore and authorized-hosting/cost evidence in the named story before activation. Story 1 waits for build/start permission; story 6 waits for an eligible live processor/terms/budget authorization; story 12 waits for provisioning/deployment approval. F4 records that coding/narration remains epic 6's gate. No upload or preference interview is required now.
- Decision: 2026-10-22 — recorded deviation under delegated planning (flagged for the next human review): S8 (export), S9 (deletion), S10 (retention) and S13 (backup/restore) proceed over the derivative types that exist (originals, extractions, plan revisions/confirmations, consent/decision records, dispatch admissions, diagnostic evidence) instead of waiting on blocked S6/S7; their contracts explicitly anticipate ports that later epics extend. S7 is built as infrastructure + skip path only; its take-path acceptance (validated 3–5-item check on an eligible generator) stays open pending S6 eligibility. The epic tickets.toml `after` edges among these entries are treated as review-time context, not runtime gates, for exactly these entries — recorded here and in the epic memlog, never silently.
- Status: 2026-10-22/23 — stories 3, 4, 5, 7 (infrastructure), 8, 9, 10 and 13 are built and passed the full local synthetic gate (S11 sweep + closure bookkeeping executed 2026-10-22). S6, S7 closure and S12 remain blocked on F3/F6 authorization; "Done when" #5 is unmet and the epic is NOT closed. Leaf ticket `status: built` fields record local gate evidence only; no ticket metadata beyond that was advanced, and local passes neither close F1's accepted runtime-security exception nor authorize release.
- Status: 2026-10-25 — **S7 take-path closed (1.7 done) and S12 re-sliced (1.12 done, new 1.14 deferred).** AI-generated 3–5-item starting checks now run through the same admission/settle machinery (migration 013: configuration v4 widens the consented purpose — one honest re-grant; migration 014: bundle source check admits `ai-generated`), validated strictly against the confirmed plan's outcomes/sources, landing as standard diagnostic bundles the unchanged take/submit/finish flow runs on; `takeCheck` reuses an existing bundle per plan revision (idempotent retake). S12's local half (1.12) closed on the full gate as one integrated run plus three live AI probes (connectivity, 5-topic draft, 3-item check — `.local/ai-smoke-latest.json`); the deployment half is new entry 1.14, unknown-blocked on authorization. **Board: entries 1.1–1.13 done; the sole open entry is 1.14. The epic stays in-progress on 1.14 alone — no deployment or release claim.** Full gate green: unit 143, integration 118, browser 52, restart, build.
- Status: 2026-10-24 — the user personally accepted story 1 (entry 1.1); it is `done`. The epic's remaining open entries are exactly the F3/F6-blocked set: 1.6 (eligible live AI), 1.7 take-path closure (waits on 1.6) and 1.12 (authorized release). The epic remains NOT closed, and no F1/release claim follows from this acceptance.
- Decision: 2026-10-24 — P3 review flags resolved. (a) **Terminal consent withdrawal is ratified as deliberate policy** (stricter than S3's contract line): once withdrawn, processing consent cannot be re-granted even on a changed disclosure version — the protective path back is root deletion/re-provisioning; weakening it would need a separately planned story. (b) The export manifest now states the diagnostic bundle/item exclusion as a **deliberate answer-key exclusion**, not an inventory limitation (`manifest.ts` skip reason + integration assertion updated). (c) The **active parser-admission digest is documented** in `docs/bounded-document-extraction.md` as a digest-of-record with the print command, with the git-ignored admission file named as the authoritative source that legitimately changes on re-admission. Also recorded: the 2026-10-24 S6 provider attempt (user-supplied Kimi coding-plan key) FAILED D5 eligibility before any dispatch — endpoint scoped to coding tools, UA anti-tamper rule, no coding-plan data terms, and the Kimi Platform privacy policy itself fails as published (training-use grant, no deletion timeline); key stored unused in git-ignored `.local/ai-provider.json`; S6 stays blocked pending a provider whose binding terms pass.
- Status: 2026-10-24 — independent fresh-context reviews (plus a full local gate re-run at HEAD) cleared the pending review backlog: story 2 PASS-WITH-NOTES (P3 nits only), the wave builds S3/S4/S5/S7-infra/S8/S9/S10/S13 and the S11 sweep all PASS (no P0–P2), and the visual-spine revision PASS-WITH-NOTES after remediating its one P1/P2 (commit 33bcccb's sign-in prefill was outside the plan's restyle-only authorization and serialized the synthetic password into served HTML; corrected to email-only and ratified by plan amendment §11 the same day). Entries 2, 3, 4, 5, 8, 9, 10, 11 and 13 are marked done under the user's 2026-10-24 "finish them" direction; entry 1 was accepted by the user the same day (Status line above), entry 7 stays blocked on take-path closure, and 6/12 stay blocked on F3/F6. P3 items flagged for the next human review: consent withdrawal is terminal (a changed disclosure version cannot be re-consented; the path back is deletion/re-provisioning — stricter than S3's contract), the export manifest frames the diagnostic item-bank exclusion as an inventory limitation rather than a deliberate answer-key exclusion, and the current parser-admission digest is not printed in docs (it lives in the git-ignored `.local/parser-admission.json`). The epic remains NOT closed; no F1 or release-readiness claim.
