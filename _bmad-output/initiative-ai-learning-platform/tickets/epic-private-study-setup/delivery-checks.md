---
title: Private study setup — story acceptance and feasibility
created: 2026-10-21
authority: Assistant-selected planning under delegated refinement
scope: S1–S13 within epic 1; no execution evidence yet
---

# Story contracts and feasibility

## How to use this contract

The [epic](epic-private-study-setup.md) owns local R1–R4, mapping to parent R2/R7/R21/R22. [UX states U0–U8](setup-experience.md) and shared [AD-1–AD-18](../../architecture-shared-technical/architecture-shared-technical.md) are binding. [The ordered entries](tickets/tickets.toml) supply identity/dependencies; the sections here supply acceptance detail without premature leaf files. Prefix `S` is a section label, not a separate ticket ID; cross-epic references use `1.<entry id>`.

Each story delivers its named behavior plus tests. Every high-risk story also has an independent/beyond-criteria check below. Risks are assistant-selected impact assessments, not effort estimates. The first synthetic/manual slice is real but deliberately narrow; it cannot satisfy the full epic's AI, input-breadth, lifecycle or release obligations. No story is implemented, started, assigned or scheduled by this plan.

There are thirteen bounded entries. IDs 1–12 are preserved; newly split S13 follows S10 and precedes S11/S12. Each execution session targets one entry using earlier accepted contracts; a newly discovered oversized portion requires explicit re-slicing, not silently dropped acceptance or hidden sweep work.

## Feasibility register

| Gate | Required evidence and pass condition | Story / stop condition |
| --- | --- | --- |
| F1 — runtime, starter and transactions (spine G1) | Official security-fixed supported Node patch; actual pinned starter/lockfile, Next/React/TS6/Better Auth/worker compile and separate lint; PG18 compatibility, queue enqueue rollback and duplicate-effect integration checks. No peer overrides/check suppression | S1 before scaffold consumption, then CI regression throughout. If unavailable, record blocked outcome before installing a knowingly unapproved runtime |
| F2 — extraction (spine G3 part) | Pinned parser licenses/versions and sandbox resource ceilings measured against legal TXT/Markdown/text-PDF/DOCX and malformed/ZIP-bomb/XXE/external-link/password/no-text fixtures; zero parser network, bounded expansion/output, honest status by 120 seconds | S2 before untrusted-document activation. General web supplementation/SSRF fetch remains epic 2; no remote import here |
| F3 — external setup AI (spine G2/G6 part) | Actual endpoint/model snapshot, supported features, locations, retention/exception/no-training/deletion evidence and institutional fit; declared token/input/output/concurrency/time/spend admission; versioned consent and refusal/withdrawal network tests. Standard Anthropic retention is not accepted | S3 builds fail-closed policy contracts with synthetic spies; S6 needs actual compatible configuration plus separately approved account/region/budget/operator and synthetic-live-test scope before its first call. Only non-personal synthetic fixtures until F5/F6 pass; ineligible processor stays disabled, and mocks do not satisfy S6/S7 AI acceptance |
| F4 — deferred activity execution (spine G4) | No learner-code runtime or narration in this epic. Preserve versioned activity/evidence extension boundary | Epic 6 owns runtime/voice/license/escape evidence before activation; not claimed passed here |
| F5 — lifecycle and protective restore (spine G5) | Complete copy inventory, all-ancestor generation races, export expiry, seven-day active purge and thirty-day backup/journal expiry, ninety-day archive notice/export/purge contract; restored sessions invalidated, post-snapshot revocations/consent/withdrawals reconciled before traffic/jobs/egress. Test RPO24h/RTO8h targets honestly | S8/S9/S10/S13; synthetic clocks can test deadlines, not prove managed-provider terms. Missing/uncertain copies or journal completeness blocks real use and safe restore |
| F6 — operator/release readiness (spine G5/G6) | Separately approved accounts/plan/budget/regions/provisioning, secure account provisioning/recovery, private storage/DB and managed backup terms, measured setup latency/load/cost, content-free monitoring/operator responsibility, staging and authorized production smoke checks | S12; actual numbers and resource owners recorded before live use, not fabricated now. No critical/high security or material lifecycle defect; core keyboard/360px/desktop checks pass |

