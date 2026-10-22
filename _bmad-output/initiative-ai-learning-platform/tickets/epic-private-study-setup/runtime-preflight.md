---
title: Story 1 local runtime and security preflight
created: 2026-10-21
checked_at: "2026-10-21T10:27:35+08:00"
status: local-verified-reviewed-runtime-exception
gate: F1
baseline_revision: d123d79317055a801f2957b985e05cfd45b20b1b
---

# Runtime/security preflight — story 1.1

## Current measured result — local synthetic tracer

2026-10-21: replaced the vulnerable preset with exact-pinned ESLint10.13.0,
typescript-eslint8.72.0, hooks7.1.1 and Oxlint1.89.0. The unchanged full native audit
now reports **0 vulnerabilities**. Clean `npm ci --ignore-scripts --no-fund` passed;
253 registry signatures and121 attestations verified. No dependency override,
suppression, skipped test or advisory exception was introduced. The
[lint coverage evidence](../../../../docs/lint-coverage.md) inventories113 prior
entries, verifies every active mapping and runs8 negative probes plus a JSX
reference positive check. Next/React/TS/auth versions remain the adopted versions.
pg-boss12.30.0 is the exact12.x pin verified against the actual single-client queue
adapter and PG18;12.38.0 remains a historical unverified planning seed.

The official starter was regenerated privately under explicit project-local
Node24 into ignored local evidence, correcting the earlier terminal PATH error.
An isolated project PG18 cluster on127.0.0.1:55432, separate migration/runtime roles,
ordered auth→app→queue migrations, UUID private files, bounded no-network TXT helper,
real sessions and shared web/worker services are implemented. Four operator demo
actors are provisioned privately; no credentials are printed or committed.

`npm run checks` ran successfully after implementation: full audit, separate lint,
dependency-direction checks, web+worker typecheck, **4 unit /15 PG integration /10
Chromium tests**, sandbox network/read/write denial probe, repeatable migrations,
Next production build and real-process restart smoke. Browser and worker tests
verify queued/extracting/preview→Manual plan confirmation, exact reopening, direct
second-learner/instructor/admin denials, stale/replayed commands, enqueue rollback,
duplicate effects, session expiry/revocation, GET-read-only/POST refresh, deletion
races and physical-copy cleanup, unrelated root preservation,20MiB boundary,
honest120-second pending, escaped text and360px/desktop layout. Web+worker were
actually stopped and restarted together; exact plan and session persisted, B was
denied and process-output scan contained no fixture content/credentials.

The initially grouped browser suite exposed authentication throttles incorrectly
mapped to401; the route now preserves safe429. Tests isolate the synthetic limiter
fixture per case and independently prove the real3/10s sensitive-route limit; no
limiter was disabled. The macOS helper's128MiB RSS check is not a kernel memory cap;
only fixed-buffer TXT copying is admitted, no future document parser/learner code.

Independent Quick review and targeted follow-ups completed; ten verified findings
were corrected and regression-covered, including exact save-receipt identity and
terminal queue reconciliation after a crash. No review finding was deferred. The
final full pipeline reran successfully after corrections. **F1 is not fully passed**:
the pending Node HIGH-security fix remains the user's specific local-only accepted
risk, not a patched-runtime claim. Final official advisory/checksum-page recheck
still shows future release wording and latest Node24.22.0 with the recorded arm64
checksum; no fixed patch was verified. Full retention/backup/restore, live providers,
real data, deployment and pilot remain unimplemented/unauthorized. The manual-only
CI entry has not been remotely run and does not authorize a runner/account/cost.
Historical failed/paused findings below are not current claims of absent app code.

## Current authorization — lint replacement and local S1 continuation

Latest user instruction on 2026-10-21: **Replace the lint stack, preserve the required checks, and continue Story 1 locally with synthetic data only.** This supersedes the earlier keep-preset pause below. Normally resolved maintained replacement tools are authorized, conditional on explicit effective-rule coverage/negative-fixture validation, supported peers, a clean full native dependency audit and clean installation. The known vulnerability is not waived; lint/testing standards cannot be reduced. Continue the approved story after verification, keeping the existing Node-only local risk acceptance and every external-use restriction. Record actual results below as implementation proceeds, not completion based on authorization alone.

