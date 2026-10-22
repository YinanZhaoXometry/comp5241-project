# Reconciliation — architecture spine vs PRD/addendum §B

- **Reconciled against (input):** `_bmad-output/initiative-ai-learning-platform/architecture-shared-technical/architecture-shared-technical.md` (status: final, 2026-10-21; read in full).
- **Checked artifacts:** `addendum.md` §B (architecture digest) and `prd-ai-learning-platform.md` AD references (mainly §9 Cross-Cutting NFRs; also §0, §3, §4 FRs, §8, §10, §11).
- **Method:** every AD-1–AD-18 rule, the Stack block and the Deferred G1–G6 table were compared line-by-line against the digest one-liners and every `AD-…` / `G…` citation in the PRD.
- **Overall verdict:** substantially faithful. No mis-quoted AD decision text, no overstated status (all planning/gate caveats preserved), no G-gate contradiction. Found 1 mis-attribution (PRD OQ-5 labels epic refinement "G2 execution readiness"), 1 internal inconsistency in addendum §B (AD-9 asterisk dropped), and a small set of product-facing AD consequences not (or only implicitly) carried into the PRD.

## 1. Misquoted / mis-attributed AD decisions

**1.1 PRD §10 OQ-5 — gate mis-attribution (the one real mis-attribution found).**
PRD line 417: "**Epic refinement (G2 execution readiness):** five of six epics remain unrefined…". In the spine, **G2 is "Real-data processors/regions"** (model snapshot, no-training/deletion terms, consent, location, budgets before any live AI). Epic refinement is not G2: the spine's Deferred table carries it as a separate row — "Physical schema and UI composition — At epic refinement under AD-1–AD-15". If "G2" was meant as "gate execution readiness" generally, the label should be dropped; as written it points readers at the wrong gate.

**1.2 PRD §9 "Fail-closed integrations" — wording attributed to the spine that the spine does not contain.**
PRD line 407: "missing **daemon/admission**/consent/limits evidence blocks the capability rather than degrading to an unsafe fallback (AD-10/AD-11/AD-18)". The architecture document never uses "daemon" or "admission"; that vocabulary comes from the workspace's operational rules (AGENTS.md worker/parser readiness), not from the spine. The substance is otherwise supported — AD-10 "defaults off until actual contractual/technical proof", AD-11 "fail honestly", AD-18 gates — but the citation implies spine wording that is not there. Consider "missing consent/admission/limit evidence" sourced to AD-10/AD-11/AD-18 plus workspace ops, or drop "daemon/admission".

**1.3 Addendum §B AD one-liners — no mis-quotes.**
All 18 one-liners were checked against the spine's AD headings and rules; names, attributions (which ADs are `[ADOPTED: D…]` vs `[ASSUMPTION]` is not carried, but §B's blanket planning-level caveat covers that), retention numbers (7-day purge, 24-hour export expiry, 90-day archive purge, 30-day backup expiry), "standard Anthropic retention fails D5", "RPO 24h/RTO 8h, unmeasured", and the AD-12 quote "a disabled placeholder does not satisfy R17" are all verbatim-faithful.

## 2. Product-behavior-constraining ADs — coverage in the PRD

Checked each starred AD's product-facing consequence against the PRD:

| AD | Product-facing consequence (spine) | PRD location | Verdict |
|---|---|---|---|
| AD-3 | per-operation scope checks; revocation epochs; removed learner's distinct self-history export | §9 "Scoped authorization"; FR-4; UJ-4 edge | Covered. Minor: "already-delivered bytes cannot be recalled" honesty nuance absent. |
| AD-4 | 7d purge / 24h export / 30d backups+metadata / 90d archive | §3 Export/Deletion, §8.1, FR-22 | Covered and labeled "verification targets, not present compliance". |
| AD-5 | enrollment pinned to a release **"until an explicit informed switch; no automatic progress migration or erasure of prior awards"** | §9 + FR-5 cover withdrawal/immutability only | **Gap:** the explicit informed *release switch* (learner choice, no automatic migration) is absent from the PRD. |
| AD-6 | exact-version gate incl. fresh retests/why-responses; Pending state; no partial streaming; provisional subjective grades; personal-study AI label | FR-5, FR-13, §8.2 | Covered thoroughly. |
| AD-7 | skippable diagnostic; Unknown ≠ Needs practice; generation pins immutable confirmed plan | FR-21, §3 Starting check | Covered. Minor: "Stale/canceled references produce an explicit conflict/pending outcome with saved input" not carried. |
| AD-8 | snapshot; 80% exact integer comparison; recovery clears only reassessed groups; monotonic awards | FR-13, FR-14, §9 | Covered. Minor: "Learners cannot post scores/credit" not stated verbatim. |
| AD-9 | "By 120 seconds show success or honest pending/retryable failure with saved input" | §9 Honest asynchronous behavior; FR-1; SM-4 | **Covered in PRD but asterisk dropped in addendum §B** (see 2.1 below). |
| AD-10 | consent/retention evidence per call; private external processing defaults off; Anthropic retention fails gate | FR-22, §5 non-goal, §10 OQ-1 | Covered. Minor: "Public search queries cannot contain private excerpts/identifiers" only partially covered by §8.1 minimization. |
| AD-11 | PDF/DOCX/TXT/MD, 20 MiB/file, 10/generation; honest failure; no OCR/archives/remote-URL import | FR-1 (+Out of Scope), FR-6 | Covered. |
| AD-12 | six activity families; accessibility equivalents; "A disabled placeholder does not satisfy R17"; isolated runners | FR-17, §8.2 | Covered. Minor: "Narration is locally generated by an offline adapter by default; Remote TTS needs AD-10" appears only implicitly via OQ-3 — the offline-by-default product behavior is not stated. |
| AD-13 | 1/3/7/14/30 cadence; IANA/DST; in-app-only, one/day cap; pause ≠ evidence change | FR-15, §5, UJ-3 | Covered, including "at most … per local calendar day" matching the spine's upper-bound framing. |
| AD-14 | course-scoped reports; CSV preview/confirm; no private-study evidence | FR-16, FR-4 | Covered. |
| AD-18 | G1–G6 executable; quotas before live processing; manual fixture checks; no efficacy/PMF claims | §5, §8.2, §9, §11 | Covered. |