Evidence records created during future work identify configuration/version, date, reproducible check, outcome, redacted artifact and accountable operator. “Not verified,” failure and blocked are valid recorded outcomes, but do not close an entry requiring a pass. A new vendor or weakened policy requires explicit upstream revision, not a story-local waiver. Build permission in entry 1 and live/provisioning permissions in entries 6/12 are real start blockers; `hitl` alone is not a machine gate.

## S1 — Private TXT-to-confirmed-plan tracer

**Coverage:** R1 privacy, R2 minimal choice, R3 manual confirmation, R4 initial root lifecycle. **Risk:** high — initial identity/data boundary. **Human step:** operator authorizes start, runs/reviews the selected starter/setup and securely provisions minimal synthetic learner/instructor/admin principals through the auth-supported path; no secret is passed through chat. These are denial-test actors, not live instructor workflows or study participants. **Depends on:** none; entry unknown blocks unauthorized build.

- Before using a starter, F1 establishes a permitted runtime and actual package compatibility; establish real web, database, private local storage and background worker plus the initial unit/integration/browser/typecheck/lint/build checks. Record actual commands only after they exist.
- Establish one ordered migration owner for auth/application/queue schema and versioned job/DTO contracts from the start; later stories extend this baseline, and S13 tests overlap/restore compatibility. Use a minimal single setup page and TXT-only flow, not the polished multi-stage experience or future module implementations.
- Given two controlled learner accounts and a bounded synthetic TXT, A signs in with a real database-backed session, uploads the TXT, sees durable queued/extracting/preview states, chooses a topic/one of the four goals and explicitly saves/confirms a one-mini-course learner-authored plan. Label the plan Manual; no fake AI response, course completion or diagnostic waiver.
- Refresh/restart web and worker: A can reopen the confirmed plan. Direct B/instructor/ordinary-admin access to material, extracted text, plan and operation output is denied; session revocation is effective without cookie-cache delay. GET session lookup stays read-only with POST refresh.
- Initial writes register original/extracted/plan objects and lineage; minimal selected-root removal denies future use immediately and removes this tracer's active copies. Unrelated root B remains usable. Complete multi-type purge/retention/backup guarantees are S9/S10/S13, not claimed passed here. Development remains local with synthetic data; S6/S7 may later run separately authorized synthetic, non-personal live-AI evaluations after all applicable F3 approvals. Real personal-data processing and deployed use remain blocked until F5/F6 pass; this is not permission for any call now.
- Queue enqueue rollback leaves neither committed state nor orphan job; duplicate upload/confirmation returns one committed result. Private errors/logs/cache contain no document or credential data. Show the running upload → preview → manual confirmed plan → reopen/deny/remove check; do not call health checks the tracer.

**Beyond-criteria check:** independently replay a captured authorized request as the other actor and after session revocation; verify response, stored ownership and worker output all deny access, not just UI navigation.

## S2 — Bounded four-format extraction and explicit preview

**Coverage:** R1/R4; R3 input provenance. **Risk:** high — hostile files and resource exhaustion. **Depends on:** S1's scoped material/job/lineage interfaces. **UX:** U2.

- Accept text-based PDF, DOCX, TXT and Markdown with byte/MIME checks, maximum 20 MiB/file and ten selected inputs per generation. Valid-at-limit files succeed when readable; oversize, eleventh file, misleading extension, protected/corrupt/no-text and generic archive inputs are rejected honestly. No OCR or remote URL input.
- Isolate parser execution without network/credentials/macros or arbitrary archive paths. DOCX structured ZIP parsing has bounded entries/expanded size/output; resource-limit failures are explicit and do not crash the general web/worker process. Record F2 version/license/limits and attack-fixture outcomes.
- Produce per-file immutable extracted revisions with source locations/warnings. Mixed batches do not silently drop failures: learner removes/replaces or explicitly selects acknowledged successful revisions. Confirmed plans never reference rejected/unreviewed extraction.
- Canceled/duplicate/restarted jobs preserve state and never register extra copies/results; deletion fences prevent late preview commits. By 120 seconds show complete, honest pending or retryable failure with saved inputs.

