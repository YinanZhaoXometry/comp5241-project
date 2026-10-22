# Private study tracer — local synthetic Story 1

A narrow real Next.js/PostgreSQL/worker journey: **sign in → upload synthetic TXT
→ inspect escaped preview → save/confirm a Manual one-mini-course plan → reopen
the exact revision → remove its root and dependent copies**. This is not yet the
full GenAI learning platform. The [approved plan](_bmad-output/initiative-ai-learning-platform/tickets/epic-private-study-setup/tickets/story-private-txt-to-confirmed-plan-tracer-plan.md)
defines scope; the [lint coverage record](docs/lint-coverage.md) explains the
user-authorized tool replacement. New developers start with
[CONTRIBUTING.md](CONTRIBUTING.md) for the reading order, environment setup and the
one-story-per-session BMad workflow.

**Story 2 — local synthetic verification passed; independent review pending:**
four-format/batch/explicit-preview code now uses source-built lxml/libxml2/libxslt
instead of Expat. The former admission remains quarantined; fresh matching local
synthetic admission was issued only after audit and isolation/resource probes.
The complete gate passed **110 unit, 52 integration and 27 browser cases**, plus
real queued-PDF restart/replay. See the [replacement assessment and F2 evidence](docs/bounded-document-extraction.md),
including libxml2's upstream warning against untrusted-data use. No real uploads,
live AI, deployment or release approval is implied. The historical Story 1 results
below remain separate evidence, not a claim that Story 2 has completed review.

An additional [dormant provider foundation](docs/ai-provider-adapter.md) now defines
a provider-neutral text-completion port and a bounded, server-side Chat Completions
adapter using the exact official SDK. It is **not connected to web/worker startup**:
no AI UI, route, job or generation behavior is activated. Configuration alone
cannot construct a client or dispatch; all adapter verification uses synthetic
transports, with global network trapped. Live activation remains forbidden and
requires separate eligibility, consent/lineage, durable accounting and operator
authorization. Coding subscription benefits do not establish product eligibility.

## Screenshot-ready sample study experience

The separate [screenshot prototype plan](_bmad-output/initiative-ai-learning-platform/plan-screenshot-study-prototype.md)
authorizes an unauthenticated, original-content sample under `/demo`. It does not
replace the working private tracer at `/` or implement the later GenAI epics.
Every sample screen is labeled **Sample prototype · No live AI**.

With the local web server running, the four direct screenshot entry points are:

| View                                                    | Normal local URL                    | Screenshot preview URL (port 3100)  |
| ------------------------------------------------------- | ----------------------------------- | ----------------------------------- |
| Overview and whole-mini-course roadmap                  | http://127.0.0.1:3000/demo          | http://127.0.0.1:3100/demo          |
| Unit-testing lesson and boundary diagram                | http://127.0.0.1:3000/demo/lesson   | http://127.0.0.1:3100/demo/lesson   |
| Assisted multiple-choice practice                       | http://127.0.0.1:3000/demo/practice | http://127.0.0.1:3100/demo/practice |
| Illustrative progress and separate test/recovery status | http://127.0.0.1:3000/demo/progress | http://127.0.0.1:3100/demo/progress |

The preview uses the same production build with `npm run start -- --port 3100`;
it still binds only to loopback. The demo itself needs **no sign-in, database,
worker, provider configuration or private credentials**. Follow the existing
runtime selection below before running commands. The full verification harness
continues to start the real tracer web/worker and isolated synthetic database.

The lesson explains an original free-delivery threshold example. Practice feedback
is prewritten, visibly assisted and unscored. Check-answer requires a selection,
locks the answer after checking, and supports retry. Retry or refresh clears all
practice state; no browser storage or backend is used. Progress is fixed **sample
data**, not measured learning, passed tests or a mastery claim. Future roadmap
mini-courses are labeled unbuilt, not fake controls or locked courses. AI Fluency
4D context is a presentation aid, not a working assessment or instructor approval.

Demo code lives entirely under [src/app/demo](src/app/demo/[[...view]]/page.tsx).
It imports no tracer/auth/database/worker/provider services. Styles use a CSS
Module; the explicitly user-approved loader exception excludes only module CSS
from the global Tailwind transform, preserving root styles and security headers.
Unknown or nested views return a labeled 404. No dependency was added and no
ticket metadata was advanced.

[Demo browser coverage](tests/browser/demo.spec.ts) adds twelve cases without
changing the ten tracer cases or their production harness. It covers direct URLs,
labels/active navigation/actual scoped styling, unknown views, empty/correct/both
incorrect answers, answer locking, retry/refresh, unchanged sample progress,
navigation, keyboard/reduced-motion behavior, 320/360/768/1440px layouts and no
API/external/failed requests or browser errors. The four direct-entry cases write
full-page desktop (1440px) and mobile (360px) PNGs to their ignored `test-results/`
directories; a separate case captures feedback. A convenience copy of the final
synthetic screenshot set is kept locally under `.local/demo-screenshots/`, not
committed or uploaded.

