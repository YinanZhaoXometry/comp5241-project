# Standalone Quick review handoff

Read the inline plan below — the plan holding the acceptance criteria and intent — and the files its frontmatter `context:` lists. Read the inline agent instruction files below (`AGENTS.md`, `CLAUDE.md`, or equivalents) at the repository root and in the directories the diff touches; those are the rules. Then read the inline unified diff below — it is the change under review.

Report unmet acceptance criteria, broken rules, and bugs. Each finding: the location, what goes wrong, and evidence checked against the surrounding code. Output a Markdown list of findings only — no severity, priority, or ranking.

Review by inspection only. Do not modify code, run builds or tests, or invoke quality gates. Do not invoke any skill, and do not spawn subagents of your own — you are the reviewer. Return your findings as text in your final message; do not route them through any findings-reporting tool the host may offer.

## Inline plan

---

title: 'Screenshot-ready study prototype'
type: 'feature'
ticket: ''
created: '2026-10-21'
status: 'in-review'
baseline_revision: '027798d899001210255646fd496626da1766a7b1'
route: 'full'
route_source: 'auto'
risk: 'medium'
review: 'quick'
review_source: 'pinned'
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

## Inline repository instructions: AGENTS.md (only matching instruction file)

# AGENTS.md

## Project Purpose

GenAI-powered learning platform for COMP5241 (PolyU software engineering course project). Read `project-overview.md` at the workspace root before doing any work — it is the authoritative requirements source.

## Current State

Story 1 has a running, independently reviewed local synthetic TXT-to-Manual-confirmed-plan tracer. Review findings were fixed with regression coverage; final checks passed: unit4, PG15, browser10, real-process restart, audit0, lint and both typechecks. The active BMad initiative is `_bmad-output/initiative-ai-learning-platform/`; `private-study-setup` is refined with thirteen entries and five other epics remain unrefined. The latest user instruction on 2026-10-21 is **Replace the lint stack, preserve the required checks, and continue Story 1 locally with synthetic data only.** It supersedes the prior preset pause. Supported ESLint10/typescript-eslint/hooks plus native Oxlint replace the vulnerable Next preset;113 prior rule entries and negative probes preserve coverage. Real web/worker/auth/private storage/PG18 migrations and narrow root deletion exist; full later-epic AI/lifecycle work does not. Canonical plan baseline remains unchanged; ticket metadata has not been advanced. Read README and plan/preflight for exact results/limitations; local passes do not close F1's accepted runtime-security exception or authorize release.

## Local implementation commands

- The 2026-10-21 screenshot-only plan additionally authorizes an isolated unauthenticated `/demo`, `/demo/lesson`, `/demo/practice`, `/demo/progress` sample and local screenshot preview. Read `plan-screenshot-study-prototype.md` under the active initiative. Original synthetic content, prewritten assisted feedback and illustrative progress only; no auth/database/worker/provider imports or calls, credentials, records, real-data processing, deployment or ticket advancement. Keep the “Sample prototype · No live AI” label on every demo screen. Practice state is memory-only and resets on retry/refresh; sample progress never changes. The user explicitly approved the narrow `*.module.css` exclusion from the global Tailwind loader after runtime tests proved that it erased CSS Module exports; preserve root CSS processing and all security headers. No new dependency. Twelve separate demo browser cases supplement, never replace, the ten tracer cases. Screenshot URLs and local artifact locations are in README.
- The 2026-10-21 adapter-only plan additionally authorizes a dormant OpenAI-compatible foundation with synthetic transport tests and dependency installation. Read `docs/ai-provider-adapter.md` for its strict configuration/protocol limits and activation prerequisites. No web/worker wiring, UI/routes/jobs/database changes, live calls, policy changes or ticket advancement are authorized. Missing transport must block before SDK construction or ambient credential reads; never use the previously exposed key. This is not S3 admission or S6 working AI and does not establish coding-subscription product eligibility.
- Foundation implementation passed the full local synthetic gate (unit106/PG15/browser10/restart, audit0, lint and both typechecks); independent Quick review's two findings were reproduced, fixed and independently rechecked, with no deferrals. Preserve the authorized `next-env.d.ts` development imports uncommitted. Next's development/production route declarations conflict if both caches are present; preserve the inactive ignored cache, generate matching production imports with `next typegen` before production checks, then restore the user's development imports/cache. Never suppress checks or change compiler gates to bypass the mismatch.

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

## Inline instruction dependency: project-overview.md

The objectives of this project are to develop a GenAI-powered learning platform with learning contents and activities.

- Develop mini-courses with interactive learning contents and activities to makes the learning of software development and engineering more interactive, engaging and fun.
  - The following topics should be covered: Fundamentals of software engineering and development, effective use of AI coding agents in software development, soft and product skills in software development, etc.
  - Formats of learning content and activities: text and images, interactive simulations, interactive role play or mock interviews, games/mini-games, AI-narrated animations and slides, online coding, etc.
- Use AI to teach the learners and provide a personalized learning and tailored learning content to engage students from different backgrounds and learning goals. For instance, the content should be accessible to non-Computer Science majors who want to understand software development and software engineering, as well as to Computer Science graduates preparing for careers in related fields in the age of AI.
- Instructors should be able to customize (manually or using AI) the learning contents and activities of the existing mini-courses. They can also use AI to develop new mini-courses by inputting their own topics, requirements, and teaching content, and refining learning content and activities. They can import their students into their courses and track students’ participation and engagement in learning activities.
- Allow the user to generate mini-courses for other subjects/domains and let learners generate their own topics and path for self-learning.

Anthropic’s defines “AI Fluency” as the ability to collaborate with AI systems effectively, efficiently, and responsibly. Its 4D framework breaks this into four competencies: Delegation (deciding what to hand to AI), Description (clearly specifying goals, constraints, and process), Discernment (critically evaluating AI outputs and reasoning), and Diligence (verifying, documenting, and taking accountability for results). In this project, each team should study the AI Fluency framework, explain how it can be applied to your project and share these reflections in your final presentation.

## Inline unified diff

