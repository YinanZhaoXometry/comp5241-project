---
title: "Screenshot-ready study prototype"
type: "feature"
ticket: ""
created: "2026-10-21"
status: "in-review"
baseline_revision: "027798d899001210255646fd496626da1766a7b1"
route: "full"
route_source: "auto"
risk: "medium"
review: "quick"
review_source: "pinned"
lenses_ran: []
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The user needs attractive screenshots of the learning platform for a professor, not live AI or complete later-epic implementation. The working application currently ends at a Manual confirmed study plan.

**Approach:** Build an isolated, immediately accessible sample study experience: dashboard, unit-testing mini-course lesson, interactive practice with prewritten feedback, and illustrative progress. Provide direct local URLs and a polished, coherent visual identity suitable for screenshots.

## Boundaries & Constraints

**Always:** Clearly show “Sample prototype · No live AI” on every demo screen; label illustrative progress as sample data. Use synthetic, original educational content, local assets, accessible controls, keyboard focus and responsive layouts. Preserve the working root journey, global security headers, all existing checks and dormant provider isolation. Keep interaction state in memory; refreshing resets practice. Preserve the user's existing development-type imports untouched and uncommitted, as reconfirmed for this task. Use the supported project runtime and loopback listeners.

**Never:** Call providers, create accounts, spend money, deploy, process real data, read private credentials, write academic records, connect demo screens to auth/database/worker, or advance tickets. Do not claim AI generation, real mastery or instructor approval. Do not narrow the final assignment scope or weaken quality/security gates. No remote assets or additional dependencies are needed.

## I/O & Edge-Case Matrix

| Scenario              | Input / State                                         | Expected Output / Behavior                                             | Error Handling                      |
| --------------------- | ----------------------------------------------------- | ---------------------------------------------------------------------- | ----------------------------------- |
| Entry/navigation      | Open `/demo` or a direct lesson/practice/progress URL | Complete labeled sample screen, active navigation and meaningful links | Unknown demo view returns not found |
| Practice empty        | No answer selected                                    | Check-answer action unavailable; clear prompt                          | No invented answer or feedback      |
| Practice correct      | Select boundary-test answer, check                    | Prewritten explanation; visibly assisted practice, no score award      | Answer locked until retry           |
| Practice incorrect    | Select distractor, check                              | Supportive explanation and retry                                       | No false completion                 |
| Retry/refresh         | Retry or reload practice                              | Clear selection/feedback; original sample progress unchanged           | No persistence implied              |
| Small screen/keyboard | 360px and keyboard navigation                         | No horizontal overflow; usable focus, radio inputs and links           | Reduced-motion preference respected |
| Isolation             | Navigate and use practice                             | No API/provider/external requests or browser errors                    | Existing root remains unchanged     |

</frozen-after-approval>

## Code Map

- `src/app/page.tsx`, `study-app.tsx`, `plan-editor.tsx`: working authenticated tracer; do not alter or import into demo.
- `src/app/globals.css`: broad body/button/form styles; preserve and override only inside a demo CSS Module scope.
- `src/app/layout.tsx`, `next.config.ts`: shared root and restrictive local-only CSP; preserve. Demo supplies route metadata.
- `src/app/demo/`: new self-contained demo shell, sample views and optional catch-all route with explicit allowed views.
- `tests/browser/tracer.spec.ts`, `playwright.config.ts`: preserve ten tracer cases and existing production web/worker harness; put demo coverage in a separate file.
- `package.json`: existing lint, boundaries, both typechecks, Vitest and Playwright gates; no dependency change.
- `README.md`, `AGENTS.md`: document screenshot URLs, sample limitations and current narrow authorization.
- `next-env.d.ts`: unrelated authorized development imports; never include in this commit. Avoid simultaneous production/development generated type caches.

## Tasks & Acceptance

**Execution:**

- [x] Add browser tests for direct navigation, labels, practice states, refresh, keyboard/mobile and request isolation; observe expected failure before implementation.
- [x] Add isolated demo routing/shell and original sample content; reject unknown views and use local navigation.
- [x] Implement responsive CSS Module styling, educational lesson diagrams and deterministic practice feedback without backend dependencies.
- [x] Document exact screenshot entry points and scope; leave ticket metadata unchanged.
- [x] Run full gates, inspect rendered desktop/mobile screens, capture useful sample screenshots and leave a loopback preview available.
- [ ] Independently review the diff, correct concrete findings, verify again and make a local conventional commit excluding the user's existing change; never push.

**Acceptance Criteria:**

- A professor can understand the proposed study loop from four coherent screenshots without signing in or mistaking sample content for working AI.
- Every visible action either navigates or performs an honest local interaction; no fake generation or dead primary controls.
- Existing tracer checks remain green, provider remains dormant, and shared app/security behavior is unchanged.