**Beyond-criteria check:** inject a DOCX expansion/path traversal/external relationship fixture and observe resource/network behavior outside the parser, not merely its returned message.

## S3 — Consent, policy admission and durable processing controls

**Coverage:** R4. **Risk:** high — undisclosed egress. **Depends on:** S2's safe selected-source revisions. **UX:** U3.

- Store processor configuration/disclosure revision separately from owner consent and lineage eligibility. An ineligible/unknown configuration remains blocked even when a user submits `allow=true`; never assume standard API retention meets D5.
- Eligible disclosure names provider/configuration, purpose, categories, retention/exception terms; no opt-in preselection. Decline and version changes dispatch nothing externally; manual work, exports and deletion remain available. Re-consent is required for changed processor/purpose/categories/retention.
- Admission validates current session/scope, every ancestor fence, policy evidence, purpose/consent and configured quota before enqueue/dispatch. Minimize excerpts and reject unnecessary identifiers/rosters. Persist scoped IDs/operation receipts, not private queue payloads or logs.
- Withdrawal blocks new dispatch immediately, journals the protective state and exposes honest pending/retry failure if durable protective recording fails. Already-sent requests are tracked; late results are rejected and retained copies enter purge. S9 completes copy purge; withdrawal does not silently delete personal work or promise undo of prior processing.
- Synthetic processor spies prove zero calls for denied/ineligible/stale/withdrawn cases and bounded duplicate/unknown-outcome retry handling. This story proves the boundary, not actual provider eligibility or live AI.

**Beyond-criteria check:** race consent withdrawal and dispatch on separate database clients; prove there is one serialized outcome and no untracked late result.

## S4 — Short goals, corrected topic and resumable preferences

**Coverage:** R2/R3; R4 privacy. **Risk:** medium — wrong plan intent or lost work. **Depends on:** S3's processing/manual-mode distinction. **UX:** U1/U4.

- Offer exactly the four goal routes; only Other's short clarification or a genuinely plan-changing follow-up is required. No universal exam date, background essay or forced time preference. Topic can be manually corrected and confirmed; automatic candidates arrive in S6, not a fake inference here.
- Save goal/topic/source selection and optional background/time preferences server-side with explicit save status and optimistic revision conflicts. Back/refresh resumes saved data; unacknowledged changes are not reported saved. Changing relevant inputs invalidates future confirmation of the changed draft without erasing older history.
- Detect/show/change IANA timezone and reject invalid input; provide settings to epic 4 without scheduling review here. Logout/account change clears private UI; reauthentication reloads only authorized saved work.
- Verify all four routes, short Other, optional/skipped preferences, invalid input, stale second-tab save, session-expiry recovery and 360px/keyboard behavior.

## S5 — Editable immutable plan and exact confirmation handoff

**Coverage:** R3; R1/R4 revision ownership. **Risk:** high — generation from unconfirmed/stale work. **Depends on:** S4's selected goals/sources. **UX:** U5.

- Manual plan preview/edit includes outcomes, mini-course/lesson structure, practice, estimated effort, selected-source coverage and missing explanations. Estimates and unchecked coverage are labeled; missing explanations are flags for epic 2 supplementation, not fabricated fetched citations.
- Explicit confirmation freezes the exact authorized plan and selected extracted-source revisions. A new edit creates an unconfirmed draft; it never silently substitutes for a queued/confirmed revision. Double confirmation returns one receipt; conflicting revision gives an actionable conflict with saved input.
- A shared handoff query returns exact confirmed plan/source/goal/objective identities and provenance to epic 2; it rejects absent confirmation, unauthorized/deleted lineage and stale substitution. No actual full mini-course job or completion award is created here.
- Provide the four-stage continuation to optional check and the honest “Plan ready for course generation” library state. A direct attempt to bypass confirmation fails server-side.

**Beyond-criteria check:** two-tab edit/confirm plus source deletion between handoff admission and commit; prove no unconfirmed or deleted replacement is consumed.

## S6 — Actual policy-compliant topic inference and plan drafting

