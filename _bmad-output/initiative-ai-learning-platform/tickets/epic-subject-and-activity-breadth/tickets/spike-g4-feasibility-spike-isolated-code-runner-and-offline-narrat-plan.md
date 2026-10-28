---
title: 'G4 feasibility spike: isolated code runner and offline narration (6.2)'
type: 'chore' # spike evidence + disposable harness; no product code path changes
ticket: 2
created: '2026-10-29'
status: 'in-progress'
baseline_revision: '766a12485a99f760840982264b66730f00c6f036'
route: 'oneshot'
route_source: 'auto'
risk: 'high'
review: ''
review_source: ''
lenses_ran: []
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/docs/bounded-document-extraction.md'
  - '{project-root}/_bmad-output/initiative-ai-learning-platform/tickets/epic-subject-and-activity-breadth/epic-subject-and-activity-breadth.md'
warnings: ['oversized']
deferred: []
---

<intent-contract>

## Intent

**Problem:** Gate G4 blocks epic-6 entries 6 (narrated slides) and 7 (online coding): no feasibility evidence exists for a per-job no-network isolated code runner, nor for an offline narration engine/voice with licence, cost and quality findings. AD-12 and the 2026-10-29 owner start make this evidence mandatory before any activation.

**Approach:** Run a disposable spike harness under `spikes/g4-feasibility/` (outside every lint/typecheck/build surface) that (a) executes probe payloads in hardened, digest-pinned, no-network Colima containers with enforced limits and verified cleanup, and (b) trials offline TTS candidates locally with cited licence research. Record two admission-grade dossiers plus a machine-readable probe-results file in the epic folder, following the parser-container precedent: fail-closed conclusions, quarantine on doubt, select and activate nothing.

## Boundaries & Constraints

**Always:** Work only in this worktree on `feat/epic6-g4-spike`; every Bash call under Node v24.22.0 via nvm with `NPM_CONFIG_USERCONFIG=/dev/null NEXT_TELEMETRY_DISABLED=1`. Containers only via the local Colima docker daemon over its Unix socket (context `colima`), from the already-local pristine official base `python@sha256:aae362254cea6b75fe812f0b428f10b3b361a090fe5655fb1d03937f6d38cda9` (documented in docs/bounded-document-extraction.md) or another official minimal image pinned by digest and recorded. Every sandbox job: `--network none`, `--rm`, non-root UID 65532, `--read-only`, `--cap-drop ALL`, `--security-opt no-new-privileges`, default-deny seccomp, `--memory 256m --memory-swap 256m`, `--cpus`, `--pids-limit`, wall deadline, capped captured output, tmpfs scratch (`noexec,nosuid,size` capped), `--log-driver none`, no bind-mounts (payload via stdin), no published ports, no secrets. Bound abuse probes tightly (the host is shared with another lane). Clean up and verify every container/volume/image/temp file; record `docker ps -a` / `docker volume ls` evidence. Licence claims cite URLs; no remote TTS calls. Dossiers state scope honestly: local single-machine feasibility, admission INPUT for entries 6.6/6.7, no production isolation/licence-compliance/deployment claim, and the agent cannot audition audio (objective metrics plus owner-listenable artifacts).

**Never:** No product path changes (`src/`, `migrations/`, `scripts/`, `tests/`, `package.json`, lockfile, configs untouched); no new project dependencies; no global installs (no brew/global pip/npm; only `uv venv` inside the spike folder or disposable containers); no `npm run db:start`/`checks`/`dev`, nothing binding ports 55432/3000; never the web/worker process, `eval` or Node `vm` as runner; no docker TCP port; no engine/voice/provider named as selected; no git push, no worktree/branch operations; no real personal data.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Legal pure-function job | correct/incorrect Python via stdin | graded outcome by approved deterministic tests; exit 0 | wrong answer is an honest incorrect outcome, never an error |
| Escape attempts | read host paths, docker socket, `/proc` tricks, setuid, mount, traversal | kernel/daemon denial each (ENOENT/EACCES/EROFS/EPERM/nosuid), host unreachable by construction (no mounts) | denials recorded verbatim per probe |
| Resource exhaustion | fork bomb, memory balloon, infinite loop, disk fill, output flood | each killed by the enforced limit (seccomp/pids-limit, OOM 137, wall+CPU deadline, ENOSPC on capped tmpfs, supervisor output cap) with recorded timing; host not starved | supervisor force-removes container even on failure |
| Egress attempts | DNS resolve, HTTP fetch, metadata IP 169.254.169.254 | all fail: no network namespace and seccomp-denied socket syscalls | failures recorded verbatim |
| Cleanup | after every job, success or abuse | no container/volume/host temp file remains; verified via `docker ps -a`, `docker volume ls`, scratch listing | any leftover is itself a recorded finding |
| Narration trial | original synthetic sentence per candidate | WAV artifact, wall time, peak RSS, disk size, licence verdict with cited URL | a candidate too heavy to trial is recorded declined with reason, never guessed |