## Historical bootstrap outcome — independent dependency blocker

2026-10-21: all plan context was loaded and bootstrap proceeded under the valid Node-only exception. **F1 now stops on the actual dependency audit, not on the pending Node release.** No broader exception was requested or inferred.

- Official uncached index still identifies Node 24.22.0 (2026-10-14, security=false) as latest Node 24; this does not establish the pending fixes. Downloaded the official darwin-arm64 archive and checksum list over HTTPS. `shasum -a 256 -c` passed for SHA-256 `6a9724d9b50a5f22b4816cded441b5a8d9ddae546191a5e5b7efa5a5e2ee26d5`. Executable is project-local `.local/runtime/node-v24.22.0-darwin-arm64/bin/node`, version 24.22.0, bundled npm 11.19.1. No unrelated default Node installation changed.
- Generated official `create-next-app@16.4.2` privately with TS/App Router/ESLint/Tailwind/src-dir, no Compiler/Cache Components/agent feedback/Git/dependency install. Official npm registry integrity: `sha512-cl9Ub4WeZipMwADysfMZ3iUMOWel6kM64ODYI+N4ipWgKsb4KelkqQQqVbJEGljyyLzeHYum7bv+ZqFmO3Z+bA==`. Root configuration is starter-derived, using exact adopted pins rather than blindly installing historical seeds. Starter React 19.3.0 was updated normally to verified 19.3.1; TS starter range was replaced by 6.0.3. No remote font or application UI was copied.
- Root manifest/lockfile/tool configurations exist; no app source exists yet. Native `npm install --ignore-scripts --no-fund` and clean `npm ci --ignore-scripts --no-fund` under verified Node/npm resolved 437 packages. `npm ls --depth=0` confirms pins; `npm audit signatures` verified 437 registry signatures and 130 attestations. Lifecycle scripts remain blocked. Pending scripts were inventoried for esbuild, fsevents and unrs-resolver; none was enabled. The terminal reset exports across calls: initial private starter generation and an initial failed npm-install attempt inadvertently used default Node23/npm10, not the approved runtime. The latter failed inside npm before installing. Subsequent successful installation/audit commands explicitly exported verified Node24/npm11. This is a bootstrap process error, not an approved runtime exception; regenerate the private starter under explicit verified Node24 on resumption before claiming the starter-runtime prerequisite passed. No application was run under Node23.
- **Native `npm audit --json` failed:** five HIGH findings along `eslint-config-next@16.4.2` → `@next/eslint-plugin-next@16.4.2` → `fast-glob@3.3.1` → `micromatch@4.0.8` → `braces@3.0.3`. One root advisory: [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm), HIGH stack-exhaustion DoS, published September 18 and updated October 2. Direct GitHub advisory API reports affected `<=3.0.3`, `first_patched_version: null`; registry latest braces is 3.0.3, micromatch 4.0.8, Next config/plugin 16.4.2. npm suggests a forced config downgrade to 14.2.35, not a verified compatible resolution. No override, force fix, suppression, allowlist or changed expectation applied. ESLint 9.39.5 from the starter line is additionally unsupported/deprecated; replace with a supported, compatibility-verified selection before acceptance.
- Homebrew PostgreSQL 18.6_1 installed after the user explicitly selected **Continue Homebrew installation** at its shared-dependency prompt. Binaries report PostgreSQL 18.6; PG17 was not relinked/replaced. Installer created its default empty PG18 cluster under Homebrew with local trust authentication, **not** the required isolated application cluster; no server was started/connected. It installed OpenSSL4 4.0.3 and unlinked OpenSSL3, and upgraded krb5 to 1.22.2_2. These shared machine changes may affect unrelated tools. Apple Command Line Tools were reported outdated; no sudo/privileged repair attempted. No existing cluster data was read or modified.
- No web/worker startup, account provisioning, application compile/lint/build/test, transaction/queue, browser, denial, persistence or cleanup test ran. No matrix row is accepted. No external account/cost/provider/real-data/pilot/deployment/remote Git operation occurred.
- Bootstrap-only checks passed: JSON parse, manifest/lock root dependency equality, ESLint configuration syntax, editor diagnostics, Git whitespace and YAML approval/frozen-marker/task-status checks. These are not application verification.