**Coverage:** R3/R4 with R2 selected intent. **Risk:** high — private processing, unsupported content and spend. **Human step:** authorized operator verifies/configures an actually eligible endpoint/model/terms and obtains applicable account/contract/region/budget/operator approval for synthetic-live-test scope before any request. **Depends on:** S5's confirmation/version model and S3's policy boundary. **Start blocker:** actual eligible processor and permission are unresolved; `unknown` stays until evidence permits the intended bounded scope.

- F3 records a compatible configuration and bounded request/response/cost/time/concurrency ceilings; an ineligible configuration cannot pass because it has an SDK/key or a consent checkbox. Any standard-policy incompatibility remains blocked or goes to an upstream policy decision; no silent provider switch.
- For authorized rights-checked synthetic, non-personal fixtures only, actual AI derives candidate topics and a draft with outcomes/mini-courses/lessons/practice/effort and source coverage/missing explanations. The learner corrects/edits/confirms it through S4/S5; AI cannot auto-confirm, publish, grant progress or interpret document text as tool authority. Actual personal data or hosted use still needs passed F5/F6, not merely copyright permission.
- Validate structured output and selected-source references; unsupported claims/invalid schema yield rejected/uncertain drafts, not confident successful plans. Input itself is untrusted; no arbitrary network/tool execution. No new supplementary web fetch in this epic.
- Declined/revoked/stale/budget-exhausted/timeout/unknown-provider-outcome branches preserve manual work and expose honest pending/blocked/failure by 120 seconds, with tracked requests and no duplicate accepted plan. A real working AI draft—not the synthetic spy—must be demonstrated for this story to pass.

**Beyond-criteria check:** inspect redacted egress traces and accounting against actual configured terms/purpose, including hidden retries, logs, feedback, provider caching and late deleted-root outputs.

## S7 — Optional 3–5-item starting check without completion credit

**Coverage:** R3/R4. **Risk:** high — misleading evidence and answer disclosure. **Depends on:** S6's eligible structured generator and S5's confirmed plan. **UX:** U6.

- Before F5/F6 pass, live diagnostic evaluations share S6's separately authorized synthetic, non-personal scope; they do not authorize processing actual learner material or releasing hosted features.
- Offer Take check and equally visible Skip for now from the confirmed plan. If generation is unavailable/declined/invalid, skip still finishes setup; this is not a substitute for proving a working valid check on an eligible path.
- Produce 3–5 validated objective/source-linked items and declared answer/rationale bundles pinned to the confirmed plan. Manually validate all bounded fixture questions/answers independently of the generator; reject unsupported items. Items/rationales cannot execute instructions.
- Each item withholds its answer/rationale until its submission; persist typed setup-diagnostic evidence with actor/scope/revisions, assistance and objective/source. Unanswered items remain Unknown. Per-item result and uncertainty are not certified grades, scored-course attempts, recovery credit or completion exemptions; self-report is separate.
- Skip/partial/finish, double submit, unclear-item flag, plan edit and deletion are distinct recorded paths. Old evidence remains historical on its old plan; no dependency on epic 2 course generation or epic 3 scored-attempt workflow is introduced.

**Beyond-criteria check:** inspect pre-submission HTML/API/prefetch/network payloads for answer keys and directly attempt to convert diagnostic evidence into completion credit; both paths must deny.

## S8 — Authenticated consistent export of personal setup data

**Coverage:** R4/R1. **Risk:** high — bulk data disclosure. **Depends on:** S7's complete setup derivative inventory. **UX:** U7.

- Preview the owner's export categories and create a consistent snapshot including originals, extraction revisions/warnings, plans/confirmations, processing consent/receipts and diagnostic evidence; register artifact lineage, creation/expiry and hashes/manifest. No other owner's records, secrets or instructor banks/rosters.
- Async queued/running/ready/failed/expired states are durable; download reauthorizes fresh session/owner/fences and is `no-store`, never a reusable public GET link. Artifact expiry is at most 24 hours; active copy is purged and cannot download afterward.
- Concurrent edits do not produce inconsistent snapshots; regeneration is explicit. Duplicate commands yield one artifact. Logout/revocation/deletion during build/download denies remaining access, cancels affected pending exports and discards late outputs. Previously downloaded client bytes cannot be recalled.
- Provide lifecycle export ports/contracts for later evidence/media modules; their actual derivatives are covered when those epics add them, not falsely exported now.

