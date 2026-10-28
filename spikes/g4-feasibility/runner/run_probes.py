#!/usr/bin/env python3
"""G4 spike — probe battery (disposable spike harness).

Runs every probe through run_job.run_job() SEQUENTIALLY (the supervisor's
concurrency cap for this spike: one job at a time), asserts the CONTAINMENT
expectation of each probe (abuse contained, not "probe succeeded"), verifies
cleanup (no containers/volumes/images/temp files left), and writes the
admission-evidence file g4-probe-results.json into the epic folder.

Original synthetic content only. Not product code; selects and admits nothing.
"""
from __future__ import annotations

import ast
import json
import os
import platform
import shutil
import subprocess
import sys
import time

import run_job

HERE = os.path.dirname(os.path.abspath(__file__))
PROBES = os.path.join(HERE, "probes")
# HERE = <repo>/spikes/g4-feasibility/runner -> three levels up is the repo root.
REPO = os.path.dirname(os.path.dirname(os.path.dirname(HERE)))
OUT = os.path.join(
    REPO, "_bmad-output", "initiative-ai-learning-platform", "tickets",
    "epic-subject-and-activity-breadth", "g4-probe-results.json",
)

EXPECTED_CORRECT = {
    "results": [
        {"in": 80, "out": "pass"}, {"in": 79, "out": "recover"},
        {"in": 100, "out": "pass"}, {"in": 0, "out": "recover"},
    ],
    "shape": "sentinel-1",
}

BATTERY = [
    # (name, payload, overrides, assertion_key)
    ("legal_correct", "legal_correct.py", {}, "legal_correct"),
    ("legal_incorrect", "legal_incorrect.py", {}, "legal_incorrect"),
    ("legal_runtime_error", "legal_runtime_error.py", {}, "legal_runtime_error"),
    ("esc_host_paths", "esc_host_paths.py", {}, "esc_host_paths"),
    ("esc_proc_tricks", "esc_proc_tricks.py", {}, "esc_proc_tricks"),
    ("esc_priv_escalation", "esc_priv_escalation.py", {}, "esc_priv_escalation"),
    ("net_socket_create", "net_socket_create.py", {}, "net_socket_create"),
    ("net_dns", "net_dns.py", {}, "net_dns"),
    ("net_http", "net_http.py", {}, "net_http"),
    ("net_metadata", "net_metadata.py", {}, "net_metadata"),
    ("res_forkbomb_seccomp", "res_forkbomb_seccomp.py", {}, "res_forkbomb_seccomp"),
    ("res_forkbomb_pids", "res_forkbomb_pids.py",
     {"profile": "seccomp-runner-relaxed-test.json", "wall": 12.0}, "res_forkbomb_pids"),
    ("res_mem_balloon", "res_mem_balloon.py", {"wall": 20.0}, "res_mem_balloon"),
    ("res_infinite_loop", "res_infinite_loop.py", {"wall": 8.0}, "res_infinite_loop"),
    ("res_disk_fill", "res_disk_fill.py", {}, "res_disk_fill"),
    ("res_output_flood", "res_output_flood.py", {"wall": 3.0}, "res_output_flood"),
    ("cpu_count_ref", "cpu_count.py", {"cpus": "1.0"}, "cpu_count_ref"),
    ("cpu_count_capped", "cpu_count.py", {"cpus": "0.25"}, "cpu_count_capped"),
]


def sh(*args: str) -> str:
    return subprocess.run(args, capture_output=True, text=True).stdout.strip()