```diff
diff --git a/AGENTS.md b/AGENTS.md
--- a/AGENTS.md
+++ b/AGENTS.md
@@ -10,6 +10,7 @@

 ## Local implementation commands

+- The 2026-10-21 screenshot-only plan additionally authorizes an isolated unauthenticated `/demo`, `/demo/lesson`, `/demo/practice`, `/demo/progress` sample and local screenshot preview. Read `plan-screenshot-study-prototype.md` under the active initiative. Original synthetic content, prewritten assisted feedback and illustrative progress only; no auth/database/worker/provider imports or calls, credentials, records, real-data processing, deployment or ticket advancement. Keep the “Sample prototype · No live AI” label on every demo screen. Practice state is memory-only and resets on retry/refresh; sample progress never changes. The user explicitly approved the narrow `*.module.css` exclusion from the global Tailwind loader after runtime tests proved that it erased CSS Module exports; preserve root CSS processing and all security headers. No new dependency. Twelve separate demo browser cases supplement, never replace, the ten tracer cases. Screenshot URLs and local artifact locations are in README.
 - The 2026-10-21 adapter-only plan additionally authorizes a dormant OpenAI-compatible foundation with synthetic transport tests and dependency installation. Read `docs/ai-provider-adapter.md` for its strict configuration/protocol limits and activation prerequisites. No web/worker wiring, UI/routes/jobs/database changes, live calls, policy changes or ticket advancement are authorized. Missing transport must block before SDK construction or ambient credential reads; never use the previously exposed key. This is not S3 admission or S6 working AI and does not establish coding-subscription product eligibility.
 - Foundation implementation passed the full local synthetic gate (unit106/PG15/browser10/restart, audit0, lint and both typechecks); independent Quick review's two findings were reproduced, fixed and independently rechecked, with no deferrals. Preserve the authorized `next-env.d.ts` development imports uncommitted. Next's development/production route declarations conflict if both caches are present; preserve the inactive ignored cache, generate matching production imports with `next typegen` before production checks, then restore the user's development imports/cache. Never suppress checks or change compiler gates to bypass the mismatch.

diff --git a/README.md b/README.md
--- a/README.md
+++ b/README.md
@@ -16,6 +16,62 @@
 requires separate eligibility, consent/lineage, durable accounting and operator
 authorization. Coding subscription benefits do not establish product eligibility.

+## Screenshot-ready sample study experience
+
+The separate [screenshot prototype plan](_bmad-output/initiative-ai-learning-platform/plan-screenshot-study-prototype.md)
+authorizes an unauthenticated, original-content sample under `/demo`. It does not
+replace the working private tracer at `/` or implement the later GenAI epics.
+Every sample screen is labeled **Sample prototype · No live AI**.
+
+With the local web server running, the four direct screenshot entry points are:
+
+| View | Normal local URL | Screenshot preview URL (port 3100) |
+| --- | --- | --- |
+| Overview and whole-mini-course roadmap | http://127.0.0.1:3000/demo | http://127.0.0.1:3100/demo |
+| Unit-testing lesson and boundary diagram | http://127.0.0.1:3000/demo/lesson | http://127.0.0.1:3100/demo/lesson |
+| Assisted multiple-choice practice | http://127.0.0.1:3000/demo/practice | http://127.0.0.1:3100/demo/practice |
+| Illustrative progress and separate test/recovery status | http://127.0.0.1:3000/demo/progress | http://127.0.0.1:3100/demo/progress |
+
+The preview uses the same production build with `npm run start -- --port 3100`;
+it still binds only to loopback. The demo itself needs **no sign-in, database,
+worker, provider configuration or private credentials**. Follow the existing
+runtime selection below before running commands. The full verification harness
+continues to start the real tracer web/worker and isolated synthetic database.
+
+The lesson explains an original free-delivery threshold example. Practice feedback
+is prewritten, visibly assisted and unscored. Check-answer requires a selection,
+locks the answer after checking, and supports retry. Retry or refresh clears all
+practice state; no browser storage or backend is used. Progress is fixed **sample
+data**, not measured learning, passed tests or a mastery claim. Future roadmap
+mini-courses are labeled unbuilt, not fake controls or locked courses. AI Fluency
+4D context is a presentation aid, not a working assessment or instructor approval.
+
+Demo code lives entirely under [src/app/demo](src/app/demo/[[...view]]/page.tsx).
+It imports no tracer/auth/database/worker/provider services. Styles use a CSS
+Module; the explicitly user-approved loader exception excludes only module CSS
+from the global Tailwind transform, preserving root styles and security headers.
+Unknown or nested views return a labeled 404. No dependency was added and no
+ticket metadata was advanced.
+
+[Demo browser coverage](tests/browser/demo.spec.ts) adds twelve cases without
+changing the ten tracer cases or their production harness. It covers direct URLs,
+labels/active navigation/actual scoped styling, unknown views, empty/correct/both
+incorrect answers, answer locking, retry/refresh, unchanged sample progress,
+navigation, keyboard/reduced-motion behavior, 320/360/768/1440px layouts and no
+API/external/failed requests or browser errors. The four direct-entry cases write
+full-page desktop (1440px) and mobile (360px) PNGs to their ignored `test-results/`
+directories; a separate case captures feedback. A convenience copy of the final
+synthetic screenshot set is kept locally under `.local/demo-screenshots/`, not
+committed or uploaded.
+
+The full local gate on 2026-10-21 passed: audit0, the existing 113-rule lint
+coverage/probes, module/provider boundaries, both typechecks, 106 unit tests,
+15 PostgreSQL tests, sandbox confinement, production build, all **22 browser
+cases** (12 demo + 10 unchanged tracer) and real web/worker restart. The user's
+original development imports/cache were restored byte-for-byte and both
+typechecks passed again. Independent Quick review and the reviewed local commit
+remain pending; test results alone do not satisfy that separate review step.
+
 ## Local prerequisites and operation

 macOS arm64 only for this first TXT sandbox. Verified Node24.22.0/npm11.19.1 is

diff --git a/next.config.ts b/next.config.ts
--- a/next.config.ts
+++ b/next.config.ts
@@ -3,7 +3,7 @@
 const nextConfig: NextConfig = {
   poweredByHeader: false,
   turbopack: {
-    rules: { "*.css": { loaders: ["@tailwindcss/turbopack"], as: "*.css" } },
+    rules: { "*.css": { condition: { not: { path: "*.module.css" } }, loaders: ["@tailwindcss/turbopack"], as: "*.css" } },
   },
   async headers() {
     return [{ source: "/:path*", headers: [

diff --git a/src/app/demo/[[...view]]/page.tsx b/src/app/demo/[[...view]]/page.tsx
new file mode 100644
--- /dev/null
+++ b/src/app/demo/[[...view]]/page.tsx
@@ -0,0 +1,32 @@
+import type { Metadata } from "next";
+import { notFound } from "next/navigation";
+import { DemoShell, type DemoView } from "../demo-shell";
+import { Overview, Lesson, Progress } from "../sample-views";
+import { Practice } from "../practice";
+
+type Props = { params: Promise<{ view?: string[] }> };
+
+function resolveView(segments: string[] | undefined): DemoView | null {
+  if (!segments?.length) return "overview";
+  if (segments.length !== 1) return null;
+  const view = segments[0];
+  return view === "lesson" || view === "practice" || view === "progress" ? view : null;
+}
+
+export async function generateMetadata({ params }: Props): Promise<Metadata> {
+  const view = resolveView((await params).view);
+  return { title: view ? view.charAt(0).toUpperCase() + view.slice(1) : "Page not found" };
+}
+
+export default async function DemoPage({ params }: Props) {
+  const view = resolveView((await params).view);
+  if (!view) notFound();
+  return (
+    <DemoShell active={view}>
+      {view === "overview" && <Overview />}
+      {view === "lesson" && <Lesson />}
+      {view === "practice" && <Practice />}
+      {view === "progress" && <Progress />}
+    </DemoShell>
+  );
+}

diff --git a/src/app/demo/demo-shell.tsx b/src/app/demo/demo-shell.tsx
new file mode 100644
--- /dev/null
+++ b/src/app/demo/demo-shell.tsx
@@ -0,0 +1,56 @@
+import Link from "next/link";
+import styles from "./demo.module.css";
+
+export type DemoView = "overview" | "lesson" | "practice" | "progress";
+const navigation = [
+  { view: "overview", label: "Overview", href: "/demo", mark: "01" },
+  { view: "lesson", label: "Lesson", href: "/demo/lesson", mark: "02" },
+  { view: "practice", label: "Practice", href: "/demo/practice", mark: "03" },
+  { view: "progress", label: "Progress", href: "/demo/progress", mark: "04" },
+] as const;
+
+export function DemoShell({ active, children }: Readonly<{ active: DemoView | null; children: React.ReactNode }>) {
+  return (
+    <div className={styles.demo}>
+      <a className={styles.skip} href="#sample-content">Skip to sample content</a>
+      <aside className={styles.sidebar}>
+        <Link className={styles.brand} href="/demo" prefetch={false} aria-label="Fieldnotes sample overview">
+          <svg viewBox="0 0 32 36" width="28" height="32" aria-hidden="true"><path d="M4 3h24v30H4zM11 3v30M16 11h7M16 17h7M16 23h4" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>
+          <span>Fieldnotes<span className={styles.brandCaption}>A LITTLE MORE UNDERSTOOD.</span></span>
+        </Link>
+        <p className={styles.navLabel}>YOUR STUDY SPACE</p>
+        <nav aria-label="Sample study" className={styles.nav}>
+          {navigation.map(item => (
+            <Link key={item.view} href={item.href} prefetch={false} aria-current={active === item.view ? "page" : undefined}>
+              <span className={styles.navNumber} aria-hidden="true">{item.mark}</span>{item.label}
+              {active === item.view && <span className={styles.navArrow} aria-hidden="true">↗</span>}
+            </Link>
+          ))}
+        </nav>
+        <div className={styles.sidebarNote}>
+          <span className={styles.overline}>THE IDEA</span>
+          <p>Not more content.<br />More moments of clarity.</p>
+          <span className={styles.muted}>Learn a little. Try it out. Find the gap. Come back stronger.</span>
+        </div>
+        <div className={styles.sidebarBottom}>
+          <span className={styles.overline}>COMP5241 · POLYU</span>
+          <p>Software engineering,<br />one useful idea at a time.</p>
+          <Link href="/" prefetch={false}>Open private study tracer ↗</Link>
+        </div>
+      </aside>
+      <div className={styles.workspace}>
+        <header className={styles.topbar}>
+          <span>Learning lab <span aria-hidden="true">/</span> Unit testing</span>
+          <span className={styles.sampleBadge}>Sample prototype · No live AI</span>
+        </header>
+        <main id="sample-content" tabIndex={-1} className={styles.main}>
+          {children}
+          <footer className={styles.footer}>
+            <span>Original sample content. No academic records, AI generation or instructor approval.</span>
+            <span>AI Fluency 4D · A presentation lens, not an implemented assessment.</span>
+          </footer>
+        </main>
+      </div>
+    </div>
+  );
+}

diff --git a/src/app/demo/demo.module.css b/src/app/demo/demo.module.css
new file mode 100644
--- /dev/null
+++ b/src/app/demo/demo.module.css
@@ -0,0 +1,246 @@
+.demo {
+  --demo-ink: #193c36;
+  --demo-muted: #52635d;
+  --demo-paper: #f7f6f1;
+  --demo-surface: #fffefa;
+  --demo-line: #d7dfd6;
+  --demo-lime: #d8e88c;
+  --demo-soft: #edf0e6;
+  display: grid;
+  grid-template-columns: 240px minmax(0, 1fr);
+  min-height: 100vh;
+  color: var(--demo-ink);
+  background: var(--demo-paper);
+  font-size: 14px;
+  line-height: 1.6;
+}
+
+.demo h1 { font: 400 clamp(2rem, 3.1vw, 3.25rem)/1.1 Georgia, serif; letter-spacing: -.045em; margin: .75rem 0 1rem; text-wrap: balance; }
+.demo h2 { font: 400 1.75rem/1.2 Georgia, serif; letter-spacing: -.025em; margin: .5rem 0 1rem; }
+.demo h3 { font-size: 1rem; font-weight: 600; letter-spacing: -.015em; margin: .5rem 0; }
+.demo p { margin: .5rem 0 1rem; }
+.demo a { text-decoration-thickness: 1px; }
+.demo :is(a, button, input):focus-visible { outline: 3px solid #486600; outline-offset: 4px; }
+.demo code { font: .85em/1.7 ui-monospace, SFMono-Regular, Consolas, monospace; overflow-wrap: anywhere; }
+.demo :is(button, a) { -webkit-tap-highlight-color: transparent; }
+.workspace, .main, .demo section, .demo article, .demo aside { min-width: 0; }
+.skip { position: absolute; z-index: 10; top: -100px; left: 1rem; padding: .75rem; background: var(--demo-surface); }
+.skip:focus { top: 1rem; }
+.sidebar { position: sticky; top: 0; height: 100vh; overflow-y: auto; padding: 2rem 1.5rem; background: var(--demo-soft); border-right: 1px solid var(--demo-line); display: flex; flex-direction: column; }
+.brand { display: flex; align-items: center; gap: .75rem; text-decoration: none; font: 1.75rem Georgia, serif; min-height: 44px; }
+.brandCaption { display: block; font: 600 .5rem/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; letter-spacing: .12em; margin-top: .5rem; }
+.navLabel, .overline { font-size: .625rem; font-weight: 700; letter-spacing: .14em; }
+.navLabel { color: var(--demo-muted); margin: 3rem 0 1rem !important; }
+.nav { display: grid; gap: .5rem; }
+.nav a { display: flex; align-items: center; gap: 1rem; min-height: 48px; padding: .75rem; text-decoration: none; border: 1px solid transparent; border-radius: .25rem; }
+.nav a:hover { background: var(--demo-surface); }
+.nav a[aria-current=page] { background: var(--demo-ink); color: var(--demo-surface); }
+.navNumber { font: .7rem ui-monospace, monospace; opacity: .8; }
+.navArrow { margin-left: auto; color: var(--demo-lime); }
+.sidebarNote { margin-top: 3rem; padding: 1.5rem 0; border-top: 1px solid #c6d0c3; }
+.sidebarNote > p { font: 1.4rem/1.3 Georgia, serif; }
+.sidebarNote .muted { font-size: .75rem; }
+.sidebarBottom { margin-top: auto; padding-top: 2rem; font-size: .7rem; }
+.sidebarBottom a { display: inline-flex; align-items: center; min-height: 44px; }
+.topbar { padding: 1.25rem clamp(1.5rem, 3.5vw, 3.5rem); min-height: 80px; display: flex; align-items: center; justify-content: space-between; gap: 1rem; flex-wrap: wrap; border-bottom: 1px solid var(--demo-line); font-size: .75rem; }
+.topbar > span:first-child { color: var(--demo-muted); }
+.topbar > span:first-child > span { margin: 0 .75rem; }
+.sampleBadge { display: inline-block; padding: .375rem .75rem; background: var(--demo-lime); color: var(--demo-ink); border: 1px solid #b7cc6c; border-radius: 2rem; font-size: .7rem; font-weight: 600; }
+.main { max-width: 1400px; margin: auto; padding: 2.5rem clamp(1.5rem, 3.5vw, 3.5rem) 1.5rem; }
+.main:focus { outline: none; }
+.pageHeading { margin-bottom: 2rem; }
+.lead { color: var(--demo-muted); font-size: .95rem; max-width: 48rem; }
+.muted { color: var(--demo-muted); font-size: .75rem; }
+.hero { display: grid; grid-template-columns: 1.2fr 1fr; gap: 2rem; padding: 2rem 2.5rem; background: var(--demo-ink); color: var(--demo-surface); border-radius: .375rem; }
+.heroLabel, .diagramTitle { color: var(--demo-lime); font-size: .625rem; letter-spacing: .14em; font-weight: 600; }
+.hero h2 { font-size: clamp(2rem, 2.7vw, 3rem); margin: 1rem 0; letter-spacing: -.04em; }
+.hero p { max-width: 28rem; color: #dbe4db; font-size: .85rem; }
+.hero .heroMeta { font-size: .65rem; margin: 1rem 0 0; }
+.primary, .limeButton, .secondary { display: inline-flex; align-items: center; justify-content: center; gap: 1.5rem; padding: .75rem 1.125rem; min-height: 44px; font: 600 .8rem/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; text-decoration: none; border: 1px solid var(--demo-ink); border-radius: .25rem; background: var(--demo-ink); color: var(--demo-surface); }
+.limeButton { background: var(--demo-lime); color: var(--demo-ink); border-color: var(--demo-lime); margin-top: .5rem; }
+.secondary { color: var(--demo-ink); background: transparent; }
+.demo .primary:hover, .limeButton:hover, .secondary:hover { filter: none; text-decoration: underline; }
+.demo .primary:disabled { opacity: 1; color: #53645c; background: #e2e7db; border-color: #aab5a5; text-decoration: none; }
+.loopDiagram { margin: 0; padding: .5rem 0 .5rem 2rem; border-left: 1px solid #577067; align-self: center; }
+.loopDiagram > div { display: grid; grid-template-columns: 2rem 1fr; padding: .75rem 0; border-bottom: 1px solid #577067; }
+.loopDiagram > div > span { grid-row: span 2; color: var(--demo-lime); font: .75rem/1.8 ui-monospace, monospace; }
+.loopDiagram strong { font: 1.4rem Georgia, serif; }
+.loopDiagram small { font-size: .7rem; color: #dbe4db; }
+.loopDiagram figcaption { margin-top: 1rem; font-size: .65rem; color: #dbe4db; }
+.focusStrip { display: flex; align-items: center; gap: 2rem; padding: 1.5rem 0; border-bottom: 1px solid var(--demo-line); }
+.focusStrip > div { flex: 1; }
+.focusStrip strong { display: block; font-size: .875rem; }
+.focusStrip > p { flex: 1; font-size: .75rem; color: var(--demo-muted); margin: 0; }
+.pill { display: inline-block; width: fit-content; padding: .25rem .625rem; border: 1px solid #bfccae; border-radius: 2rem; font-size: .625rem; font-weight: 600; background: var(--demo-soft); }
+.section { margin-top: 2rem; }
+.sectionHeader { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: baseline; gap: .5rem 1rem; margin-bottom: 1rem; }
+.sectionHeader h2 { margin: .5rem 0 0; }
+.sectionHeader p { margin: 0; }
+.roadmap { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); padding: 0; list-style: none; border: 1px solid var(--demo-line); border-radius: .375rem; overflow: hidden; }
+.roadmap li { padding: 1.5rem; background: var(--demo-surface); }
+.roadmap li + li { border-left: 1px solid var(--demo-line); }
+.roadmap .currentCourse { background: #edf2d8; }
+.courseNumber { font: 600 .6rem/1.6 -apple-system, sans-serif; letter-spacing: .08em; color: var(--demo-muted); }
+.roadmap h3 { margin: .75rem 0; font: 1.25rem Georgia, serif; }
+.roadmap p { font-size: .75rem; color: var(--demo-muted); }
+.roadmap a { display: inline-flex; align-items: center; min-height: 44px; font-size: .75rem; font-weight: 600; }
+.fluency { margin-top: 2rem; display: grid; grid-template-columns: 1fr 1.5fr; gap: 2rem; border-top: 1px solid var(--demo-line); padding-top: 1.5rem; }
+.fluency h2 { font-size: 1.5rem; margin-bottom: .5rem; }
+.fluency p { font-size: .75rem; color: var(--demo-muted); }
+.fourDs { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1rem 1.5rem; margin: 0; }
+.fourDs dt, .fourDs dd { min-width: 0; overflow-wrap: anywhere; }
+.fourDs dt { font-size: .8rem; font-weight: 600; }
+.fourDs dd { margin: .25rem 0 0; font-size: .75rem; color: var(--demo-muted); }
+.footer { display: flex; flex-wrap: wrap; justify-content: space-between; gap: .5rem 1.5rem; margin-top: 2.5rem; padding-top: 1rem; border-top: 1px solid var(--demo-line); color: var(--demo-muted); font-size: .625rem; }
+.footer span { display: block; }
+.lessonGrid { display: grid; grid-template-columns: minmax(0, 1.8fr) minmax(0, 1fr); gap: 2.5rem; }
+.lessonBody h2 { margin-top: 1.25rem; }
+.lessonBody p { font-size: .875rem; }
+.promise { border-left: 3px solid #9caf61; margin: 1.5rem 0; padding: .75rem 1.25rem; background: var(--demo-soft); font: 1.25rem/1.5 Georgia, serif; }
+.promise span { display: block; font: .75rem/1.6 -apple-system, sans-serif; margin-top: .5rem; }
+.code { background: var(--demo-ink); color: #eff3e4; padding: 1.25rem; border-radius: .25rem; white-space: pre-wrap; overflow-wrap: anywhere; font-size: .875rem; }
+.codeComment { color: var(--demo-lime); }
+.boundaryFigure { margin: 1.5rem 0 0; padding: 1.5rem; border: 1px solid var(--demo-line); background: var(--demo-surface); }
+.boundaryLine { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); text-align: center; }
+.boundaryLine > div { display: flex; flex-direction: column; align-items: center; gap: .5rem; border-top: 1px solid #aab79e; padding: .75rem .25rem; }
+.boundaryLine span { display: grid; place-items: center; width: 3rem; height: 3rem; border: 1px solid #bfccae; border-radius: 50%; font: 1.5rem Georgia, serif; background: var(--demo-paper); }
+.boundaryPoint span { background: var(--demo-lime); border-color: #879957; }
+.boundaryLine strong { font-size: .7rem; }
+.boundaryLine small { font-size: .625rem; color: var(--demo-muted); }
+.boundaryFigure figcaption { color: var(--demo-muted); font-size: .7rem; border-top: 1px solid var(--demo-line); padding-top: 1rem; margin-top: .5rem; }
+.lessonAction { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 1rem; margin-top: 1.5rem; }
+.lessonAction p { margin: 0; font-size: .8rem; }
+.notebook { align-self: start; border: 1px solid var(--demo-line); background: var(--demo-soft); padding: 1.5rem; border-radius: .25rem; }
+.notebook h2 { margin: 1rem 0; font-size: 2rem; }
+.aaa { list-style: none; padding: 0; }
+.aaa li { display: flex; align-items: start; gap: .75rem; padding: 1rem 0; border-top: 1px solid #c6d0c3; }
+.aaa li > span { width: 1.5rem; height: 1.5rem; display: grid; place-items: center; background: var(--demo-ink); color: var(--demo-lime); border-radius: 50%; font-size: .7rem; flex-shrink: 0; }
+.aaa li > div { min-width: 0; }
+.aaa h3 { margin: 0 0 .25rem; }
+.aaa p { font-size: .75rem; margin: .25rem 0; }
+.aaa code { font-size: .65rem; }
+.notebookTip { margin: 1rem 0; border-top: 1px solid #c6d0c3; padding-top: 1rem; }
+.notebookTip strong, .notebookTip p { font-size: .8rem; }
+.practiceGrid { display: grid; grid-template-columns: minmax(0, 1.8fr) minmax(0, 1fr); gap: 2rem; align-items: start; }
+.practiceCard { padding: 2rem; background: var(--demo-surface); border: 1px solid var(--demo-line); border-radius: .375rem; }
+.practiceCard h2 { margin-top: 1.25rem; }
+.practiceCard > p { font-size: .875rem; }
+.ruleNote { display: grid; gap: .5rem; padding: 1rem 1.25rem; background: var(--demo-soft); border-left: 3px solid #9caf61; margin: 1.5rem 0; }
+.ruleNote strong { font: .8rem/1.8 ui-monospace, monospace; }
+.ruleNote > span:last-child { font-size: .7rem; color: var(--demo-muted); }
+.practiceCard form { display: block; }
+.answers { border: 0; padding: 0; margin: 0; min-width: 0; }
+.answers legend { padding: 0; margin-bottom: 1rem; font-size: .875rem; font-weight: 600; }
+.answer, .selectedAnswer { display: flex; align-items: center; gap: .75rem; min-height: 64px; padding: 1rem !important; margin: .75rem 0 !important; border: 1px solid #aab79e; border-radius: .25rem; background: var(--demo-surface); cursor: pointer; }
+.selectedAnswer { background: #f0f5de; border: 2px solid #486600; padding: calc(1rem - 1px) !important; }
+.answer > input, .selectedAnswer > input { appearance: auto; width: 1.125rem; height: 1.125rem; flex: 0 0 1.125rem; padding: 0; margin: 0; accent-color: var(--demo-ink); }
+.answer > span, .selectedAnswer > span { font-size: .8rem; font-weight: 400; }
+.answerLetter { font: .7rem ui-monospace, monospace; color: var(--demo-muted); margin-right: .75rem; }
+.answers:disabled label { cursor: default; }
+.practiceActions { display: flex; align-items: center; flex-wrap: wrap; gap: .75rem; }
+.feedback { border-left: 3px solid #486600; background: var(--demo-soft); padding: 1rem 1.25rem; margin-top: 1.5rem; }
+.feedbackHeading { display: block; font-size: 1rem; margin-bottom: .5rem; }
+.feedbackBody { display: block; font-size: .8rem; margin-bottom: 1rem; }
+.feedbackMeta { display: block; font-size: .65rem; font-weight: 600; }
+.practiceAside { padding: 1rem 0; }
+.practiceAside h2 { font-size: 2.5rem; margin: 1rem 0; }
+.practiceAside p { font-size: .85rem; }
+.edgeSketch { display: flex; justify-content: space-around; align-items: center; border-top: 1px solid #aab79e; border-bottom: 1px solid #aab79e; padding: 1rem 0; margin: 2rem 0; font: 1.5rem Georgia, serif; }
+.edgeSketch strong { display: grid; place-items: center; width: 4rem; height: 4rem; border-radius: 50%; border: 1px solid #879957; background: var(--demo-lime); font-weight: 400; }
+.asideNote { margin-top: 1.5rem; border-top: 1px solid var(--demo-line); padding-top: 1rem; }
+.asideNote p { color: var(--demo-muted); font-size: .75rem; }
+.practiceAside > a { display: inline-flex; align-items: center; min-height: 44px; font-size: .75rem; font-weight: 600; }
+.bottomNav { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 1rem; padding-top: 1.5rem; margin-top: 1.5rem; border-top: 1px solid var(--demo-line); }
+.bottomNav p { max-width: 32rem; margin: 0; }
+.sampleNotice { display: flex; flex-wrap: wrap; align-items: baseline; gap: .5rem 1.5rem; padding: 1rem 1.25rem; background: var(--demo-soft); border: 1px solid var(--demo-line); border-radius: .25rem; margin-bottom: 1.5rem; font-size: .75rem; }
+.sampleNotice > span { color: var(--demo-muted); }
+.evidence { padding: 1.5rem 2rem; border: 1px solid var(--demo-line); border-radius: .375rem; background: var(--demo-surface); }
+.evidenceHeader { display: flex; flex-wrap: wrap; align-items: center; gap: 1rem; justify-content: space-between; border-bottom: 1px solid var(--demo-line); padding-bottom: 1rem; }
+.evidenceHeader h2, .evidenceHeader p { margin: .25rem 0; }
+.evidenceColumns { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 2rem; padding-top: 1.5rem; }
+.evidenceColumns > div + div { border-left: 1px solid var(--demo-line); padding-left: 1.5rem; }
+.evidenceColumns p { font-size: .75rem; }
+.evidenceColumns h3 { font: 1.5rem Georgia, serif; margin: 1rem 0; }
+.evidenceColumns .bigMetric { font: 2.5rem Georgia, serif; margin: .5rem 0; }
+.bigMetric span { font: .75rem -apple-system, sans-serif; color: var(--demo-muted); }
+.evidence meter { width: 100%; height: .75rem; accent-color: #486600; }
+.evidence meter::-webkit-meter-bar { background: var(--demo-soft); border: 0; }
+.evidence meter::-webkit-meter-optimum-value { background: #486600; }
+.progressGrid { display: grid; grid-template-columns: minmax(0, 1.7fr) minmax(0, 1fr); gap: 1.5rem; margin-top: 1.5rem; }
+.panel { padding: 1.5rem 2rem; background: var(--demo-surface); border: 1px solid var(--demo-line); border-radius: .375rem; }
+.coverage { list-style: none; padding: 0; margin: 1.5rem 0 0; }
+.coverage li { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 1rem; padding: 1rem 0; border-top: 1px solid var(--demo-line); }
+.coverage li > span { font-size: .65rem; color: var(--demo-muted); }
+.coverage strong { font-size: .8rem; }
+.coverage small { display: block; color: var(--demo-muted); font-size: .65rem; }
+.reflectionCard { padding: 1.5rem; background: var(--demo-soft); border-radius: .375rem; }
+.reflectionCard h2 { margin-top: 1rem; }
+.reflectionCard p { font-size: .8rem; }
+.reflectionCard a { display: flex; align-items: center; min-height: 44px; font-size: .75rem; font-weight: 600; }
+
+@media (min-width: 1700px) { .main { padding-top: 3rem; } }
+@media (max-width: 1100px) {
+  .demo { grid-template-columns: 200px minmax(0, 1fr); }
+  .sidebar { padding: 1.5rem 1rem; }
+  .hero { padding: 2rem; gap: 1.5rem; }
+  .loopDiagram { padding-left: 1.5rem; }
+  .practiceGrid, .lessonGrid { grid-template-columns: minmax(0, 1.5fr) minmax(0, 1fr); gap: 1.5rem; }
+  .practiceCard { padding: 1.5rem; }
+  .roadmap li { padding: 1rem; }
+  .evidence { padding: 1.5rem; }
+  .progressGrid { grid-template-columns: minmax(0, 1fr); }
+  .reflectionCard h2 br { display: none; }
+  .evidenceColumns { gap: 1rem; }
+  .evidenceColumns > div + div { padding-left: 1rem; }
+}
+@media (max-width: 850px) {
+  .demo { grid-template-columns: minmax(0, 1fr); }
+  .sidebar { position: static; height: auto; overflow: visible; padding: 1rem 1.5rem; border-right: 0; border-bottom: 1px solid var(--demo-line); }
+  .brand { font-size: 1.5rem; }
+  .brandCaption { margin-top: .25rem; }
+  .navLabel, .sidebarNote, .sidebarBottom { display: none; }
+  .nav { display: flex; flex-wrap: wrap; margin-top: 1rem; gap: .25rem; }
+  .nav a { gap: .5rem; min-height: 44px; padding: .5rem .75rem; }
+  .navArrow { display: none; }
+  .main { padding-top: 2rem; }
+  .topbar { min-height: auto; padding-top: 1rem; padding-bottom: 1rem; }
+  .practiceAside h2 { font-size: 2rem; }
+  .focusStrip { gap: 1rem; flex-wrap: wrap; }
+}
+@media (max-width: 600px) {
+  .demo h1 { font-size: 2.25rem; }
+  .sidebar { padding: 1rem; }
+  .nav { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); }
+  .nav a { font-size: .75rem; padding: .5rem .25rem; justify-content: center; }
+  .navNumber { display: none; }
+  .topbar { padding: 1rem; gap: .75rem; }
+  .main { padding: 1.5rem 1rem; }
+  .hero, .lessonGrid, .practiceGrid, .fluency { grid-template-columns: minmax(0, 1fr); }
+  .hero { padding: 1.5rem; }
+  .loopDiagram { padding: 1.5rem 0 0; border-left: 0; border-top: 1px solid #577067; }
+  .focusStrip > div, .focusStrip > p { flex-basis: 100%; }
+  .roadmap { grid-template-columns: minmax(0, 1fr); }
+  .roadmap li { padding: 1.5rem; }
+  .roadmap li + li { border-left: 0; border-top: 1px solid var(--demo-line); }
+  .fluency { gap: 1rem; }
+  .fourDs { gap: 1rem; }
+  .practiceCard, .panel, .evidence { padding: 1.25rem; }
+  .practiceAside { padding: 1.25rem; border: 1px solid var(--demo-line); border-radius: .25rem; }
+  .practiceAside h2 br { display: none; }
+  .answer, .selectedAnswer { padding: .75rem !important; gap: .5rem; }
+  .selectedAnswer { padding: calc(.75rem - 1px) !important; }
+  .answerLetter { margin-right: .5rem; }
+  .ruleNote { padding: .75rem; }
+  .ruleNote strong { font-size: .7rem; }
+  .notebook { padding: 1.25rem; }
+  .boundaryFigure { padding: 1rem .5rem; }
+  .boundaryLine strong { font-size: .625rem; }
+  .boundaryLine small { font-size: .6rem; }
+  .evidenceColumns { grid-template-columns: minmax(0, 1fr); }
+  .evidenceColumns > div + div { border-left: 0; padding: 1rem 0 0; border-top: 1px solid var(--demo-line); }
+  .evidenceColumns h3 { margin: .75rem 0; }
+  .coverage li { gap: .75rem; grid-template-columns: auto minmax(0, 1fr); }
+  .coverage li > span:last-child { grid-column: 2; }
+  .bottomNav .primary { width: 100%; }
+}
+@media (prefers-reduced-motion: reduce) { .demo *, .demo *::before, .demo *::after { animation: none; transition: none; scroll-behavior: auto; } }

diff --git a/src/app/demo/layout.tsx b/src/app/demo/layout.tsx
new file mode 100644
--- /dev/null
+++ b/src/app/demo/layout.tsx
@@ -0,0 +1,11 @@
+import type { Metadata } from "next";
+
+export const metadata: Metadata = {
+  title: { default: "Fieldnotes · Sample study", template: "%s · Fieldnotes · Sample" },
+  description: "An original, synthetic study prototype. Prewritten content and feedback; no live AI, accounts or academic records.",
+  robots: { index: false, follow: false },
+};
+
+export default function DemoLayout({ children }: Readonly<{ children: React.ReactNode }>) {
+  return children;
+}

diff --git a/src/app/demo/not-found.tsx b/src/app/demo/not-found.tsx
new file mode 100644
--- /dev/null
+++ b/src/app/demo/not-found.tsx
@@ -0,0 +1,14 @@
+import Link from "next/link";
+import { DemoShell } from "./demo-shell";
+import styles from "./demo.module.css";
+
+export default function DemoNotFound() {
+  return (
+    <DemoShell active={null}>
+      <p className={styles.overline}>A SMALL DETOUR · 404</p>
+      <h1>Sample page not found</h1>
+      <p className={styles.lead}>This prototype has four views: overview, lesson, practice and progress.</p>
+      <Link className={styles.primary} href="/demo" prefetch={false}>Back to sample overview</Link>
+    </DemoShell>
+  );
+}

diff --git a/src/app/demo/practice.tsx b/src/app/demo/practice.tsx
new file mode 100644
--- /dev/null
+++ b/src/app/demo/practice.tsx
@@ -0,0 +1,73 @@
+"use client";
+
+import Link from "next/link";
+import { useRef, useState } from "react";
+import styles from "./demo.module.css";
+
+const answers = [
+  { label: "Test only 80 because it is a typical qualifying total", explanation: "80 is useful for an ordinary qualifying order, but both > 50 and >= 50 accept it. Add a case at exactly 50 to catch the off-by-one boundary mistake." },
+  { label: "Test 49, 50 and 51 to check the boundary", explanation: "50 is the first qualifying value for whole-number totals. A mistaken > 50 rule rejects it. 49 and 51 check the neighboring outcomes: false, true, true." },
+  { label: "Copy the implementation into the test", explanation: "Repeating the implementation can repeat its mistake. Derive the expected answer from the requirement instead: at least 50 means that exactly 50 must qualify." },
+] as const;
+
+export function Practice() {
+  const [selected, setSelected] = useState<number | null>(null);
+  const [checked, setChecked] = useState(false);
+  const firstAnswer = useRef<HTMLInputElement>(null);
+  const correct = selected === 1;
+
+  function retry() {
+    setSelected(null);
+    setChecked(false);
+    // Wait until the disabled fieldset has been re-enabled before focusing it.
+    requestAnimationFrame(() => firstAnswer.current?.focus());
+  }
+
+  return (
+    <>
+      <div className={styles.pageHeading}>
+        <p className={styles.overline}>UNIT TESTING ESSENTIALS · ASSISTED PRACTICE · SAMPLE</p>
+        <h1>Find the test that matters.</h1>
+        <p className={styles.lead}>A small decision. A chance to make your reasoning visible.</p>
+      </div>
+      <div className={styles.practiceGrid}>
+        <section className={styles.practiceCard} aria-labelledby="question-heading">
+          <span className={styles.pill}>02 · TRY IT OUT</span>
+          <h2 id="question-heading">Would your test catch the bug?</h2>
+          <p>An order qualifies for free delivery when its total is <strong>at least 50</strong>. A developer accidentally writes <code>&gt; 50</code> instead of <code>&gt;= 50</code>.</p>
+          <div className={styles.ruleNote}><span className={styles.overline}>THE PROMISE</span><strong>49 → false &nbsp; · &nbsp; 50 → true &nbsp; · &nbsp; 51 → true</strong><span>Whole-number totals for this example.</span></div>
+          <form onSubmit={event => { event.preventDefault(); if (selected !== null && !checked) setChecked(true); }}>
+            <fieldset disabled={checked} className={styles.answers} aria-describedby="answer-instructions">
+              <legend>Which test set best checks this boundary?</legend>
+              {answers.map((answer, index) => (
+                <label key={answer.label} className={selected === index ? styles.selectedAnswer : styles.answer}>
+                  <input ref={index === 0 ? firstAnswer : undefined} type="radio" name="boundary-answer" value={index} checked={selected === index} onChange={() => setSelected(index)} />
+                  <span><span className={styles.answerLetter} aria-hidden="true">{String.fromCharCode(65 + index)}</span>{answer.label}</span>
+                </label>
+              ))}
+            </fieldset>
+            <p id="answer-instructions" className={styles.muted}>{checked ? "Answer locked. Try again to clear your selection." : "Choose one answer before checking."}</p>
+            <div className={styles.practiceActions}>
+              <button className={styles.primary} type="submit" disabled={selected === null || checked}>Check answer</button>
+              {checked && <button className={styles.secondary} type="button" onClick={retry}>Try again</button>}
+            </div>
+          </form>
+          <output aria-live="polite" aria-atomic="true" className={checked ? styles.feedback : undefined}>
+            {checked && selected !== null && <><strong className={styles.feedbackHeading}>{correct ? "That checks the boundary." : "Not quite. Here is what to look for."}</strong><span className={styles.feedbackBody}>{answers[selected].explanation}</span><span className={styles.feedbackMeta}>Prewritten feedback · Assisted practice · No score awarded</span></>}
+          </output>
+        </section>
+        <aside className={styles.practiceAside} aria-labelledby="thinking-heading">
+          <span className={styles.overline}>THE THINKING BEHIND THE TEST</span>
+          <h2 id="thinking-heading">Be curious<br />about the edge.</h2>
+          <p>A good test distinguishes the promised behavior from a plausible mistake.</p>
+          <div className={styles.edgeSketch} aria-hidden="true"><span>49</span><strong>50</strong><span>51</span></div>
+          <h3>Ask yourself</h3>
+          <p>Which input makes <code>&gt;</code> and <code>&gt;=</code> give different answers?</p>
+          <div className={styles.asideNote}><strong>Practice, not assessment.</strong><p>The rule and hint stay visible. Feedback is written in advance, not generated by AI. Refreshing resets your answer; nothing is saved.</p></div>
+          <Link href="/demo/lesson" prefetch={false}>Revisit the sample lesson ↗</Link>
+        </aside>
+      </div>
+      <div className={styles.bottomNav}><p className={styles.muted}>The next screen illustrates how content and test evidence could stay separate.</p><Link className={styles.primary} href="/demo/progress" prefetch={false}>Explore sample progress <span aria-hidden="true">↗</span></Link></div>
+    </>
+  );
+}

diff --git a/src/app/demo/sample-views.tsx b/src/app/demo/sample-views.tsx
new file mode 100644
--- /dev/null
+++ b/src/app/demo/sample-views.tsx
@@ -0,0 +1,138 @@
+import Link from "next/link";
+import styles from "./demo.module.css";
+
+export function Overview() {
+  return (
+    <>
+      <div className={styles.pageHeading}>
+        <p className={styles.overline}>A FIELD GUIDE TO YOUR NEXT IDEA</p>
+        <h1>Small steps. Deeper understanding.</h1>
+        <p className={styles.lead}>A sample path from “I have read it” to “I can explain why it works.”</p>
+      </div>
+      <section className={styles.hero} aria-labelledby="continue-heading">
+        <div>
+          <span className={styles.heroLabel}>YOUR CURRENT MINI-COURSE · SAMPLE</span>
+          <h2 id="continue-heading">Make your code<br />keep its promises.</h2>
+          <p>Unit testing, without the guesswork. Start with one small function, a clear expectation, and a test you can trust.</p>
+          <Link className={styles.limeButton} href="/demo/lesson" prefetch={false}>Continue sample lesson <span aria-hidden="true">↗</span></Link>
+          <p className={styles.heroMeta}>Lesson 02 of 04 · Boundary cases · About 12 minutes</p>
+        </div>
+        <figure className={styles.loopDiagram}>
+          <span className={styles.diagramTitle}>THE LEARNING LOOP</span>
+          <div><span>01</span><strong>Understand</strong><small>Find the promise.</small></div>
+          <div><span>02</span><strong>Try</strong><small>Make it observable.</small></div>
+          <div><span>03</span><strong>Reflect</strong><small>Explain the gap.</small></div>
+          <figcaption>One idea. A little evidence. A better question.</figcaption>
+        </figure>
+      </section>
+      <section className={styles.focusStrip} aria-label="Sample study session">
+        <div><span className={styles.overline}>TODAY’S FOCUS</span><strong>What happens right at the edge?</strong></div>
+        <p>Explore a boundary case, then choose the test that would catch a subtle bug.</p>
+        <span className={styles.pill}>Read → Try → Reflect</span>
+      </section>
+      <section aria-labelledby="path-heading" className={styles.section}>
+        <div className={styles.sectionHeader}><div><p className={styles.overline}>THE BIGGER PICTURE</p><h2 id="path-heading">A path made of mini-courses</h2></div><span className={styles.muted}>Illustrative roadmap · Not a lesson list</span></div>
+        <ol className={styles.roadmap}>
+          <li className={styles.currentCourse}><span className={styles.courseNumber}>01 / EXPLORE NOW</span><h3>Unit testing essentials</h3><p>Turn a requirement into a small, repeatable check.</p><Link href="/demo/lesson" prefetch={false}>Explore this sample ↗</Link></li>
+          <li><span className={styles.courseNumber}>02 / ILLUSTRATIVE NEXT STEP</span><h3>Working with AI agents</h3><p>Describe the task. Question the output. Verify the result.</p><span className={styles.muted}>Proposed mini-course · Not built</span></li>
+          <li><span className={styles.courseNumber}>03 / ILLUSTRATIVE NEXT STEP</span><h3>Build the right thing</h3><p>Ask better product questions before writing more code.</p><span className={styles.muted}>Proposed mini-course · Not built</span></li>
+        </ol>
+      </section>
+      <section className={styles.fluency} aria-labelledby="fluency-heading">
+        <div><span className={styles.overline}>RESPONSIBLE BY DESIGN</span><h2 id="fluency-heading">A human stays in the loop.</h2><p>How Anthropic’s AI Fluency 4D framework informs the proposed platform:</p></div>
+        <dl className={styles.fourDs}>
+          <div><dt>Delegation</dt><dd>Choose what to hand to an agent.</dd></div>
+          <div><dt>Description</dt><dd>State the promise and constraints.</dd></div>
+          <div><dt>Discernment</dt><dd>Question the suggested test.</dd></div>
+          <div><dt>Diligence</dt><dd>Verify and own the result.</dd></div>
+        </dl>
+      </section>
+    </>
+  );
+}
+
+export function Lesson() {
+  return (
+    <>
+      <div className={styles.pageHeading}>
+        <p className={styles.overline}>UNIT TESTING ESSENTIALS · LESSON 02 / 04 · SAMPLE CONTENT</p>
+        <h1>A small test. A clear promise.</h1>
+        <p className={styles.lead}>The most revealing inputs are often the ones sitting right on the edge.</p>
+      </div>
+      <div className={styles.lessonGrid}>
+        <article className={styles.lessonBody}>
+          <section aria-labelledby="promise-heading">
+            <span className={styles.pill}>01 · UNDERSTAND</span>
+            <h2 id="promise-heading">Start with the rule, not the code.</h2>
+            <p>A small shop offers free delivery when an order total is <strong>at least 50</strong>. Our function answers one question: does this total qualify?</p>
+            <blockquote className={styles.promise}>“At least 50” includes exactly 50.<span>That is the promise your test needs to protect.</span></blockquote>
+            <pre className={styles.code} aria-label="JavaScript example, not executed"><code><span className={styles.codeComment}>{"// Example only · no code is run here"}</span>{"\nfunction qualifiesForFreeDelivery(total) {\n  return total >= 50;\n}"}</code></pre>
+          </section>
+          <section aria-labelledby="boundary-heading">
+            <h2 id="boundary-heading">Look on both sides of the boundary.</h2>
+            <p>A test at 80 checks an ordinary qualifying order. But it cannot tell <code>&gt; 50</code> from <code>&gt;= 50</code>. The value 50 can.</p>
+            <figure className={styles.boundaryFigure}>
+              <div className={styles.boundaryLine}>
+                <div><span>49</span><strong>Does not qualify</strong><small>Just below</small></div>
+                <div className={styles.boundaryPoint}><span>50</span><strong>Qualifies</strong><small>Exactly on the boundary</small></div>
+                <div><span>51</span><strong>Qualifies</strong><small>Just above</small></div>
+              </div>
+              <figcaption>For whole-number totals, 49 · 50 · 51 gives a compact set around the threshold. Decimal totals need nearby decimal cases too.</figcaption>
+            </figure>
+          </section>
+          <div className={styles.lessonAction}><p>Now try spotting the most useful test.</p><Link className={styles.primary} href="/demo/practice" prefetch={false}>Try the practice <span aria-hidden="true">↗</span></Link></div>
+        </article>
+        <aside className={styles.notebook} aria-labelledby="notebook-heading">
+          <span className={styles.overline}>KEEP IN YOUR FIELDNOTES</span>
+          <h2 id="notebook-heading">Three moves.<br />One clear test.</h2>
+          <ol className={styles.aaa}>
+            <li><span>A</span><div><h3>Arrange</h3><p>Choose a total of 50.</p><code>const total = 50;</code></div></li>
+            <li><span>A</span><div><h3>Act</h3><p>Ask whether it qualifies.</p><code>qualifiesForFreeDelivery(total)</code></div></li>
+            <li><span>A</span><div><h3>Assert</h3><p>Expect the answer to be true.</p><code>expected: true</code></div></li>
+          </ol>
+          <div className={styles.notebookTip}><strong>The useful question</strong><p>If someone changed <code>&gt;=</code> to <code>&gt;</code>, would my test notice?</p></div>
+          <p className={styles.muted}>Discernment + Diligence: even if an agent suggests a test, you remain responsible for checking the requirement and the result.</p>
+        </aside>
+      </div>
+    </>
+  );
+}
+
+export function Progress() {
+  return (
+    <>
+      <div className={styles.pageHeading}>
+        <p className={styles.overline}>A CLEARER VIEW OF THE JOURNEY</p>
+        <h1>See the learning, not just the clicks.</h1>
+        <p className={styles.lead}>Content covered is one signal. Evidence of understanding is another.</p>
+      </div>
+      <div className={styles.sampleNotice}><strong>Illustrative progress · Sample data</strong><span>Fixed examples, not your activity. Practice does not update these values or award credit.</span></div>
+      <section aria-label="Sample learning evidence" className={styles.evidence}>
+        <div className={styles.evidenceHeader}><div><p className={styles.overline}>MINI-COURSE 01</p><h2>Unit testing essentials</h2></div><span className={styles.pill}>In progress · Sample</span></div>
+        <div className={styles.evidenceColumns}>
+          <div><span className={styles.overline}>CONTENT COMPLETION</span><p className={styles.bigMetric}>2 <span>/ 4 lessons</span></p><meter min={0} max={4} value={2} aria-label="Sample content read: 2 of 4 lessons">2 of 4</meter><p className={styles.muted}>Illustrative reading progress only.</p></div>
+          <div><span className={styles.overline}>REQUIRED TEST</span><h3>Not attempted</h3><p>No test evidence recorded in this prototype. Assisted practice is not a passing result.</p></div>
+          <div><span className={styles.overline}>REVIEW & RECOVERY</span><h3>Revisit the boundary</h3><p>Illustrative next step: explain why exactly 50 matters, then try again without a hint.</p></div>
+        </div>
+      </section>
+      <div className={styles.progressGrid}>
+        <section className={styles.panel} aria-labelledby="coverage-heading">
+          <p className={styles.overline}>SAMPLE CONTENT COVERAGE</p><h2 id="coverage-heading">What has been explored?</h2>
+          <ol className={styles.coverage}>
+            <li><span>01</span><div><strong>A test is a promise</strong><small>Arrange, act, assert</small></div><span>Read · Sample</span></li>
+            <li><span>02</span><div><strong>Boundary cases</strong><small>Just below, exactly on, just above</small></div><span>Read · Sample</span></li>
+            <li><span>03</span><div><strong>Independent expectations</strong><small>Do not copy the implementation</small></div><span>Not read · Sample</span></li>
+            <li><span>04</span><div><strong>Tests that earn trust</strong><small>Deterministic, small, meaningful</small></div><span>Not read · Sample</span></li>
+          </ol>
+        </section>
+        <section className={styles.reflectionCard} aria-labelledby="evidence-heading">
+          <span className={styles.overline}>COMPLETION ≠ MASTERY</span><h2 id="evidence-heading">Reading is a start. <br />Evidence is the next step.</h2>
+          <p>The proposed study loop separates finishing content from passing required tests and recovering weak areas. None of those academic outcomes is recorded here.</p>
+          <Link href="/demo/practice" prefetch={false}>Revisit assisted practice ↗</Link>
+          <Link href="/demo/lesson" prefetch={false}>Read the boundary lesson ↗</Link>
+        </section>
+      </div>
+      <div className={styles.bottomNav}><p className={styles.muted}>No rewards, mastery claims or completion awards. Just a sample of a more transparent learning journey.</p><Link className={styles.primary} href="/demo" prefetch={false}>Back to overview <span aria-hidden="true">↗</span></Link></div>
+    </>
+  );
+}

diff --git a/tests/browser/demo.spec.ts b/tests/browser/demo.spec.ts
new file mode 100644
--- /dev/null
+++ b/tests/browser/demo.spec.ts
@@ -0,0 +1,156 @@
+import { test, expect } from "@playwright/test";
+
+const screens = [
+  { path: "/demo", nav: "Overview", title: "Small steps. Deeper understanding.", image: "01-overview" },
+  { path: "/demo/lesson", nav: "Lesson", title: "A small test. A clear promise.", image: "02-lesson" },
+  { path: "/demo/practice", nav: "Practice", title: "Find the test that matters.", image: "03-practice" },
+  { path: "/demo/progress", nav: "Progress", title: "See the learning, not just the clicks.", image: "04-progress" },
+];
+const boundaryAnswer = "Test 49, 50 and 51 to check the boundary";
+
+for (const screen of screens) {
+  test(`sample direct entry: ${screen.nav}`, async ({ page }, info) => {
+    await page.setViewportSize({ width: 1440, height: 1000 });
+    const response = await page.goto(screen.path);
+    expect(response?.status()).toBe(200);
+    await expect(page.getByText("Sample prototype · No live AI", { exact: true })).toBeVisible();
+    await expect(page.getByRole("heading", { name: screen.title, level: 1, exact: true })).toBeVisible();
+    await expect(page.getByRole("navigation", { name: "Sample study" }).getByRole("link", { name: screen.nav, exact: true })).toHaveAttribute("aria-current", "page");
+    await expect(page.getByRole("navigation", { name: "Sample study" })).toHaveCSS("display", "grid");
+    await expect(page).toHaveTitle(/Fieldnotes.*Sample/);
+    if (screen.nav === "Progress") await expect(page.getByText("Illustrative progress · Sample data", { exact: true })).toBeVisible();
+    await page.screenshot({ path: info.outputPath(`${screen.image}-desktop.png`), fullPage: true });
+    await page.setViewportSize({ width: 360, height: 800 });
+    await page.screenshot({ path: info.outputPath(`${screen.image}-mobile.png`), fullPage: true });
+  });
+}
+
+test("unknown and nested demo views are not found rather than silently showing a sample", async ({ page }) => {
+  for (const path of ["/demo/unknown", "/demo/lesson/extra", "/demo/constructor"]) {
+    expect((await page.goto(path))?.status()).toBe(404);
+    await expect(page.getByRole("heading", { name: "Sample page not found", exact: true })).toBeVisible();
+    await expect(page.getByText("Sample prototype · No live AI", { exact: true })).toBeVisible();
+    await expect(page.getByRole("link", { name: "Back to sample overview", exact: true })).toHaveAttribute("href", "/demo");
+  }
+});
+
+test("empty and correct practice is honest assisted practice with locked answers", async ({ page }, info) => {
+  await page.goto("/demo/practice");
+  const check = page.getByRole("button", { name: "Check answer", exact: true });
+  await expect(check).toBeDisabled();
+  await expect(page.getByText("Choose one answer before checking.", { exact: true })).toBeVisible();
+  await expect(page.getByRole("status")).toBeEmpty();
+  await page.getByRole("radio", { name: boundaryAnswer, exact: true }).check();
+  await expect(check).toBeEnabled();
+  await check.click();
+  await expect(page.getByRole("status")).toContainText("That checks the boundary.");
+  await expect(page.getByRole("status")).toContainText("50 is the first qualifying value");
+  await expect(page.getByRole("status")).toContainText("Prewritten feedback · Assisted practice · No score awarded");
+  for (const radio of await page.getByRole("radio").all()) await expect(radio).toBeDisabled();
+  await expect(check).toBeDisabled();
+  await page.setViewportSize({ width: 1440, height: 1000 });
+  await page.evaluate(() => scrollTo(0, 0));
+  await page.screenshot({ path: info.outputPath("practice-feedback-desktop.png"), fullPage: true });
+});
+
+for (const answer of ["Test only 80 because it is a typical qualifying total", "Copy the implementation into the test"]) {
+  test(`incorrect practice supports retry: ${answer}`, async ({ page }) => {
+    await page.goto("/demo/practice");
+    await page.getByRole("radio", { name: answer, exact: true }).check();
+    await page.getByRole("button", { name: "Check answer", exact: true }).click();
+    await expect(page.getByRole("status")).toContainText("Not quite. Here is what to look for.");
+    await expect(page.getByRole("status")).toContainText("Prewritten feedback · Assisted practice · No score awarded");
+    await page.getByRole("button", { name: "Try again", exact: true }).click();
+    await expect(page.getByRole("status")).toBeEmpty();
+    await expect(page.getByRole("radio", { checked: true })).toHaveCount(0);
+    await expect(page.getByRole("radio").first()).toBeFocused();
+    await expect(page.getByRole("button", { name: "Check answer", exact: true })).toBeDisabled();
+  });
+}
+
+test("retry and refresh reset practice without changing illustrative progress", async ({ page }) => {
+  await page.goto("/demo/progress");
+  const before = await page.getByRole("region", { name: "Sample learning evidence" }).innerText();
+  await page.getByRole("navigation", { name: "Sample study" }).getByRole("link", { name: "Practice", exact: true }).click();
+  await page.getByRole("radio", { name: boundaryAnswer, exact: true }).check();
+  await page.getByRole("button", { name: "Check answer", exact: true }).click();
+  await expect(page.getByRole("status")).not.toBeEmpty();
+  await page.reload();
+  await expect(page.getByRole("radio", { checked: true })).toHaveCount(0);
+  await expect(page.getByRole("status")).toBeEmpty();
+  await expect(page.getByRole("button", { name: "Check answer", exact: true })).toBeDisabled();
+  await page.getByRole("navigation", { name: "Sample study" }).getByRole("link", { name: "Progress", exact: true }).click();
+  await expect(page.getByRole("region", { name: "Sample learning evidence" })).toHaveText(before, { useInnerText: true });
+});
+
+test("the complete sample loop has meaningful local navigation", async ({ page }) => {
+  await page.goto("/demo");
+  await page.getByRole("link", { name: "Continue sample lesson", exact: true }).click();
+  await expect(page).toHaveURL(/\/demo\/lesson$/);
+  await page.getByRole("link", { name: "Try the practice", exact: true }).click();
+  await expect(page).toHaveURL(/\/demo\/practice$/);
+  await page.getByRole("link", { name: "Explore sample progress", exact: true }).click();
+  await expect(page).toHaveURL(/\/demo\/progress$/);
+  await page.getByRole("link", { name: "Back to overview", exact: true }).click();
+  await expect(page).toHaveURL(/\/demo$/);
+});
+
+test("all screens fit 320px, 360px, tablet and desktop; practice works by keyboard with reduced motion", async ({ page }) => {
+  await page.emulateMedia({ reducedMotion: "reduce" });
+  for (const width of [320, 360, 768, 1440]) {
+    await page.setViewportSize({ width, height: 900 });
+    for (const screen of screens) {
+      await page.goto(screen.path);
+      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
+      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${screen.path} at ${width}px`).toBe(true);
+    }
+  }
+  await page.setViewportSize({ width: 360, height: 800 });
+  await page.goto("/demo/practice");
+  await page.keyboard.press("Tab");
+  await expect(page.getByRole("link", { name: "Skip to sample content", exact: true })).toBeFocused();
+  await page.keyboard.press("Enter");
+  await expect(page.getByRole("main")).toBeFocused();
+  await page.keyboard.press("Tab");
+  await expect(page.getByRole("radio").first()).toBeFocused();
+  await page.keyboard.press("ArrowDown");
+  await page.keyboard.press("Space");
+  await expect(page.getByRole("radio", { name: boundaryAnswer, exact: true })).toBeChecked();
+  await page.keyboard.press("Tab");
+  await expect(page.getByRole("button", { name: "Check answer", exact: true })).toBeFocused();
+  await page.keyboard.press("Enter");
+  await expect(page.getByRole("status")).toContainText("That checks the boundary.");
+  await page.keyboard.press("Tab");
+  await expect(page.getByRole("button", { name: "Try again", exact: true })).toBeFocused();
+  await page.keyboard.press("Enter");
+  await expect(page.getByRole("radio").first()).toBeFocused();
+});
+
+test("sample navigation and practice make no API, external or failed requests and preserve security headers", async ({ page }) => {
+  const unexpected: string[] = []; const errors: string[] = [];
+  page.on("pageerror", error => errors.push(error.message));
+  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
+  page.on("requestfailed", request => errors.push(`Failed ${new URL(request.url()).pathname}`));
+  await page.route("**/*", async route => {
+    const url = new URL(route.request().url());
+    if (url.origin !== "http://127.0.0.1:3000" || url.pathname.startsWith("/api/") || route.request().method() !== "GET") {
+      unexpected.push(`${route.request().method()} ${url.origin}${url.pathname}`);
+      await route.abort();
+    } else await route.continue();
+  });
+  const response = await page.goto("/demo");
+  expect(response?.headers()["content-security-policy"]).toContain("connect-src 'self'");
+  expect(response?.headers()["x-frame-options"]).toBe("DENY");
+  for (const screen of screens) {
+    await page.getByRole("navigation", { name: "Sample study" }).getByRole("link", { name: screen.nav, exact: true }).click();
+    await expect(page.getByRole("heading", { name: screen.title, exact: true })).toBeVisible();
+    if (screen.nav === "Practice") {
+      await page.getByRole("radio", { name: boundaryAnswer, exact: true }).check();
+      await page.getByRole("button", { name: "Check answer", exact: true }).click();
+      await expect(page.getByRole("status")).toContainText("That checks the boundary.");
+      await page.getByRole("button", { name: "Try again", exact: true }).click();
+    }
+  }
+  expect(unexpected).toEqual([]);
+  expect(errors).toEqual([]);
+});
```

The plan is itself a new file relative to the baseline; its complete added contents are the Inline plan section above. The only excluded worktree delta is the user's pre-existing, byte-identical development imports in next-env.d.ts; it is not part of this change or staged commit. There are no nested agent instruction files and the plan's context list is empty. This handoff is a transport artifact, not implementation, and no reviewer has run yet.

## Inline unchanged surrounding configuration

### next.config.ts

```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  turbopack: {
    rules: {
      "*.css": {
        condition: { not: { path: "*.module.css" } },
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Cache-Control", value: "no-store, private" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "no-referrer" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
          {
            key: "Content-Security-Policy",
            value:
              "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
          },
        ],
      },
    ];
  },
};
export default nextConfig;
```

### Shared root layout

```tsx
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Fieldnotes · Private study",
  description:
    "Local synthetic TXT-to-Manual-plan tracer. No AI processing or course generation.",
};
export default function Layout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
```

### Shared globals.css

```css
@import "tailwindcss";