**2.1 Addendum §B internal inconsistency (AD-9 asterisk).**
§B's legend (line 48) says "asterisk = constrains product behavior, echoed in PRD §9", and PRD §9 does echo AD-9 ("Honest asynchronous behavior … (AD-9)"). But the one-liner list (line 50) drops the asterisk from AD-9, breaking the legend and understating a product-facing rule (the 120-second honest-pending promise). Restore `AD-9\*`.

**2.2 AD-4 nuance worth carrying.**
Spine line 100: "Account/personal deletion does not silently delete legitimate course records; legal/institutional incompatibility blocks real use until an explicit policy decision." The PRD's deletion rules (§3, FR-22, §8.1) never state that a learner deleting their account leaves instructor-controlled course records intact — a user-visible deletion consequence.

## 3. Status overstatement check

**Clean — no overstatement found.**

- Addendum §B preserves "Planning-level only — 'binding for downstream planning until explicitly revised, not implemented or individually user-selected'; authorizes nothing", "Planning pins (not a tested lockfile)", and "Unprovisioned target topology".
- PRD §0 ("planning-level technical contract … summarized in the addendum"), §9 (budgets "deliberately unset … a G6 implementation-evidence gate, not a planning invention"), §11 ("This PRD's numbers are acceptance targets … Nothing here reports Story/F1 readiness … or authorizes release") and FR-22's Out of Scope ("targets to verify (G2/G5), not present compliance") all match the spine's stance that "Final architecture status means the planning contract passed review, not that release gates passed."
- Node runtime is consistently framed as "pending security release = blocking recheck" (addendum §B) / "accepted risk for local development only" (OQ-2) — matching the spine's "a blocking recheck, not an endorsed vulnerable runtime".
- No pin is presented as an installed/tested lockfile; no gate is presented as passed.

## 4. G1–G6 gate drift check

**No contradictions; one condensation note plus the OQ-5 mis-attribution above.**

- Addendum §B gate one-liners are faithful condensations of the spine's Deferred table. Condensation note: §B's "G1 runtime/lockfile recheck (Node security release)" drops the spine's G1 remainder — "compile and lint Next/React/TypeScript 6/auth/web/worker together; verify managed PostgreSQL major 18/observed patch and queue transaction rollback". Not a drift, but downstream readers lose the full G1 checklist.
- PRD OQ-1 (G2) matches, including "standard Anthropic/API retention terms do not pass D5" (spine: "does not presently pass this gate" — the PRD's flat present-tense is faithful enough but drops "presently").
- PRD OQ-2 (G1) and OQ-3 (G4: "offline narration engine/voice licensing and quality; isolated runner proof (no egress/secrets, escape/cleanup tests)") match the spine.
- PRD §6.2's "runner/narration feasibility (G4) precedes activation" matches the spine's "Epic 6 before corresponding activation".
- PRD §9's G6 reference matches ("real test harness, cost/load limits and measured latency").
- PRD §11's "G1–G6 feasibility gates precede the pilot" is an acceptable summary of the spine's activation-point phrasing ("before affected stories" / "before real-data deployment" / "initiative before D8").

## 5. Findings list (most important first)

1. **[Fix] PRD §10 OQ-5** labels epic refinement "(G2 execution readiness)" — G2 is real-data processor verification in the spine; refinement is a separate deferred row, not a numbered gate (mis-attribution, §1.1).
2. **[Fix] Addendum §B line 50** drops the product-behavior asterisk on AD-9 although its 120-second honest-pending rule is echoed in PRD §9, contradicting §B's own legend (§2.1).
3. **[Gap] AD-5 release switching** — "enrollment pinned to a release until an explicit informed switch; no automatic progress migration or erasure of prior awards" has no PRD counterpart; §9/FR-5 cover only withdrawal and non-rewriting (§2 table).
4. **[Wording] PRD §9 "Fail-closed integrations"** attributes "daemon/admission" evidence language to AD-10/AD-11/AD-18; that vocabulary is workspace-ops, not the spine (§1.2).
5. **[Minor gaps]** AD-4's "account deletion does not silently delete legitimate course records" absent (§2.2); AD-12's offline-by-default narration only implicit via OQ-3; AD-7's stale-plan-reference conflict outcome and AD-8's "learners cannot post scores/credit" not stated; §B G1 condensation drops the PG18/queue-rollback verification items.

All findings are report-only; no PRD or addendum text was modified by this pass.