</intent-contract>

## Code Map

- `docs/bounded-document-extraction.md` — the dossier shape to mirror: fail-closed admission, quarantine-on-doubt, probe table with timings, licence inventory with citations, scope-honesty paragraph.
- `src/worker/parser/Dockerfile` + `src/worker/parser/seccomp.json` — hardening precedent (digest-pinned official base, default-deny aarch64 seccomp allowlist, nonroot 65532, no pip/cache in runtime); the runner profile derives from this allowlist minus `execve`, plus any syscall CPython provably needs (added only on failing evidence, recorded).
- `src/adapters/document-sandbox.ts` + `scripts/build-extractor.ts` — read-only reference for how the admitted sandbox is supervised and how admission/audit/fingerprint gate readiness; not modified.
- `eslint.config.mjs`, `tsconfig.json`, `package.json` (`lint`, `typecheck`) — proof that `spikes/` sits outside every scanned surface (lint targets `src scripts tests` + listed configs; tsconfig includes only `src/scripts/tests/*.ts`), so no lint/typecheck run is required.
- `_bmad-output/initiative-ai-learning-platform/tickets/epic-subject-and-activity-breadth/` — destination for `g4-runner-dossier.md`, `g4-narration-dossier.md`, `g4-probe-results.json`; entries 6.6/6.7 cite these as admission input.
- `spikes/g4-feasibility/` — NEW disposable harness: `runner/run-job.sh` (per-job supervisor), `runner/seccomp-runner.json` (+ test-only relaxed variant for the pids-limit demonstration), `runner/probes/*.py` (original synthetic payloads), `runner/run-probes.sh`, `narration/` (uv-venv trials, sample text, WAVs, timings), `README.md`.

## Tasks & Acceptance

**Execution:**
- [ ] `spikes/g4-feasibility/runner/run-job.sh` + `seccomp-runner.json` — implement the per-job supervisor: payload via stdin into the digest-pinned base with the full hardening flag set, wall deadline, capped output capture, forced cleanup; concurrency serialized (documented semaphore) — this is the harness probes run through.
- [ ] `spikes/g4-feasibility/runner/probes/*.py` — write original synthetic probe payloads: escape (host paths, docker socket, `/proc` tricks, setuid/mount/traversal), resource (fork bomb, balloon, loop, disk fill, output flood), egress (DNS, HTTP, metadata IP), plus legal correct/incorrect jobs.
- [ ] `spikes/g4-feasibility/runner/run-probes.sh` — run the battery with tight caps; write per-probe outcome/exit/timing into `g4-probe-results.json`; include the seccomp-iteration record and `docker inspect` evidence (CapDrop, no mounts, network mode none).
- [ ] `spikes/g4-feasibility/narration/` — local disposable trials: Piper via `uv venv` (engine + one voice model), macOS `say`; espeak-ng timed inside a derived throwaway container if smooth, else declined-with-reason; Coqui-TTS assessed on documented facts unless a trial is proportionate; record wall time per sentence, peak RSS, disk footprint, sample WAVs, transcript/caption findings.
- [ ] Web licence research with cited URLs for every engine AND voice/model candidate (engine licence, voice/model licence, dataset terms where discoverable).
- [ ] `_bmad-output/.../epic-subject-and-activity-breadth/g4-runner-dossier.md` — admission-grade runner dossier: exact commands, flags, limits, digests, every probe result with timing, uncertainties, fail-closed conclusion, explicit "admission input for entry 6.7, nothing selected/activated".
- [ ] `_bmad-output/.../epic-subject-and-activity-breadth/g4-narration-dossier.md` — admission-grade narration dossier: candidates, licence verdicts with sources, resource cost, honest labelled quality note (agent cannot audition; owner-listenable artifacts), transcript/caption evaluation, fail-closed conclusion, "admission input for entry 6.6, nothing selected/activated".
- [ ] Cleanup pass — remove every container, derived image, volume and temp file added; record `docker ps -a`, `docker volume ls`, before/after `docker images` evidence.
- [ ] Commit on `feat/epic6-g4-spike` in repo style; leave `git status` clean.

