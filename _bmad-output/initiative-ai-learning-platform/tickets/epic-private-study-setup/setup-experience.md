---
title: Private study setup — UX contract
created: 2026-10-21
authority: Assistant-selected defaults under delegated epic refinement
scope: Personal setup and lifecycle states, not a product-wide visual system
---

# Private study setup experience

## Purpose and screen structure

The [refined epic](epic-private-study-setup.md) owns this contract. [D2/D5/D7](../../product-policies.md) and [AD-3/AD-4/AD-7/AD-9–AD-11/AD-15/AD-18](../../architecture-shared-technical/architecture-shared-technical.md) prevail. These are build targets, not implemented screens or individually user-selected layouts.

- **Navigation:** My study library, New study and Privacy & data. New study has Materials → Goal → Plan → Optional starting check; going back preserves server-saved work. No lesson, Completed node or fake Generate course success in this epic.
- **Desktop/mobile:** constrained readable main column with a compact step list beside it on desktop; one column and textual current-step indicator at 360px. Place the primary action after the current inputs, secondary Back/Save and leave separately, destructive actions in a distinct section. Avoid dense horizontal tables on mobile.
- **State identity:** UI displays server-authoritative operation and revision state. A spinner, elapsed time, completed upload transfer or accepted request is not successful extraction/generation/confirmation. Unsaved edits are not reported saved.

## U0 — Sign-in and access boundary

| State                                | What the learner sees and can do                                                      | Required behavior                                                                                                                                                |
| ------------------------------------ | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Signed out                           | Sign-in form; contact operator for account/recovery                                   | No private previews/thumbnails in public shell; generic invalid-account/credential message                                                                       |
| Signing in / invalid input / refused | Named fields, progress, specific field-format error or generic authentication refusal | One submission; no credentials in URL/logs; accessible error summary                                                                                             |
| Signed in                            | Own library and account identity                                                      | Real database session; role/owner supplied by server, not client                                                                                                 |
| Session expired / revoked            | Sign-in prompt and “Sign in again to continue”                                        | Clear private UI/cache immediately, stop requests and do not show previous user's draft on account change; after reauth reload only authorized server-saved data |
| Forbidden or missing                 | “This item is unavailable” and safe Library link                                      | No existence/owner/content leak; same rule for direct/download/job-result routes                                                                                 |

No persistent browser storage of material text, plans or answers. Unsaved edits live in memory only; leaving with unsaved work warns, but security clearing on logout/revocation takes priority. Do not promise recovery of unsent changes.

## U1 — Library and resumable setup

| State                 | Primary action             | Visible distinction                                                  |
| --------------------- | -------------------------- | -------------------------------------------------------------------- |
| Empty                 | Start a study plan         | Explain private ownership; no invented progress                      |
| Loading / load failed | Wait / Retry               | Keep safe navigation, no stale content from another session          |
| Draft setup           | Resume                     | Current stage, saved time, material count and latest saved revision  |
| Confirmed plan        | View / Edit a new revision | “Plan confirmed — course not generated”; no pass/completion credit   |
| Processing / pending  | View operation             | Durable status, cancel if available, return later                    |
| Deleted target        | View deletion receipt      | No content access; purge status/deadline only while receipt retained |

## U2 — Materials, extraction and preview

| State                                              | Learner action                                                             | Checkable response                                                                                                                                                       |
| -------------------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| No files / selected                                | Choose files or keyboard file picker                                       | Explain PDF/DOCX/TXT/Markdown, 20 MiB each, ten files per generation; no remote URL/OCR/archive option                                                                   |
| Uploading / upload failed                          | Cancel / Retry                                                             | File-level status, no false extraction-ready message; retry does not duplicate committed material                                                                        |
| Quarantined / extracting                           | Wait or leave and return                                                   | Original is private; no unsafe download/render or parser activity in browser                                                                                             |
| Preview ready / warnings                           | Inspect text and warnings; acknowledge selected usable revisions           | Per-file source identity/location and warnings; partial extraction never described as complete                                                                           |
| Rejected / unreadable / protected / no usable text | Remove or replace that file                                                | Distinguish unsupported format, size/count limit, password protection, missing text, corrupt/unsafe input and service/resource failure without exposing parser internals |
| Mixed batch                                        | Remove/replace failed files, explicitly continue with successful selection | No silent file omission; confirmation lists exact selected extracted revisions                                                                                           |
| Pending at 120 seconds                             | Return later or retry when safe                                            | Preserve saved input and operation ID, state “Still processing” or retryable failure; no arbitrary percent-complete claim                                                |