**Beyond-criteria check:** compare export manifest to database/object inventory from a second owner plus a deleted-root fixture; verify no unauthorized blob is reachable by artifact ID.

## S9 — Root-scoped deletion and complete late-work suppression

**Coverage:** R4/R1. **Risk:** high — unintended loss or data resurrection. **Depends on:** S8's setup-copy/export inventory and S3's egress receipts. **UX:** U3/U8.

- Separate selected-material delete from whole-personal-study delete with a dependency preview and cancellation. Deleting A tombstones A and transitive A+B derivatives, not unrelated B or another controller's course records; all-ancestor lineage fences are authoritative, not one owner-wide deletion flag.
- Before accepted request returns, deny affected reads/use/exports/handoffs and future reminders through registered lifecycle ports; journal protective revocation durably. Purge originals, extracted versions, plans/checks/evidence, index representations, job results, exports and provider copies where retained within seven days. Show revocation versus pending/purged/overdue status; missed deadlines alert without restoring access.
- Withdrawal alone stops future egress and offers deletion without automatically destroying all study work. Already-sent calls remain tracked; late worker/AI/export results cannot recommit. Retried deletion/purge is idempotent; receipts/logs contain no raw content and expire under AD-4.
- Verify every setup derivative register/export/delete port; provide synthetic adapter contract tests for later course/evidence/media/reminder derivatives. Those fixtures establish interface behavior only; epics 2–6 must test their actual integrations before exposure.

**Beyond-criteria check:** multi-client race deletion against dispatch, extraction completion, diagnostic submit, export-ready commit and download; verify physical-copy inventory and failed recommit, not only a hidden library row.

## S10 — Bounded retention and archive contract

**Coverage:** R4 retention/archive portion. **Risk:** high — expired copies remaining available. **Depends on:** S9's complete fence/purge semantics. **Session bound:** extend the existing lifecycle scheduler/registry with expiry and synthetic archive-state orchestration; backup/restore infrastructure is S13, not hidden here.

- Implement/test retention policies and explicit active-copy inventory: seven-day deletion jobs, thirty-day backup and content-free metadata ceiling, twenty-four-hour export expiry and ninety-day post-archive notice/export/purge contract. The archive fixture uses synthetic course-controller records; do not expose instructor enrollment/authoring or pretend epic 5 integration already exists.
- Register the backup/journal retention classes for S13's physical implementation. Data remains synthetic-only pending actual backup/restore proof; class configuration alone cannot satisfy it.
- Clock-controlled tests cover expiry boundaries, duplicate scheduler execution, failure/retry and receipt cleanup. For future types not yet implemented, refuse unregistered derivative persistence rather than silently omitting deletion; consumer epics extend and rerun the same contract.

**Beyond-criteria check:** compare the expired-copy inventory with actual active files/rows and the ninety-day archive fixture; prove notices/export precede purge and no expiry receipt resurrects data.

## S13 — Isolated backup and protective restore

**Coverage:** R4 backup/restore portion. **Risk:** high — revoked authority or deleted data resurfacing. **Depends on:** S10's retention classes and S9's protective-state/purge interfaces, using S1's migration owner. **Session bound:** one local encrypted PostgreSQL/private-file snapshot with independently stored content-free protective journal and a repeatable restore procedure; managed topology/terms and production rehearsal remain S12.

- Implement the independent bounded protective-journal storage/replay adapter and a complete local backup inventory under S10 retention policies; reuse the protective transition receipts from S3/S9. Exercise append/delivery failure without false success and never restore grants when journal completeness cannot be proved.
- Restore isolated synthetic data; invalidate all restored sessions and replay post-snapshot deletion, role/enrollment/consent revocation and publication withdrawal before traffic, reminders, queue dispatch or egress. Types without live modules use explicit adapter fixtures only, not pretend feature implementations. Missing/incomplete journal fails closed pending explicit revalidation, not login-only recovery.
- Demonstrate ordered auth/application/queue migration and compatible web/worker/job schema overlap using S1's migration owner. Record local encrypted backup configuration, expiry proof, redacted timings versus RPO24h/RTO8h targets and operator procedure. Local evidence cannot certify managed-host retention; F6 requires actual topology proof before release.

