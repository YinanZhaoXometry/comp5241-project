---
title: 'Integrated local setup suite (re-sliced local half of S12)'
type: 'feature'
ticket: 12
created: '2026-10-25'
status: done
baseline_revision: '4562227'
route: 'full'
route_source: 'auto'
risk: 'high'
review: 'quick'
review_source: 'pinned'
lenses_ran: []
review_loop_iteration: 0
context: 'Re-slice of S12 under the owner direction (memlog 25–26, 30): the local integrated half is closable now; the separately-authorized release half is new entry 14 and stays unknown-blocked. No deployment, managed-provider or real-data claim is made by closing this entry.'
---

# S12 (local half) — integrated setup suite, re-sliced 2026-10-25

## Scope after the re-slice

The original S12 bundled the integrated journeys with separately authorized
deployment verification. This entry closes the LOCAL half only; entry 14
("Authorized release verification") carries the deployment half and remains
blocked on its recorded unknown (F6 family).

## Closure evidence (all at HEAD after S7, full gate green 2026-10-25)

- **Complete journeys, together:** the full local gate IS the integrated run —
  audit0, lint 113+probes, boundaries, both typechecks, unit 143, PG
  integration 118 (four-format manual + owner-admitted AI plan drafts and
  generated checks, consent grant/decline/withdraw races, export snapshot
  denial/expiry, deletion fences and purge, retention/archive, protective
  restore), browser 52 (keyboard + 360px journeys incl. the full tracer flow,
  honest AI-blocked states, no-API static pages), production build, real
  web/worker restart smoke (queued PDF recovery, session invalidation,
  content-free output).
- **Actual-AI evidence:** `npm run ai:smoke` three live probes green
  (connectivity, a parsed 5-topic plan draft, a validated 3-item starting
  check), recorded at `.local/ai-smoke-latest.json`; provider-claimed token
  ledger within the owner cap.
- **F-gate evidence attached:** F1 — the accepted runtime-security exception
  stands recorded (runtime-preflight.md; NOT closed); F2 — extraction
  admission/audit/fingerprint live (digest of record
  `06f95905…`, docs/bounded-document-extraction.md); F3 — owner-admitted
  processor evidence (memlog 25–28; terms WAIVED by owner decision, no
  compliance claim); F5 — export/deletion/retention/restore suites + the
  recorded Manual backup/restore drill (docs/backup-restore.md); F6 — NOT
  claimed, lives in entry 14.

## Honest boundary

Local synthetic evidence only. No deployment, no managed hosting, no real
personal data, no F1-closed or release-readiness claim. Epic closure beyond
this entry waits on entry 14's separate authorization.