Reject the eleventh selected input before generation and revalidate count/bytes on the server. Do not fetch Markdown images, document external relationships, macros or embedded resources. Extraction acknowledgment selects source revisions; it does not assert factual agreement or award learning progress.

## U3 — Processing disclosure and controls

Processor policy is a separate axis from learner consent. A checkbox cannot override an ineligible provider.

| State                            | UI and actions                                                                                                          | Result                                                                                |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Processor unavailable/ineligible | “AI processing is unavailable under the current privacy policy”; manual setup, save, export and delete remain available | No request dispatched; do not solicit consent to a noncompliant configuration         |
| Eligible, not yet consented      | Provider/model configuration, purpose, categories, retention/exception notice, link to terms; Allow / Not now           | No preselected checkbox, bundled consent or data sent before opt-in                   |
| Declined                         | Manual topic/plan editing, explicit Enable AI later                                                                     | No external AI/search/TTS call; saved work remains                                    |
| Allowed                          | Current disclosure version and Withdraw control                                                                         | Minimized allowed data only; still requires scope, lineage, budget and policy checks  |
| Disclosure changed               | Re-consent prompt, saved manual work intact                                                                             | Old opt-in cannot authorize changed processor/purpose/categories/retention            |
| Withdraw pending / withdrawn     | Explain future processing stopped, prior disclosed processing cannot be undone; offer deletion                          | Fail closed immediately; late outputs discarded and retained copies tracked for purge |

Local storage/extraction is disclosed separately from external AI; private visibility is not a claim that infrastructure never processes data. For synthetic test configurations, prominently label the test mode; do not present it as compliant live AI.

## U4 — Short topic and goal setup

- **Topic:** once eligible AI inference is implemented, show candidate topics with source references and a short edit field; the learner confirms/corrects rather than accepting silent inference. Without consent/eligibility, offer manual topic entry labeled Manual, not guessed AI output.
- **Goals:** Exam preparation, Understand a topic, Apply a skill, Other. Other needs only a short clarification. Ask a follow-up only when its answer changes the plan; exam date is optional unless a date-dependent plan is requested. Background/time preference is optional by default. Editing preserves usable material selection and marks a subsequent plan revision unconfirmed.
- **Timezone:** detect an IANA timezone, show it under optional settings and allow correction; invalid zones fail with a field error. Store for epic 4, but do not schedule reminders here.
- **Validation:** highlight the first invalid field after showing a summary; selecting a goal is sufficient where no critical clarification exists. No universal written purpose, obligatory diagnostic or forced background essay.

## U5 — Plan preview, edit and confirmation

| State                                    | UI/action                                                              | Invariant                                                                                                                         |
| ---------------------------------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Manual draft                             | Add/edit outcomes, mini-courses/lessons, practice and estimated effort | Estimates labeled estimates; source coverage/missing explanations visible, not fabricated claims                                  |
| AI request queued/running                | View operation, leave/resume                                           | Only allowed under U3; all selected source/goal revisions pinned                                                                  |
| AI draft ready / invalid output / failed | Inspect/edit / Reject invalid result / Retry or manual edit            | AI label, uncertainty and source coverage; invalid schema/support cannot silently become confirmed                                |
| Saving / saved / save failed             | Wait / Continue / Retry                                                | Show actual saved time/revision; retry same command cannot create duplicate plans                                                 |
| Revision conflict                        | Compare/reload latest saved version, then reapply edits                | Preserve accessible in-memory edits while authorized; never silently overwrite another tab's confirmation                         |
| Confirmed                                | Explicit Confirm plan, then view immutable confirmed revision          | Selected source/outcome/mini-course/practice/effort view is what is confirmed; no auto-confirmation                               |
| Edited after confirmation                | “New changes need confirmation”                                        | New draft does not replace old confirmation; future generation references exact authorized confirmed revision, never latest draft |
| Source deleted/replaced                  | “This plan needs updated sources and confirmation”                     | Reject stale/deleted-source handoff; no automatic substitute                                                                      |