The full local gate on 2026-10-21 passed: audit0, the existing 113-rule lint
coverage/probes, module/provider boundaries, both typechecks, 106 unit tests,
15 PostgreSQL tests, sandbox confinement, production build, all **22 browser
cases** (12 demo + 10 unchanged tracer) and real web/worker restart. The user's
original development imports/cache were restored byte-for-byte and both
typechecks passed again. Independent Quick review and the reviewed local commit
remain pending; test results alone do not satisfy that separate review step.

## Local prerequisites and operation

macOS arm64 only for this first TXT sandbox. Node is managed with nvm: `.nvmrc`
pins 24.22.0 (matching `engines`; nvm verifies the official-artifact checksums at
install). PostgreSQL18.6 binaries are installed separately under Homebrew. Do not
use default EOL Node23 — this machine's nvm default may still be 23, so run
`nvm use` in every project terminal — and never start the Homebrew default
database cluster. First time: copy the environment template; every terminal:
load it (it isolates npm/Next from personal configuration; `scripts/checks.mjs`
also injects these values into every gate child process):

```sh
nvm install 24.22.0        # first time only
nvm use                    # selects 24.22.0 from .nvmrc
cp .env.example .env       # first time only; .env is git-ignored
source .env
npm ci --ignore-scripts --no-fund
npm run db:start
npm run migrate
npm run extractor:build
npm run provision
npm exec playwright install chromium
npm run build
```

Provisioning uses Better Auth's supported internal signup path and writes four
synthetic learner-A/learner-B/instructor/admin credentials to an ignored private
local file; it does not print them. Open that file locally, never paste credentials
into chat. Provision once; an existing credential file causes a safe refusal to
overwrite. There is no public signup, self-promotion, email or external account.

Run `npm run start` and `npm run worker` in separate terminals with the same runtime
selection; open http://127.0.0.1:3000. Stop web/worker with Ctrl-C; stop this project's
database with `npm run db:stop`. All listeners bind loopback. Development mode is
`npm run dev`, but the recorded browser tests use the production build.