:root {
  --ink: #193c36;
  --muted: #52635d;
  --paper: #f7f6f1;
  --surface: #fffefa;
  --line: #d7dfd6;
  --accent: #d8e88c;
  --danger: #8b2926;
}
* {
  box-sizing: border-box;
}
body {
  margin: 0;
  background: var(--paper);
  color: var(--ink);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  line-height: 1.6;
}
a {
  color: inherit;
  text-underline-offset: 0.2em;
}
button,
input,
select,
textarea {
  font: inherit;
}
button {
  cursor: pointer;
  border: 1px solid var(--ink);
  border-radius: 0.25rem;
  background: var(--ink);
  color: white;
  padding: 0.65rem 1.1rem;
  min-height: 44px;
}
button:hover {
  filter: brightness(1.12);
}
button:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}
button.quiet {
  color: var(--ink);
  background: transparent;
}
button.danger {
  background: var(--danger);
  border-color: var(--danger);
}
:focus-visible {
  outline: 3px solid #486600;
  outline-offset: 4px;
}
h1,
h2,
h3 {
  line-height: 1.2;
  letter-spacing: -0.025em;
  font-weight: 550;
}
h1 {
  font-family: Georgia, serif;
  font-size: clamp(2rem, 4vw, 3rem);
  margin: 0.5rem 0 1rem;
}
h2 {
  font-size: 1.4rem;
  margin: 0 0 1rem;
}
h3 {
  font-size: 1.15rem;
}
p {
  margin: 0.5rem 0 1rem;
  overflow-wrap: anywhere;
}
output {
  display: block;
  margin: 0.5rem 0 1rem;
  overflow-wrap: anywhere;
}
.topbar {
  min-height: 96px;
  padding: 1.25rem 4vw;
  display: flex;
  gap: 1rem;
  align-items: center;
  border-bottom: 1px solid var(--line);
  flex-wrap: wrap;
}
.brand {
  font:
    1.75rem Georgia,
    serif;
  text-decoration: none;
  margin-right: auto;
}
.brand span {
  display: block;
  font:
    0.6rem -apple-system,
    sans-serif;
  letter-spacing: 0.22em;
  margin-top: 0.2rem;
}
.tag {
  font-size: 0.75rem;
  background: var(--accent);
  padding: 0.3rem 0.7rem;
  border-radius: 2rem;
}
.workspace {
  display: grid;
  grid-template-columns: minmax(200px, 25%) minmax(0, 1fr);
  max-width: 1440px;
  margin: auto;
}
.sidebar {
  padding: 4rem 2rem;
  border-right: 1px solid var(--line);
  background: #edf0e6;
}
.sidebar h2 {
  font:
    2rem/1.2 Georgia,
    serif;
}
.steps {
  list-style: none;
  padding: 2rem 0;
  border-top: 1px solid var(--line);
  margin-top: 2rem;
}
.steps li {
  padding: 0.75rem 0;
  border-bottom: 1px solid var(--line);
  font-size: 0.9rem;
}
.content {
  padding: 3.5rem clamp(1rem, 5vw, 5rem);
  min-width: 0;
}
.eyebrow {
  font-size: 0.65rem;
  font-weight: 700;
  letter-spacing: 0.16em;
}
.subtitle,
.fine {
  color: var(--muted);
}
.fine {
  font-size: 0.8rem;
}
.panel {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 0.4rem;
  padding: clamp(1rem, 3vw, 2rem);
  margin: 1.75rem 0;
  min-width: 0;
}
form {
  display: grid;
  gap: 0.75rem;
}
.plan-fields {
  display: grid;
  gap: 0.75rem;
  min-width: 0;
  border: 0;
  padding: 0;
  margin: 0;
}
form label {
  font-size: 0.85rem;
  font-weight: 600;
  margin-top: 0.5rem;
}
input,
select,
textarea {
  width: 100%;
  min-width: 0;
  max-width: 100%;
  border: 1px solid #89998e;
  background: white;
  color: var(--ink);
  border-radius: 0.2rem;
  padding: 0.65rem;
}
input[type="file"] {
  font-size: 0.8rem;
}
textarea {
  min-height: 96px;
  resize: vertical;
}
form button {
  justify-self: start;
}
.actions,
.section-heading {
  display: flex;
  gap: 1rem;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
}
.preview {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  word-break: break-word;
  font:
    0.85rem/1.7 ui-monospace,
    monospace;
  max-height: 20rem;
  overflow-y: auto;
  padding: 1rem;
  background: var(--paper);
}
summary {
  cursor: pointer;
  font-size: 0.85rem;
}
.notice {
  border-left: 3px solid var(--danger);
  background: #fff0e9;
  padding: 1rem;
  margin: 1rem 0;
}
.danger-zone {
  border-top: 1px solid var(--line);
  padding-top: 2rem;
  margin: 2rem 0;
}
.danger-zone button {
  margin: 0.5rem 0.5rem 0.5rem 0;
}
.library {
  margin-top: 3rem;
}
.library ul {
  list-style: none;
  padding: 0;
}
.library li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  border-bottom: 1px solid var(--line);
  padding: 1rem 0;
}
.library li > div {
  min-width: 0;
  overflow-wrap: anywhere;
}
.library li p {
  margin: 0.25rem 0 0;
}
footer {
  margin-top: 3rem;
  padding-top: 1.5rem;
  border-top: 1px solid var(--line);
  font-size: 0.75rem;
  color: var(--muted);
}
footer span {
  display: block;
}
.skip-link {
  position: absolute;
  left: 1rem;
  top: -100px;
  padding: 0.5rem;
  background: white;
  z-index: 10;
}
.skip-link:focus {
  top: 1rem;
}
@media (max-width: 700px) {
  .workspace {
    grid-template-columns: minmax(0, 1fr);
  }
  .sidebar {
    padding: 1rem;
    border-right: 0;
    border-bottom: 1px solid var(--line);
  }
  .sidebar h2,
  .sidebar > p:not(.eyebrow),
  .sidebar .fine {
    display: none;
  }
  .steps {
    display: flex;
    flex-wrap: wrap;
    gap: 1rem;
    padding: 0;
    margin: 0.5rem 0;
    border: 0;
  }
  .steps li {
    padding: 0;
    border: 0;
    font-size: 0.75rem;
  }
  .content {
    padding: 2rem 1rem;
  }
  .topbar {
    padding: 1rem;
  }
  .library li {
    flex-wrap: wrap;
  }
}
@media (prefers-reduced-motion: reduce) {
  * {
    scroll-behavior: auto;
  }
}
```