**Resume condition:** a compatible supported lint package chain that passes the unchanged native audit without overrides/suppression, or a human-approved upstream plan amendment for a different lint approach. The pending Node exception alone cannot authorize this new finding. Keep every task unchecked and all remaining F1/application acceptance open. The sections below are historical pre-bootstrap evidence, not claims that artifacts are still absent.

## Historical user instruction — keep the preset and pause (superseded)

After bootstrap returned, the main agent independently reproduced the five HIGH audit findings using the verified project-local Node 24.22.0/npm 11.19.1 and inspected the actual dependency chain. Registry metadata for latest stable Next config/plugin 16.4.2 and plugin 16.5.0-canary.20 still includes `fast-glob@3.3.1`. ESLint 10.13.0 is current, but existing React 7.37.5 and JSX accessibility 6.10.2 plugins do not declare ESLint 10 compatibility; a forced major upgrade is not a verified fix. A supported alternative lint stack would require explicit rule-coverage validation and a clean audit, not simply removal of the preset or checks.

The user was offered replacement of the lint stack versus preserving the exact Next preset and pausing. On 2026-10-21 the user explicitly selected **Keep the exact Next ESLint preset and pause**. Honor that newer instruction: no lint replacement, forced downgrade, override, advisory suppression, security exception or further implementation. The Node-only acceptance remains valid; this separate finding remains unresolved. No application acceptance or matrix row passed. No later review/completion step or Git commit is warranted for this incomplete bootstrap.

## Authority and outcome

The user authorized local story 1 implementation and necessary dependency installation using synthetic data only, and selected review plus a clean baseline commit. No external accounts, costs, AI-provider calls, deployment, real data or pilot execution are authorized. This supersedes the older planning-only permission text for this bounded story, not the other gates. The build workflow has not edited/pulled/marked any ticket.

**Current decision — user-approved local risk exception, not a security pass.** After the pending release and HIGH severity were explained, the user explicitly said **"i do not consider this blocker, continue"** on 2026-10-21. This supersedes the previous stop solely for the unpublished Node fixes and authorizes story 1 local synthetic implementation using a supported published Node release whose official download checksum is verified. Prefer Node 24 LTS (latest verified available release at the preceding check: 24.22.0), installed separately without changing unrelated default runtimes. If a fixed patch is now published, prefer it; do not repeatedly halt only because it remains pending.

This is informed acceptance of a specific unresolved risk, **not** evidence that the advisory is fixed, F1 passed, or hosted/real-data use safe. Restrict web, database and other listeners to loopback; use only synthetic fixtures and no provider calls. Other package/audit/compatibility/privacy/transaction checks remain required without suppressed checks or dependency overrides. Record executable, version and checksum verification, and recheck/update to the fixed release when available and before any broader use. No deployment, external account, cost, real-data processing or pilot is authorized. Historical blocked findings below remain evidence of the earlier decision, not current instructions to stop solely on this accepted risk.

At the time of this decision no application artifacts or application test results exist yet; subsequent implementation must record actual evidence rather than treating this exception as a completed check.

## What F1 means and how it is resolved

F1 is the project's **runtime, starter and transactions feasibility gate**, not an application error code or an external service that needs an account. Node.js runs the web/build/worker tooling. The gate checks that its supported version has the required security fixes, that the chosen application packages actually work together, and that PostgreSQL/queue transactions behave correctly.

The checks are phased; requiring an actual lockfile does not mean all checks must somehow run before a starter exists:

| Phase                                              | Evidence needed                                                                                                                                 | Current state                                                                                                                                                                               |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Before starter or application installation         | Supported official Node release, verified artifact/checksum and installed executable; prefer a patch tied to the announced fixes when published | Runtime installed and checksum verified under local exception; regenerate private starter under explicit Node24 after the documented environment-reset error; upstream fix still unverified |
| After runtime acceptance and starter generation    | Actual pinned lockfile, compatible Next/React/TS6/auth/web/worker compilation, separate lint and native dependency audit                        | Lockfile installed; native audit failed; compile/lint/application checks not run                                                                                                            |
| After isolated local PostgreSQL 18 and queue setup | Real enqueue rollback and duplicate-effect integration tests using the shared SQL client                                                        | PostgreSQL18 binaries installed, no isolated project cluster or queue yet; transaction tests not run                                                                                        |