Use only original generated non-personal fixtures: extractable-text PDF, DOCX,
UTF-8 TXT or Markdown, nonempty, at most 20 MiB each and ten active inputs per
batch. Docker/Colima and Trivy are additional four-format prerequisites; read the
[source-build and sandbox requirements](docs/bounded-document-extraction.md#local-prerequisites-and-recovery).
Inspect each successful preview and acknowledge exact revisions; explicitly
exclude or remove failed inputs before saving a Manual plan. The source is
never evaluated as code/HTML. Files are private server-generated UUID objects;
original/extracted/plan lineage is registered. Deletion immediately fences access
and removes this tracer's copies; pending cleanup is retried. Unrelated roots
survive. This does not implement later general purge/backup/restore guarantees.

## Verification

`npm run checks` executes separate audit, lint/rule-probes, module-direction checks,
web/worker typechecks, unit tests, extractor confinement probe, isolated database
setup/migration, real PostgreSQL integration, production build, Playwright browser
journeys and a real web+worker restart smoke. It stops on any failed command.
The manual-only workflow runs the same local gate on a separately approved prepared
macOS runner; no remote workflow or deployment has been run or authorized.

Recorded on 2026-10-21; independent review findings corrected and regression-tested:

| Check                                     | Measured result                                                                                                                                                                                                           |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Clean install, lifecycle scripts disabled | Passed; no peer overrides                                                                                                                                                                                                 |
| Native full dependency audit              | 0 vulnerabilities                                                                                                                                                                                                         |
| Registry provenance                       | 253 signatures, 121 attestations verified                                                                                                                                                                                 |
| Separate lint                             | Passed; 113 prior rule entries inventoried, all active mappings checked, 8 negative probes + JSX-reference positive probe                                                                                                 |
| Web and worker TypeScript                 | Passed                                                                                                                                                                                                                    |
| Unit                                      | 4 passed                                                                                                                                                                                                                  |
| PostgreSQL integration                    | 15 passed: receipt/state/queue rollback, invalid file/job inventory, runtime DDL denial, duplicate/deletion/revocation/stream races, crash staging, cleanup isolation, terminal retry/crash reconciliation and exact20MiB |
| Next production build                     | Passed                                                                                                                                                                                                                    |
| Chromium browser                          | 10 passed: 360px/desktop, escaped preview, exact confirmation/reopen/removal, denied actor replay, session refresh/revocation/throttle, editor/concurrent-save races, account-change responses and retry polling          |
| Real-process restart                      | Passed; stop/restart web and worker, exact plan/session persists, B denied; process output contains no fixture text/credentials                                                                                           |
| TXT isolation                             | OS network/read/write denial probe passed; fixed20MiB+1 buffer, CPU2s, wall10s, output20MiB, RSS guard128MiB                                                                                                              |

Tests use only the isolated synthetic database. Browser cases reset only their
auth limiter fixture between independent tests; the actual limiter stays enabled
and has its own 429 regression test. Initial grouped browser logins exposed a
real bug masking throttles as401; the route now returns safe429 instead. No test
was skipped or weakened to bypass this.

Independent review found and corrected stale async UI completions, mutable pending
saves, unseen reloaded drafts, a shared deletion key, stopped retry polling, falsely
purged crash-staged copies, cleanup head-of-line blocking and missing terminal retry
status. Follow-up fixes bind save completion to its exact receipt's draft ID and
reconcile terminal queue failures when process death bypasses the extraction catch.
All ten findings were resolved; none was deferred. Cleanup conservatively remains pending while that owner's staging leases
exist (up to five minutes before reconciliation); unrelated roots remain usable.
One failed physical cleanup stays denied/pending without stopping unrelated work.

Adapter foundation verification on 2026-10-21 additionally passed a clean locked
install with lifecycle scripts disabled, audit0, 254 registry signatures and
122 attestations, all lint/rule probes, transitive client/provider isolation and
both typechecks. The full synthetic gate passed **106 unit tests** (102 new adapter
and boundary cases plus 4 existing), **15 PostgreSQL tests**, **10 browser tests**,
the sandbox probe, production build and actual web/worker restart. Public bundle
inspection found no adapter markers in 8 JavaScript chunks. Development imports
were restored after the build; duplicate inactive generated route types were
moved aside, not suppressed. Independent Quick review found two issues in
base-path joining and normalized alias isolation; both were reproduced with four
new regressions, fixed and independently rechecked. No findings were deferred;
the earlier tracer review above is separate from this foundation review.

## Structure and security boundaries

The full annotated directory map is in [docs/project-structure.md](docs/project-structure.md);
the list below stays focused on security-relevant boundaries.

- [src/app](src/app/page.tsx): minimal local study interface and thin HTTP adapters.
- [src/modules](src/modules/materials-setup/service.ts): shared web/worker services,
  identity/session fences, immutable plan revisions and lifecycle orchestration.
- [src/adapters](src/adapters/queue.ts): one-client pg-boss enqueue, PostgreSQL,
  private storage and a no-network macOS TXT-only helper.
- [migrations/001-tracer.sql](migrations/001-tracer.sql): ordered schema ownership;
  runtime cannot migrate. Auth/session changes serialize against protected writes.
- [tests](tests/integration/tracer.test.ts): executable synthetic privacy,
  idempotency, race, browser and persistence evidence—not live-data certification.

The selected pg-boss12.30.0 pin is the exact12.x implementation verified with
Node24/PG18, one-client queue APIs and rollback/duplicate tests; the architecture's
12.38.0 was a planning seed, not a previously accepted running deployment. The
new lockfile remains audit-clean. Other framework/auth/TS versions are unchanged.

The type-only bun-types package supplies Better Auth core's imported `bun:sqlite`
declaration while keeping `skipLibCheck: false`; only that declaration is included.
Bun is not an application runtime and is never installed or executed here.

The TXT helper is trusted bounded copying, not a general hostile-document or
learner-code execution sandbox. Its RSS guard is not a kernel hard memory cap;
only the fixed-buffer TXT implementation is admitted. Linux/other platforms fail
closed. Four-format extraction now uses the separate externally limited Linux
container documented above; dedicated learner-code isolation remains later work.

## Known limits and accepted risk

- Node24.22.0 comes from nvm (official darwin-arm64 artifact, checksum-verified by
  nvm at install; bundled npm11.19.1 matches `engines`). The former project-local
  standalone copy was manually verified as SHA256
  `6a9724d9b50a5f22b4816cded441b5a8d9ddae546191a5e5b7efa5a5e2ee26d5` before its
  removal on 2026-10-21. The pending HIGH-security Node release is still accepted
  **only for local synthetic development**. Recheck/update when published and
  before broader use; neither F1 nor release readiness is declared fully passed.
- Starter generation was repeated privately under explicit verified Node24 after
  an earlier terminal-export reset accidentally selected Node23. Every application
  check here explicitly used Node24. The verified copy is ignored local evidence.
- Cookies are HTTP-only/SameSite-strict but not Secure for this exact loopback HTTP
  origin. No hosted/production auth configuration is offered.
- No activated providers, accounts, costs, deployment, real data, pilot, full generation,
  diagnostics, exports, general retention/backup/restore or completion awards.
- The prior user-approved Homebrew installation changed shared OpenSSL/Kerberos
  dependencies. Existing PG17 data was not used; unrelated consumers may need
  checking. No privileged Command Line Tools repair was attempted.

Historical failures and exceptions are retained in the
[runtime preflight](_bmad-output/initiative-ai-learning-platform/tickets/epic-private-study-setup/runtime-preflight.md).
No real-data or production safety, compliance, efficacy or product-market-fit claim
follows from this local tracer.