## Implementation Notes

- Seven new route-local files provide the validated optional catch-all, common shell/metadata/404, server-rendered original sample views, a single ephemeral practice client and scoped CSS. No tracer, contract, provider, worker or database implementation was changed. Four direct URLs, all labels, deterministic answer locking/retry and the study loop have passing browser coverage.
- The isolated suite has twelve tests. Initial RED was a real 404 for `/demo`; subsequent rendered-style/mobile checks caught empty CSS Module exports instead of accepting an unstyled functional page. The approved loader exception made all twelve pass; no check was suppressed. Progress comparison uses rendered text consistently before and after navigation.
- Full-page desktop/mobile images were inspected for typography, diagram clarity and layout; mobile navigation was refined to four equal usable columns. A hidden desktop line break's missing mobile space and auto-scrolled feedback capture were corrected, then the entire gate passed again. Final images are copied to ignored `.local/demo-screenshots/` (four desktop, four mobile, one feedback).
- User development imports were restored byte-for-byte (SHA256 `0f70629890b72a0a82e91972cc032c04b658b26c265373cb711cf576bfbf8fcc`), excluded from staging, with development cache restored and inactive production declarations preserved under ignored local verification storage. Both compiler gates passed again. No dependency, ticket or policy changes.

## Plan Change Log

- 2026-10-21: Runtime inspection and the desktop-style/mobile regressions proved that the existing Tailwind `*.css` rule erased CSS Module exports. Demo-only import attributes did not fix it. The user explicitly approved **“Allow the narrow loader exception”**: exclude `*.module.css` from that loader so native CSS Modules work. Preserve the existing root stylesheet processing, every security header and all quality gates. This is the sole exception to the Code Map's shared-configuration preservation instruction; no dependency changes.

## Review Triage Log

- Quick review pending: this session has no subagent/independent-review capability. No independent lens has run (`lenses_ran: []`). The standalone Quick handoff beside this plan embeds the plan, repository rules and complete change diff for a separate session. Per the review workflow, halt here rather than misrepresent self-inspection as independent review or create the reviewed local commit. No findings are asserted or deferred before that reviewer reports.

## Design Notes

Use the established Fieldnotes identity with warm paper, deep forest ink, lime accents, editorial serif headings and restrained technical diagrams. A persistent sidebar, compact sample banner, clear page hierarchy and consistent course context tie screenshots together. Roadmap nodes represent whole mini-courses, not lessons; progress separates sample content completion from test/recovery status. Avoid rewards, hard locks and unsupported mastery claims. Include concise project-specific 4D context without claiming an implemented assessment feature.

Official references checked: Next CSS Modules for scoped styling; App Router optional catch-all segments with awaited params and runtime validation; React useState for pure ephemeral interaction state.

## Verification

- Focused Playwright demo tests: fail on missing screens, then pass after implementation.
- `npm run checks`: audit, lint coverage, boundaries, both typechecks, unit tests, sandbox, isolated PG integration, production build, all browser cases and process restart pass. Preserve inactive type caches, generate production declarations before checks, then restore user's development imports/cache and recheck types.
- Inspect desktop and 360px browser output, feedback and navigation; capture only synthetic demo screens, never credentials.

### Measured result · 2026-10-21

- Initial RED: direct `/demo` returned HTTP404 before implementation. Final separate demo suite: 12/12 passed. All seven matrix rows are covered by tests that ran: direct entries/navigation/404; empty/correct locked practice; both distractors/retry; refresh and unchanged sample progress; keyboard/reduced-motion/320–1440px no overflow; no API/external/failed requests or browser errors, plus all ten unchanged root tracer cases.
- Full `npm run checks` passed twice, including the final source/test corrections: audit0; 113 lint mappings with eight negative and JSX positive probes; transitive provider/module boundaries; both typechecks; unit106; sandbox denial probe; isolated PG startup/migrations/integration15; production build; Chromium22 (demo12 + tracer10); real-process web/worker stop/restart with exact persistence and actor denial. No skips, overrides or suppressed gates.
- After the final full gate, restored the original development imports/cache and both typechecks passed again. Rendered desktop/360px sample screens and feedback inspected; only synthetic demo PNGs copied. Loopback-only production screenshot preview: http://127.0.0.1:3100/demo (and `/lesson`, `/practice`, `/progress`). No worker is required for the demo preview.
- Incomplete: independent Quick review, any resulting triage/reverification and the reviewed conventional local commit. Nothing pushed. Existing Node runtime-security exception remains local/synthetic-only; no release/provider/privacy admission follows from these checks.