**Beyond-criteria check:** restore a snapshot taken before removal/withdrawal/deletion, with queued work still present; independently attempt direct access, dispatch and reminder delivery before reconciliation. All must remain denied.

## S11 — Refactor sweep

**Coverage:** no new requirement; shared contract preservation. **Risk:** medium — regressions across privacy/setup layers. **Depends on:** every S1–S10 and S13.

- At start, enumerate only cleanup deferred by completed-story plans/review findings; remove duplication/dead paths and improve boundaries without changing accepted UX, schema semantics, privacy/approval/retention or evidence behavior.
- No unfinished requirement, new feature, weakened test or deferred acceptance is “cleanup.” New functional work needs another planned entry, not hidden scope in the sweep.
- Run the existing typecheck, lint, domain, database/queue, browser and denial/lifecycle regression checks unchanged. Report an explicit no-op sweep if no cleanup is justified.

## S12 — Integrated setup journey and separately authorized release

**Coverage:** R1–R4 and epic Done when. **Risk:** high — local/mocked evidence mistaken for safe deployed behavior. **Human step:** authorized operator approves resources/regions/budget, secure provisioning/recovery and operational responsibilities, then deployment under F6; no such approval exists now. **Depends on:** S11 and all its prerequisites.

- Closing suite runs permitted owner and denied second-learner/instructor/admin paths through four-format selection/preview, consent decline/manual plan, eligible actual AI inference/plan correction, immutable confirmation, diagnostic skip/take, export, root deletion and protected restore. It asserts no course-completion award, no unapproved instructor route and no private content in passive asset loads/logs.
- Exercise duplicate click, retry/restart, second-tab conflict, session expiry, changed processor terms, withdrawal/deletion races, missing text and pending after 120 seconds. Check keyboard/focus/labels/contrast and no page overflow at 360px/desktop; tests are in every earlier story, not deferred here.
- F1/F2/F3/F5/F6 artifacts state real configuration, quotas/cost/load/latency limits, measured results and any failure. Require no unresolved critical/high security or material setup/lifecycle defect. Actual live AI proof and compatible terms are required; synthetic contract tests cannot close the epic or unlock epic 2.
- Only with separately recorded authorization and passed relevant gates, deploy to the selected staging/production topology, verify private DB/storage/backups/monitoring and run redacted integrated smoke checks. A denied/blocked deployment stays blocked, not Done. No paid resources, real student data or pilot are created by this plan; D8 is later initiative closure.

**Beyond-criteria check:** independent operator checks release configuration/copy inventory and replays the deployed denied-owner/deleted-root journey, comparing it with local evidence and approved provider/retention terms.

## Downstream handoff and completion boundary

| Consumer | Reusable output | Acceptance boundary |
| --- | --- | --- |
| Epic 2 | Authorized source/extraction revisions, immutable confirmed plan/goals, first setup-AI adapter plus versioned eligibility/configuration evidence, consent/dispatch/accounting and lifecycle ports | Consumer extends full-generation/retrieval, re-gates changed model/endpoint/features/purpose/location/retention and proves its own source support; no blanket inherited consent/eligibility or full lessons here |
| Epic 3 | Typed setup-diagnostic evidence/answer contracts and ownership/lifecycle registry | No scored attempt, recovery ledger or completion exemption; consumer adds its actual evidence types |
| Epic 4 | Owner/timezone settings and cancellation/generation ports | No review schedule/reminder delivery here; consumer proves actual cancellation against its implementation |
| Epic 5 | Auth/session/capability primitives, baseline synthetic denial-test actors and synthetic course-controller archive/export/delete/restore contracts | Consumer extends verified enrollment/approval/reporting fixtures and actual retained self-history/record integration; no live roster/import/publication here |

Whole-epic prerequisites in the initiative remain unchanged: later epics wait for this epic's accepted release, not merely story 5's contract or entry status. Future narrowing needs explicit replan. Readiness tools do not enforce operational authorization automatically; retain the explicit unknowns and human steps rather than interpreting “refined” as permission.