**Acceptance Criteria:**
- Given the recorded digest and flags, when each escape/egress probe runs, then the denial mechanism (seccomp/namespace/permissions/no-mounts) and verbatim outcome are recorded per probe in `g4-probe-results.json` and named in the runner dossier.
- Given the same harness, when each resource-exhaustion probe runs, then it is stopped by a recorded enforced limit within recorded bounds and the host shows no starvation (another lane's gate is unaffected).
- Given any finished probe (success or abuse), when the supervisor completes, then `docker ps -a` and `docker volume ls` show no spike residue and the dossier records that evidence.
- Given the two dossiers in the epic folder, when entries 6.6/6.7 begin, then they can cite them as admission input; the dossiers name no selected engine/voice/provider and claim no production isolation, licence compliance or deployment.
- Given the narration dossier, when a candidate is recorded, then engine AND voice/model licences each carry a cited URL and a verdict (local-evidence-usable / needs-verification / quarantine-on-doubt), and cost/quality notes are honestly labelled.
- Given the finished spike, when `git status` runs, then the tree is clean on `feat/epic6-g4-spike` and `git diff 766a124 -- src scripts tests package.json package-lock.json migrations` is empty.

## Implementation Notes

Route: `oneshot` was chosen deliberately — the estimated size exceeds the oneshot guideline, but this environment exposes no subagent-launch tool, and the full route's mandatory implementing-subagent launch would force the workflow's `no subagents` HALT; the plan therefore keeps full-route structure (Boundaries, matrix, Code Map, Tasks) and implements directly. Full-route sections are retained on that basis.

- Assumption: user-code language for the runner is Python (AD-12's own seed: bounded Python pure-function exercises); supervisor is bash + python3 stdlib inside the spike folder only.
- Assumption: base image is the already-local pristine official `python@sha256:aae36225…` (Alpine 3.24/3.14.8, provenance already documented) — zero new image pulls; any derived test image is removed after trials.
- Assumption: legal-job grading in the harness is deterministic approved tests run server-side (the supervisor compares outputs), never model-awarded.
- Assumption: sample WAVs committed as owner-listenable evidence total under ~2 MB; anything larger is regenerated by the committed trial script instead of stored.
- Assumption: quality notes are objective metrics plus file artifacts, labelled that the agent cannot audition audio; subjective quality is the owner's audition.
- Assumption: no `npm run` gate is needed (nothing under `src scripts tests` or listed configs changes); asserted via the empty diff check above.
- Blocked-if-hit: daemon unavailable, digest mismatch on the pinned base, or any probe leaking host state → record finding, stop that probe class, keep fail-closed (do not weaken limits to make a probe pass).

Implementation log (appended during the run, 2026-10-29):

- Files touched: `spikes/g4-feasibility/**` (harness, probes, trials, samples, README) and the three epic-folder evidence files (`g4-runner-dossier.md`, `g4-narration-dossier.md`, `g4-probe-results.json`). Zero product paths.
- Decision: the supervisor/battery are python3 stdlib (not bash) — macOS ships bash 3.2; the plan's "bash + python3 stdlib" assumption resolves to thin sh wrappers (`run-job.sh`, `run-probes.sh`) around `run_job.py`/`run_probes.py`.
- The strict seccomp profile ran CPython startup and every probe on FIRST application — no iteration needed; recorded as such (not proven-minimal, see dossier finding 2).
- Surprise (fixed, recorded in dossier finding 4): the output-flood probe initially exposed pipe-buffering overshoot (35 MB transient host capture under unbounded `stdout=file`); the supervisor was fixed to bounded-read capture (exactly 8 MiB max) before the recorded battery.
- Surprise (fixed): `say` refuses LEI16 data format in an AIFF container ("Opening output file failed: fmt?"); trials switched to WAV output.
- Narration finding: piper-tts 1.8.0 is GPL-3.0-or-later (the MIT-era rhasspy/piper is archived); the trialed en_US-amy-low voice's licence chain terminates in MycroftAI/mimic3-voices (CC-BY-SA-4.0, per-dataset terms unenumerated) → the voice is QUARANTINE-ON-DOUBT for activation, engine GPL recorded.
- Battery outcome: 18/18 probes CONTAINED/OK (`overall: ALL_CONTAINED`), cleanup verified (no containers/volumes/images/temp files; zero new image pulls — the pinned base was already local).

## Plan Change Log

## Review Triage Log

## Design Notes

Why a hardened OCI container on Colima (not firecracker/gVisor): unavailable on this shared host; the parser precedent already treats a default-deny-seccomp, no-network, cap-dropped, nonroot, read-only container as admissible for LOCAL synthetic evidence while stating it is not a kernel-escape certification. The runner dossier keeps that honesty and adds: per-job `--rm` + no volumes + tmpfs-only scratch gives the ephemeral-destroyed filesystem; `--network none` (no netns) plus seccomp-denied `socket*` gives two independent egress layers; the pids-limit is demonstrated under a test-only relaxed profile because the production-candidate profile denies `clone` outright. Concurrency is a supervisor-level serialized semaphore (max 1) — structural, not load-tested.

## Verification

**Commands:**
- `docker ps -a --filter name=g4spike-` -- expected: empty (no residue) after the battery
- `docker volume ls` before/after -- expected: unchanged (no spike volumes)
- `git diff 766a124 -- src scripts tests package.json package-lock.json migrations` -- expected: empty (no product path touched)
- `git status --short` -- expected: clean after the final commit

**Manual checks (if no CLI):**
- Every probe row in `g4-probe-results.json` is accounted for and named in `g4-runner-dossier.md`; narration samples exist and trial timings are recorded in `g4-narration-dossier.md`.