Full security-gate resolution still requires the published fixed runtime and remaining checks. The explicit exception above permits local implementation before the pending fix; it does not resolve the advisory. The assistant cannot publish the upstream fix or guarantee its release time. No further plan approval, paid service or external account is needed for this authorized local work.

## Reviewed Git baseline

- Created local commit `d123d79317055a801f2957b985e05cfd45b20b1b`: reviewed planning documents and installed BMad tooling, plus explicit root exclusions.
- Staged 59 explicitly selected files; credential-pattern scan reported zero suspected files. This is a bounded pattern check, not a guarantee of secret absence or an application security audit.
- Excluded local Python environments, generated workflow snapshots, personal BMad configuration, environment/credential files, local private data and build/test caches. No push occurred. Working tree was clean immediately after the commit.
- Two pre-existing Markdown two-space line breaks triggered the default whitespace check; preserved them. The check with end-of-line whitespace excluded passed. No test checks were suppressed or invented.

## Local inventory — observed, not approved

| Component                     | Observation                             | Decision                                                                       |
| ----------------------------- | --------------------------------------- | ------------------------------------------------------------------------------ |
| Active Node                   | 23.10.0 via existing nvm                | Reject: official release schedule marks 23 EOL                                 |
| Active npm                    | 10.9.2                                  | Inventory only; no application install performed                               |
| Other installed Node lines    | 14, 16, 17, 18, 19, 20, 22.21.1, 25.2.1 | No verified replacement for the pending security-fixed supported runtime       |
| Default PostgreSQL binary     | 11.22                                   | Reject for planned PostgreSQL 18 and recorded pg-boss minimum                  |
| Additional PostgreSQL binary  | 17.7 (Homebrew)                         | Not the adopted PostgreSQL 18 seed; leave existing installation/data untouched |
| PostgreSQL 18                 | No Homebrew opt entry found             | Installation and isolated local cluster still required after runtime gate      |
| Application manifest/lockfile | Absent                                  | Framework/auth/worker compatibility and dependency audit not run               |

No PostgreSQL server was started or connected to; existing clusters and real data were not inspected. Local clock was October 21 at UTC+08:00; UTC was still October 20. A calendar date is not evidence that a scheduled release has shipped.

## Primary-source evidence