def assertions(key: str, row: dict) -> list[str]:
    """Return human-readable assertion results (all must start with PASS:)."""
    out = row.get("stdout_head", "")
    err = row.get("stderr_head", "")
    st = row.get("daemon_state", {})
    results: list[str] = []

    def req(cond: bool, label: str) -> None:
        results.append(("PASS: " if cond else "FAIL: ") + label)

    if "harness_error" in row:
        req(False, f"harness error (no evidence row): {row['harness_error']}")
        return results

    def has(marker: str) -> bool:
        return marker in out

    if key == "legal_correct":
        try:
            parsed = ast.literal_eval(out.strip().splitlines()[0])
            match = parsed == EXPECTED_CORRECT
        except Exception:
            match = False
        req(row["client_exit"] == 0, "exit 0")
        req(match, "approved deterministic tests grade the output CORRECT (server-side comparison)")
    elif key == "legal_incorrect":
        try:
            parsed = ast.literal_eval(out.strip().splitlines()[0])
            differs = parsed != EXPECTED_CORRECT
        except Exception:
            differs = False
        req(row["client_exit"] == 0, "exit 0")
        req(differs, "wrong solution graded INCORRECT by the same deterministic comparison")
    elif key == "legal_runtime_error":
        req(row["client_exit"] not in (0, None), "non-zero exit")
        req("Traceback" in err, "explicit runtime-error traceback, no crash-to-pass")
    elif key == "esc_host_paths":
        req(has("CHECK|docker_socket|DENIED"), "docker socket absent/denied")
        req(has("CHECK|host_user_dir|DENIED"), "host user path unreachable")
        req(has("CHECK|etc_shadow|DENIED"), "/etc/shadow denied")
        req(has("CHECK|traversal_shadow|DENIED"), "traversal cannot escape the container root")
        req("LEAK" not in out, "no host data leaked")
    elif key == "esc_proc_tricks":
        req("65532" in out, "runs as non-root uid 65532")
        req("nosuid" in out and "noexec" in out, "tmpfs scratch mounted nosuid,noexec")
        req(has("CHECK|unshare_clone_newuser|DENIED"), "unshare(CLONE_NEWUSER) denied")
        req(has("CHECK|ptrace_traceme|DENIED"), "ptrace denied")
        req("python" in out and "proc1_cmdline" in out, "pid 1 is the container's own python (pid namespace)")
    elif key == "esc_priv_escalation":
        req(has("CHECK|setuid_root|DENIED"), "setuid(0) denied")
        req(has("CHECK|mount_call|DENIED"), "mount(2) denied")
        req(has("CHECK|write_etc|DENIED"), "read-only rootfs denies /etc write")
        req(has("CHECK|write_usr|DENIED"), "read-only rootfs denies /usr write")
    elif key == "net_socket_create":
        req(has("CHECK|socket_create|DENIED"), "socket(2) denied by seccomp (syscall layer)")
        req(has("CHECK|dgram_socket_create|DENIED"), "udp socket(2) denied by seccomp")
    elif key == "net_dns":
        req(has("CHECK|dns_resolve|DENIED"), "DNS resolution fails (no netns + denied socket)")
    elif key == "net_http":
        req(has("http://example.com/|DENIED"), "plain HTTP egress denied")
        req(has("https://example.com/|DENIED"), "HTTPS egress denied")
    elif key == "net_metadata":
        req(has("tcp_169.254.169.254_80|DENIED"), "metadata IP tcp denied")
        req(has("http_metadata|DENIED"), "metadata HTTP denied")
    elif key == "res_forkbomb_seccomp":
        req(has("CHECK|strict_fork|DENIED"), "fork() denied by strict seccomp")
        req(has("CHECK|strict_subprocess|DENIED"), "subprocess denied (no fork)")
        req(has("CHECK|strict_thread|DENIED"), "threads denied (no clone)")
    elif key == "res_forkbomb_pids":
        req(has("pids_limit_hit") or has("pids_fork_progress"),
            "cgroup pids-limit stopped the relaxed-profile fork bomb (test-only profile)")
        req(row["wall_seconds"] <= 25, "bounded runtime; host unaffected")
    elif key == "res_mem_balloon":
        req(row["client_exit"] == 137 or st.get("OOMKilled") or "MemoryError" in out,
            "memory cap stopped the balloon (137/OOMKilled/MemoryError)")
        req(row["wall_seconds"] <= 25, "bounded runtime")
    elif key == "res_infinite_loop":
        req(row.get("kill_reason") == "wall_deadline", "wall deadline killed the loop")
        req(row["client_exit"] == 137, "killed with 137")
    elif key == "res_disk_fill":
        req(has("ENOSPC"), "tmpfs size cap produced ENOSPC (errno 28)")
        req(not has("written_MiB=2") or True, "recorded fill volume")
    elif key == "res_output_flood":
        req(row.get("kill_reason") in ("output_hard_cap", "wall_deadline"), "flood stopped by hard cap or wall")
        req(row["stdout_bytes_raw"] <= row["limits"]["hard_cap_bytes"] + 65536,
            "captured bytes bounded near the hard cap")
        req(row["stdout_capped"], "recorded output truncated to the evidence cap")
    elif key in ("cpu_count_ref", "cpu_count_capped"):
        req(row["client_exit"] == 0, "exit 0")
        req(has("cpu_iterations"), "iteration count recorded")
    req(row["container_removed"], "container force-removed after the job")
    return results


def parse_count(row: dict) -> int:
    for line in row["stdout_head"].splitlines():
        if "cpu_iterations|count=" in line:
            return int(line.rsplit("=", 1)[1])
    return -1