The handoff here is “Plan ready for course generation,” not functioning full mini-course generation (epic 2). A disabled course action must explain that capability is unavailable in this release; do not imply an accepted generation job exists.

## U6 — Optional starting check

| State                                 | Primary / secondary action                                                | Meaning                                                                                                              |
| ------------------------------------- | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Offered after confirmed plan          | Take 3–5-question starting check / Skip for now                           | Equally visible skip; no completion exemption either way                                                             |
| Unavailable / waiting / invalid items | Retry when safe / Skip                                                    | Manual/declined/ineligible paths still finish setup; unavailable is not a pass or evidence of weakness               |
| In progress                           | Submit answer; Leave/Skip remaining                                       | No answer/rationale exposed until that item is submitted; unsent answer is not performance evidence                  |
| Submitted / result                    | View result, relevant objective/source and uncertainty; flag unclear item | Distinguish unaided/assisted evidence; self-report separate; no certain-cause diagnosis or mastery claim             |
| Skipped / partial / finished          | Return to confirmed plan                                                  | Unassessed objectives Unknown; diagnostic never creates completion awards, scored-course attempts or recovery credit |

Check revision is pinned to the confirmed plan and validated item bundle. Editing the plan invalidates future use of the old check for the new revision, not its historical evidence. No dependency on epic 2 lessons or epic 3 scoring workflow is permitted; reuse only shared pure answer/evidence contracts.

## U7 — Owner export

- **Request → queued/running → ready/failed/expired:** show scope and included derivative categories before request. Ready export has an authenticated download, expiry within 24 hours and a Regenerate action after expiry; no public email/download URL. Allow sign-out; reauthorize at download.
- **Snapshot boundary:** export pins a consistent authorized snapshot; later edits need another export. Deletion invalidates pending/ready exports containing any deleted lineage. Errors do not reveal others' records. Personal exports exclude course question banks/rosters; later course self-history uses AD-3's separate permission.

## U8 — Deletion and retention receipt

- **Confirmation:** separate Delete this material and dependent study data from Delete all my personal study data. Preview dependent courses/plans/check evidence/exports by category, including multi-source derivatives, and state that unrelated material roots and instructor-controlled records are not selected. Cancel is safe/default; no prechecked destructive action.
- **Revoking/pending:** disable access/use immediately upon accepted request; if protective journal commit fails, show a retryable pending error while affected use remains denied. Do not report fully erased yet. Keep operation receipt accessible to the authenticated owner without private content.
- **Purging → purged / overdue failure:** show seven-day active-copy deadline, remaining categories and backup expiry up to thirty days; receipts/errors contain no raw content. Retry idempotently; missed deadlines alert the operator and do not restore access. Receipt/metadata expires within thirty days; no permanent identifiable deletion history.
- **Race behavior:** deleting A also blocks an artifact derived from A+B, but leaves unrelated B usable; in-flight jobs cannot recommit, exports cannot download and future reminders cannot restart. Already downloaded bytes or prior disclosed external processing cannot be recalled; never promise otherwise.

## Shared interaction and acceptance rules

- **Accessibility:** semantic headings, labels, keyboard file selection, visible focus, text plus status icons, appropriate live-region status/error announcements; never focus-steal while typing/polling. Move focus to the next stage's heading after explicit navigation, back to the opener on dialog cancellation and to the receipt heading after deletion. No page-level horizontal overflow at 360px; target WCAG 2.2 AA without certification claims.
- **Navigation/failure:** browser refresh resumes authorized server-saved stage/operation; duplicate click/reconnect reuses operation key. Show honest rate-limited/pending/failed/canceled state and saved work, not a synthetic test failure or learning deficit. Preserve manual work when AI is declined/unavailable.
- **Data safety:** no material/answer text, credentials or signed URLs in logs, analytics, browser storage or public errors. No remote fonts/images/embeds/preloads containing private data; CSP and scoped media adapters enforce this. No state transition can be authorized by text extracted from documents or generated by a model.
- **Evidence:** every visible branch belongs to [S1–S13](delivery-checks.md). Test both allowed and denied paths; screenshots or a polished screen do not establish backend authorization, processor compliance or correct deletion. Before complete lifecycle/release gates, any separately authorized external AI evaluation uses only synthetic non-personal fixtures; the UX contract does not permit live personal-data activation.