1. [Official October 2026 security announcement](https://nodejs.org/en/blog/vulnerability/october-2026-security-releases), reread with cache disabled: fixes announced for 26.x, 24.x and 22.x, highest severity **HIGH** on every listed line; releases expected on or shortly after October 21. The retrieved announcement does not name the fixed versions.
2. [Official distribution index](https://nodejs.org/dist/index.json), independently fetched over HTTPS with `Cache-Control: no-cache`, compacted using `jq` without installing packages:

   | Line | Latest indexed release | Date       | Security flag | Last security-tagged release |
   | ---- | ---------------------- | ---------- | ------------- | ---------------------------- |
   | 22   | 22.23.3                | 2026-09-23 | false         | 22.23.2, 2026-07-28          |
   | 24   | 24.22.0                | 2026-10-14 | false         | 24.18.1, 2026-07-28          |
   | 26   | 26.12.0                | 2026-10-14 | false         | 26.5.1, 2026-07-28           |

   The index's security flag alone is not the acceptance test: none of these releases provides evidence of fixing this later announced batch.

3. [Latest Node 24 distribution checksums](https://nodejs.org/dist/latest-v24.x/SHASUMS256.txt), independently fetched without cache: filenames still identify 24.22.0, corroborating the index. This checked publication identity only; no runtime binary was downloaded or checksum verified.
4. [Official Node release schedule](https://nodejs.org/en/about/previous-releases): 24 and 22 LTS, 26 Current, 23 EOL. Downgrading to the older installed 22.21.1 does not establish the required fix.

**Conclusion:** no acceptable security-fixed Node version has been verified at this check. This is a time-bounded blocking finding, not a claim that the release can never become available or that all future patches are unsafe.

## Historical approved continuation recheck — before explicit exception

- 2026-10-21 — User selected **Approve and continue**. The plan was reread from disk, approved unchanged and its intent frozen; this did not waive F1.
- Rechecked at `2026-10-21T02:06:48+08:00`: uncached official announcement still says releases will become available; the independently fetched index still lists 22.23.3/24.22.0/26.12.0, and the latest Node 24 checksum filenames still identify 24.22.0. No security-fixed replacement was verified. Canonical Git baseline is unchanged.
- **Outcome remains blocked.** No runtime/application dependencies installed, app code scaffolded, application tests run, external account created, cost incurred, AI-provider call made or deployment attempted. Preserve plan approval for resumption; first action is fresh F1 verification once the release is published.

## Historical resolution investigation — before explicit exception

- At `2026-10-21T02:12:54+08:00`, fetched the raw official announcement HTML directly over HTTPS, independently of the page reader, plus the uncached official index and latest Node 24 checksum listing. The announcement still says the fixes **will** be released; latest indexed versions remain 22.23.3/24.22.0/26.12.0, and latest Node 24 checksum filenames remain 24.22.0.
- A separate read-only investigation cross-checked the official release notes and latest distribution listings for 22/24/26. It found no official evidence identifying an already-published supported alternative as fixing this advisory. A `security: false` flag alone is not a verdict; the blocking evidence is the pending announcement and absence of a verified fixed version across these sources.
- At this local check it was still October 20 in UTC. The announcement says “on, or shortly after” October 21, not a guaranteed publication time. Do not infer availability from the local calendar or invent an ETA.
- **Resolution not yet possible under the approved gate.** Preserve the approval and stop before runtime/application installation. No application check has passed; an independent evidence review is not an application security test.

## Historical remaining-check instructions — superseded by measured result above

Proceed now under the explicit exception: reconcile official release metadata/checksums and install the selected supported release in a separate nvm version; do not replace unrelated runtimes or PostgreSQL data. Record exact executable/version and artifact verification. Recheck starter and package advisories/engine/peer constraints before consuming a pinned official Next starter. Once the security fix is published, reconcile its advisory/release notes/distribution/checksums and update; this remains required before any broader use.

Establish an actual lockfile and prove Next/React/TypeScript 6/Better Auth/web/worker compile together, run separate lint and native lockfile audit without overrides/suppressions, install isolated local PostgreSQL 18, and exercise real pg-boss enqueue rollback and duplicate effects using one checked-out SQL client. These checks require actual application artifacts and have **not passed** by virtue of this document. Stop again on any material incompatibility/security finding.

The [approved implementation plan](tickets/story-private-txt-to-confirmed-plan-tracer-plan.md) preserves S1 scope with the explicit local runtime-risk amendment. F1 is not fully passed; other checks remain binding. Full purge/retention/restore, real GenAI and release gates remain later stories; neither this preflight nor the eventual manual tracer proves them.

## Runtime source switched to nvm — 2026-10-21

- User instruction: load Node through nvm instead of the project-local standalone binary, declare only the version, and delete the standalone copy. No waiver, F1 change or ticket advancement was requested or inferred.
- Installed Node v24.22.0 through nvm 0.39.3 from the official darwin-arm64 artifact; nvm reported **Checksums matched!** against the official SHASUMS list. Executable `~/.nvm/versions/node/v24.22.0/bin/node`, node 24.22.0, bundled npm 11.19.1 — exactly matching `engines` and the pre-existing `.nvmrc`. This restores the preflight's original "install the selected supported release in a separate nvm version" instruction; the plan-era `.local/runtime` copy (SHA256 `6a9724d9b50a5f22b4816cded441b5a8d9ddae546191a5e5b7efa5a5e2ee26d5`) was a deliberate deviation, now removed.
- Guard unchanged: `scripts/checks.mjs` still hard-fails unless darwin + Node v24.22.0; it now resolves npm next to the running Node (`npm_execpath` or `process.execPath`) instead of the standalone path, and still injects `NPM_CONFIG_USERCONFIG=/dev/null`, `NEXT_TELEMETRY_DISABLED=1` and the Playwright path into every gate child. Those variables are now documented in `.env.example`. The machine's nvm default remains EOL Node 23; every terminal must `nvm use`.
- Smoke under the nvm runtime: both typechecks, 110 unit tests and the full lint+coverage/probe run passed. The complete `npm run checks` gate was **not** re-run for this tooling-only change; run it before the next story work.
- The accepted pending-security-release exception, its recheck obligations and the F1 scope are unchanged by the runtime source.