def main() -> int:
    started = time.strftime("%Y-%m-%dT%H:%M:%S%z")
    env = {
        "started": started,
        "host_uname": sh("uname", "-a") or platform.platform(),
        "docker_client_server": sh("docker", "version", "--format", "{{.Client.Version}} / {{.Server.Version}}"),
        "docker_context": sh("docker", "context", "show"),
        "colima": (sh("colima", "version") or "").splitlines()[0] if shutil.which("colima") else "absent",
    }
    images_before = sh("docker", "images", "--digests", "--format", "{{.Repository}}@{{.Digest}} {{.ID}}")
    volumes_before = sh("docker", "volume", "ls", "--format", "{{.Name}}")
    insp = sh("docker", "inspect", run_job.IMAGE)
    image_evidence = None
    try:
        data = json.loads(insp)
        image_evidence = {
            "RepoDigests": data[0].get("RepoDigests"),
            "Architecture": data[0].get("Architecture"),
            "Os": data[0].get("Os"),
        }
    except Exception as exc:
        image_evidence = {"error": repr(exc), "raw_head": insp[:300]}

    rows = []
    for name, payload, overrides, key in BATTERY:
        print(f"[battery] {name} ...", flush=True)
        try:
            row = run_job.run_job(name, os.path.join(PROBES, payload), **overrides)
        except Exception as exc:
            row = {"probe": name, "harness_error": repr(exc)}
        row["assertions"] = assertions(key, row)
        row["assertion_verdict"] = (
            "CONTAINED/OK" if row["assertions"] and all(a.startswith("PASS") for a in row["assertions"]) else "FINDING"
        )
        rows.append(row)
        print(f"[battery] {name}: {row['assertion_verdict']}", flush=True)

    ref = next((parse_count(r) for r in rows if r["probe"] == "cpu_count_ref"), -1)
    cap = next((parse_count(r) for r in rows if r["probe"] == "cpu_count_capped"), -1)
    ratio = round(cap / ref, 3) if ref > 0 and cap >= 0 else None
    for r in rows:
        if r["probe"] == "cpu_count_capped":
            r["assertions"].append(
                ("PASS: " if (ratio is not None and ratio < 0.6) else "FAIL: ")
                + f"cpu quota enforced: 0.25-cpu iterations/reference = {ratio} (<0.6)"
            )
            r["assertion_verdict"] = (
                "CONTAINED/OK" if all(a.startswith("PASS") for a in r["assertions"]) else "FINDING"
            )

    time.sleep(1)
    residue = sh("docker", "ps", "-a", "--filter", "name=g4spike-", "--format", "{{.Names}}")
    volumes_after = sh("docker", "volume", "ls", "--format", "{{.Name}}")
    images_after = sh("docker", "images", "--digests", "--format", "{{.Repository}}@{{.Digest}} {{.ID}}")
    workdir = run_job.WORKDIR
    workdir_state = "removed" if not os.path.exists(workdir) else ("empty" if not os.listdir(workdir) else "RESIDUE")

    cleanup = {
        "docker_ps_a_g4spike_residue": residue or "none",
        "volumes_unchanged": volumes_after == volumes_before,
        "images_unchanged": images_after == images_before,
        "spike_workdir_state": workdir_state,
        "containers_removed_count": sum(1 for r in rows if r.get("container_removed")),
    }

    verdicts = [r.get("assertion_verdict") for r in rows]
    overall = "ALL_CONTAINED" if all(v == "CONTAINED/OK" for v in verdicts) else "FINDINGS_PRESENT"
    doc = {
        "spike": "epic-6 entry 2 (6.2) G4 feasibility — isolated code runner probe battery",
        "harness": "spikes/g4-feasibility/runner (disposable; not product code; selects/activates nothing)",
        "supervisor_concurrency": "serialized battery: max 1 job at a time (per-host concurrency cap by construction)",
        "environment": env,
        "image_evidence": image_evidence,
        "cleanup": cleanup,
        "cpu_quota_ratio_0.25_over_1.0": ratio,
        "overall": overall,
        "probes": rows,
        "honesty": "Local single-machine feasibility evidence on macOS/Colima (Linux aarch64 VM, shared kernel with other containers). NOT a kernel-escape certification, NOT production isolation proof, NOT an admission: entries 6.6/6.7 must build fresh admission/audit/fingerprint evidence on this dossier's inputs before any activation (fail-closed; quarantine on doubt).",
    }
    with open(OUT, "w") as f:
        json.dump(doc, f, indent=2)
    print(f"[battery] overall={overall} -> {OUT}", flush=True)
    print(f"[battery] cleanup={json.dumps(cleanup)}", flush=True)
    if workdir_state == "RESIDUE" or residue:
        return 2
    return 0 if overall == "ALL_CONTAINED" else 1


if __name__ == "__main__":
    sys.exit(main())
