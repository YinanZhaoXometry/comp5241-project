# G4 feasibility spike — isolated code runner dossier (epic-6 entry 6.2)

## Disposition

**Admission-grade feasibility evidence, produced 2026-10-29. Nothing is selected, wired or
activated.** This dossier is the recorded admission INPUT for epic-6 entry 6.7 ("Online coding
in the isolated runner", tickets.toml `unknown` "G4 runner admission") — entry 6.7 must build its
own fresh admission/audit/fingerprint evidence on these inputs before any execution is enabled,
exactly per the parser-container precedent (`docs/bounded-document-extraction.md`): fail-closed,
quarantine on doubt. Per AD-12 and gate G4, an ordinary container or in-process sandbox is **not
sufficient evidence** by itself; this dossier records what a hardened-container harness achieved
on this machine and what remains open. No product code path was touched; the disposable harness
lives at `spikes/g4-feasibility/runner/` and is committed as spike evidence only.

Scope honesty: single developer machine (macOS 27.0.1, Apple Silicon, 32 GB / 10 cores),
Docker CLI 29.5.3 / engine 29.5.2 on Colima 0.10.3 (Linux aarch64 VM, cgroups v2, shared kernel
with the daemon's other containers). This is NOT a kernel-escape certification, NOT a production
isolation/load/SLA proof, and NOT a licence-compliance-for-deployment claim. The web/worker
process, `eval` and Node `vm` were never used as the runner (AD-12).

## Harness design (what was probed)

Per-job supervisor `spikes/g4-feasibility/runner/run_job.py` (one job = one container):

- Image: pristine official `python@sha256:aae362254cea6b75fe812f0b428f10b3b361a090fe5655fb1d03937f6d38cda9`
  (linux/arm64, the same digest-pinned base the parser precedent documents; already local — the
  spike added ZERO image pulls). Job payload is fed via stdin (`python -I -B -`); **no bind
  mounts, no volumes, no ports, no secrets** anywhere in the harness.
- Flags per job (verified per-run from `docker inspect` of the finished container, recorded in
  `g4-probe-results.json` under `applied_flags`): `--network none`, `--user 65532:65532`,
  `--read-only`, `--cap-drop ALL`, `--security-opt no-new-privileges`,
  `--security-opt seccomp=<strict profile>`, `--memory 256m --memory-swap 256m` (equal cap: no
  swap), `--cpus 0.5`, `--pids-limit 16`, `--tmpfs /tmp:rw,noexec,nosuid,size=16m`,
  `--log-driver none`. Wall deadline (10 s default) and output caps (1 MiB evidence cap,
  8 MiB bounded host capture) are enforced by the supervisor, which also force-removes the
  container even on failure and records daemon-side State (ExitCode/OOMKilled/timestamps).
- Seccomp: default-deny aarch64 profile `seccomp-runner-strict.json`, derived from the admitted
  parser profile (`src/worker/parser/seccomp.json`) plus the syscalls a general CPython
  pure-function job measurably needs. `clone`/`clone3`/`fork`/`vfork` (no processes, no threads)
  and all socket syscalls are DENIED — syscall-level egress denial **in addition to** the missing
  network namespace. `execve` is kept (the OCI runtime applies the filter before exec'ing the
  entrypoint; denying it prevents container start) with `/tmp` mounted `noexec`; `execveat` stays
  denied. A second TEST-ONLY profile (`seccomp-runner-relaxed-test.json`) allows clone so the
  cgroup `pids-limit` could be demonstrated independently of seccomp.
- Ephemeral filesystem: read-only rootfs + capped tmpfs scratch only; every container is
  force-removed (`docker rm -f`) after evidence capture — nothing persists after a job.
- Concurrency: the battery runs jobs strictly serialized (max 1 at a time). That is a structural
  supervisor cap, not a load-tested concurrency controller.
- Deterministic grading (legal jobs): the payload runs the exercise against test INPUTS inside
  the sandbox and prints results; the SUPERVISOR (server analog) compares them against expected
  values outside the sandbox — deterministic approved tests, never model-awarded scores.

## Probe results (all 18 CONTAINED/OK; full rows in g4-probe-results.json)

Environment: docker 29.5.3/29.5.2, context `colima`, Colima 0.10.3. **Recorded artifact run:
2026-10-29T01:39:33+0800** — the post-review re-run after the disk-fill assertion fix (the
first battery, 01:13, was equivalent: 18/18 CONTAINED; only timings differ). The JSON carries
`started`, exact per-row flags, timings and stdout/stderr excerpts.

| Probe | Outcome | Evidence (measured, artifact run) |
| --- | --- | --- |
| legal_correct | graded CORRECT by deterministic comparison | exit 0, 0.107 s |
| legal_incorrect | same comparison grades INCORRECT | exit 0, 0.115 s |
| legal_runtime_error | explicit traceback outcome, no crash-to-pass | exit 1, 0.406 s |
| esc_host_paths | docker socket/host paths/traversal all denied (ENOENT/EACCES); no bind mounts exist | 0.113 s |
| esc_proc_tricks | pid 1 is the container's own `python -I -B -` (pid namespace); uid/gid 65532; tmpfs `rw,nosuid,nodev,noexec,size=16384k` in /proc/mounts; /proc/kcore EACCES; /proc/sys write EROFS; unshare(CLONE_NEWUSER) EPERM; ptrace EPERM | 0.165 s |
| esc_priv_escalation | setuid(0)/setgid(0)/chown-to-root EPERM; mount(2) EPERM; writes to /etc, /usr, /var all EROFS; a setuid bit placed on tmpfs is inert (nosuid) | 0.163 s |
| net_socket_create | socket(2) itself denied at syscall level: `PermissionError: [Errno 1] Operation not permitted` (tcp and udp) | 0.177 s |
| net_dns | getaddrinfo fails: `PermissionError errno 1` (no netns + denied socket) | 0.23 s |
| net_http | http:// and https:// example.com both denied | 0.449 s |
| net_metadata | 169.254.169.254:80/:8080, fd00:ec2::254 and metadata HTTP all denied | 0.503 s |
| res_forkbomb_seccomp (strict profile) | fork(), subprocess and threads all denied before anything spawns | 0.223 s |
| res_forkbomb_pids (relaxed test-only profile) | cgroup pids-limit stopped the bomb: 7 forks OK then `BlockingIOError [Errno 11] Resource temporarily unavailable` (cap 16 incl. init; the exact capped count varies run-to-run — 8 and 4 in earlier local runs — the kernel cap is the finding); survivors killed at wall, exit 137 | 12.097 s |
| res_mem_balloon | cgroup OOM kill: `OOMKilled: true`, exit 137 after ~192 MiB allocated against the 256 MiB cap | 0.223 s |
| res_infinite_loop | wall deadline kill at 8.112 s, exit 137; CPU quota 0.5 | 8.112 s |
| res_disk_fill | capped tmpfs produced ENOSPC (errno 28) at exactly 16 MiB written; host disk untouched | 0.113 s |
| res_output_flood | supervisor bounded capture stopped at exactly 8 MiB host bytes, `kill_reason: output_hard_cap`, exit 137, recorded output truncated to the 1 MiB evidence cap | 0.221 s |
| cpu_count_ref (1.0 CPU) vs cpu_count_capped (0.25 CPU) | iteration ratio 0.203 — CPU quota enforced | 3.149 s / 3.197 s |

## Cleanup verification (recorded in g4-probe-results.json `cleanup`)

After the battery: `docker ps -a --filter name=g4spike-` residue **none**; docker volumes
unchanged (before == after); images unchanged (zero added — no new pulls, no leftover layers);
harness workdir `spikes/g4-feasibility/runner/.work` empty/removed; 18/18 containers
force-removed. The espeak trial's derived image (narration dossier) was `docker rmi`'d
immediately after its trial. (Honesty note: one intermediate battery run recorded
`images_unchanged: false` purely because the narration espeak trial was rebuilding its
throwaway image concurrently; the recorded artifact above is the solo re-run. The espeak trial
image is not spike residue — it is created and removed by `trial-espeak.sh` on every run.)

## Findings, limits, uncertainties (read before relying on this)

1. **Ordinary-container caveat stands (G4).** These are hardened containers on a shared-kernel
   VM under Colima. G4's bar for activation — "runner engine/host deployment proof" — is not
   met by this dossier alone; entry 6.7 must decide the production runner host story (dedicated
   runner hosts per AD-12, image build/audit/fingerprint chain, admission file) before any
   activation. Fail-closed means: without that fresh admission, no user code runs.
2. **Seccomp allowlist is empirical, not proven-minimal.** The strict profile worked for every
   probe on first application (no iteration was needed for CPython startup or the payloads);
   a wider real exercise set (e.g. `math`, `decimal`, `datetime`, `json`, `re`) may surface a
   missing syscall — add narrowly, never remove denials, and re-record.
3. **No threads/subprocesses by design.** The strict profile denies clone entirely; exercises
   needing `threading` or `subprocess` are out of scope for the AD-12 "bounded Python
   pure-function exercises" seed. If ever needed, that is a new admission, not a relaxation.
4. **Output capture is bounded by the supervisor**, and the flood probe initially exposed
   pipe-buffering overshoot (35 MB transient) before the harness was fixed to bounded-read
   capture (exactly 8 MiB max on host). Recorded here because the first design was a real
   finding, not a hidden rewrite: unbounded `stdout=file` capture is NOT acceptable.
5. **No load/concurrency test.** One job at a time; the concurrency limit is structural.
   Multi-job throughput, queueing, and per-host caps are 6.7 work.
6. **No kernel/syscall trace claims.** Evidence is what the kernel returned to the probes
   (errno values), `docker inspect` flags/state, and outside-process docker checks — consistent
   with the parser precedent's honesty level; no packet capture or strace was used.
7. **Digest provenance.** The base image was already present and is the same pristine digest
   documented in `docs/bounded-document-extraction.md` (PSF-licensed Python). The spike did not
   re-verify its upstream manifest; admission for 6.7 must re-pin/re-verify per its own build.
8. **Machine-specific evidence kept verbatim.** The recorded artifacts deliberately contain
   this machine's identifiers (absolute home path in `esc_host_paths.py` and the JSON, host
   uname/hostname) so the evidence shows exactly what ran; they are not portable claims.
   Neutralize before any distribution of the artifacts beyond this repository.
9. **"Host not starved / other lane unaffected" is indirect evidence** (bounded timings,
   enforced caps, no observed host impact during the shared-machine run) — entry 6.7's
   admission must NOT inherit it as a proven property; a dedicated measurement belongs to 6.7.
10. **The output cap bounds stdout only.** stderr is read once, post-exit, and is uncapped in
    principle (bounded de facto only by the wall deadline). Fix-forward for 6.7: bound stderr
    capture exactly like stdout before admitting any job whose payloads can reach it.

## Reproduction

```bash
cd spikes/g4-feasibility/runner
./run-job.sh --name legal_correct --payload probes/legal_correct.py   # one job + evidence JSON
./run-probes.sh                                                       # full battery -> g4-probe-results.json
```

Requires: local Colima/docker daemon over its Unix socket (never TCP), the pinned image already
local. The battery takes ~35 s. All probe payloads are original synthetic content.
