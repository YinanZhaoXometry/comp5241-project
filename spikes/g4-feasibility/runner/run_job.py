#!/usr/bin/env python3
"""G4 spike — per-job isolated sandbox runner supervisor (disposable spike harness).

Runs ONE job payload (Python source on stdin) inside a hardened, digest-pinned,
no-network Colima container and records admission-grade evidence:
exact docker flags (from docker inspect of the finished container), exit code,
OOM flag, daemon-side timing, capped stdout, and guaranteed cleanup.

This is spike evidence for the G4 dossier. It is NOT product code, is not
admitted, and selects nothing. Never used for the web/worker process, eval or
Node vm (AD-12).
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import threading
import time

HERE = os.path.dirname(os.path.abspath(__file__))
IMAGE = "python@sha256:aae362254cea6b75fe812f0b428f10b3b361a090fe5655fb1d03937f6d38cda9"
WORKDIR = os.path.join(HERE, ".work")


def sh(*args: str, check: bool = False) -> subprocess.CompletedProcess:
    return subprocess.run(args, capture_output=True, text=True, check=check)


def run_job(
    name: str,
    payload_path: str,
    *,
    profile: str = "seccomp-runner-strict.json",
    memory: str = "256m",
    cpus: str = "0.5",
    pids: int = 16,
    wall: float = 10.0,
    out_cap: int = 1024 * 1024,
    hard_cap: int = 8 * 1024 * 1024,
    tmpfs_size: str = "16m",
) -> dict:
    os.makedirs(WORKDIR, exist_ok=True)
    cname = f"g4spike-{name}-{os.getpid()}-{int(time.time() * 1000) % 1000000}"
    raw_path = os.path.join(WORKDIR, f"{cname}.out")
    profile_path = os.path.join(HERE, profile)

    # Fail closed: no container of this name may pre-exist.
    sh("docker", "rm", "-f", cname)

    cmd = [
        "docker", "run",
        "--name", cname,
        "--network", "none",
        "--user", "65532:65532",
        "--read-only",
        "--cap-drop", "ALL",
        "--security-opt", "no-new-privileges",
        "--security-opt", f"seccomp={profile_path}",
        "--memory", memory,
        "--memory-swap", memory,  # equal memory/swap: no swap escape
        "--cpus", cpus,
        "--pids-limit", str(pids),
        "--tmpfs", f"/tmp:rw,noexec,nosuid,size={tmpfs_size}",
        "--log-driver", "none",
        "--stop-timeout", "2",
        "-i",
        IMAGE,
        "python", "-I", "-B", "-",
    ]

    row: dict = {
        "probe": name,
        "container": cname,
        "image": IMAGE,
        "profile": profile,
        "limits": {
            "memory": memory, "cpus": cpus, "pids": pids, "wall_s": wall,
            "out_cap_bytes": out_cap, "hard_cap_bytes": hard_cap,
            "tmpfs": tmpfs_size,
        },
    }

    kill_reason = None
    cap_hit = threading.Event()

    started = time.monotonic()
    proc = subprocess.Popen(
        cmd,
        stdin=open(payload_path, "rb"),
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )

    def drain_to_file() -> None:
        """Bounded capture: write at most hard_cap bytes to host disk, then
        keep draining the pipe (discarding) so the docker client can exit
        once the supervisor kills the container."""
        written = 0
        assert proc.stdout is not None
        with open(raw_path, "wb") as fout:
            while True:
                chunk = proc.stdout.read(65536)
                if not chunk:
                    break
                if written < hard_cap:
                    take = chunk[: hard_cap - written]
                    fout.write(take)
                    written += len(take)
                    if written >= hard_cap:
                        fout.flush()
                        cap_hit.set()
                # past the cap: discard
        cap_hit.set()

    reader = threading.Thread(target=drain_to_file, daemon=True)
    reader.start()
    while proc.poll() is None:
        elapsed = time.monotonic() - started
        if elapsed > wall:
            kill_reason = "wall_deadline"
            sh("docker", "kill", cname)
            try:
                proc.wait(timeout=10)
            except subprocess.TimeoutExpired:
                pass
            break
        if cap_hit.is_set():
            kill_reason = "output_hard_cap"
            sh("docker", "kill", cname)
            try:
                proc.wait(timeout=10)
            except subprocess.TimeoutExpired:
                pass
            break
        time.sleep(0.05)
    reader.join(timeout=15)
    client_code = proc.returncode
    stderr_bytes = proc.stderr.read() if proc.stderr else b""
    wall_s = round(time.monotonic() - started, 3)

    # Daemon-side evidence before removal.
    ins = sh("docker", "inspect", cname)
    daemon_state: dict = {}
    applied_flags: dict = {}
    if ins.returncode == 0:
        try:
            data = json.loads(ins.stdout)[0]
            st = data.get("State", {})
            daemon_state = {
                "ExitCode": st.get("ExitCode"),
                "OOMKilled": st.get("OOMKilled"),
                "Error": st.get("Error"),
                "StartedAt": st.get("StartedAt"),
                "FinishedAt": st.get("FinishedAt"),
            }
            cfg = data.get("Config", {})
            hc = data.get("HostConfig", {})
            applied_flags = {
                "NetworkMode": hc.get("NetworkMode"),
                "ReadonlyRootfs": hc.get("ReadonlyRootfs"),
                "CapDrop": hc.get("CapDrop"),
                "SecurityOpt": hc.get("SecurityOpt"),
                "User": cfg.get("User"),
                "Memory": hc.get("Memory"),
                "MemorySwap": hc.get("MemorySwap"),
                "NanoCpus": hc.get("NanoCpus"),
                "PidsLimit": hc.get("PidsLimit"),
                "Tmpfs": hc.get("Tmpfs"),
                "Binds": hc.get("Binds"),
                "PortBindings": hc.get("PortBindings"),
                "Mounts": data.get("Mounts"),
                "LogConfig": cfg.get("LogConfig"),
            }
        except Exception as exc:  # evidence must record its own failure
            daemon_state = {"parse_error": repr(exc)}
    # Mandatory cleanup even on failure paths.
    rm = sh("docker", "rm", "-f", cname)
    removed = rm.returncode == 0 or "No such container" in (rm.stderr or "")

    raw_size = os.path.getsize(raw_path) if os.path.exists(raw_path) else 0
    capped = raw_size > out_cap
    with open(raw_path, "rb") as f:
        sample = f.read(min(out_cap, 4096))
    try:
        os.remove(raw_path)
    except OSError:
        pass

    row.update({
        "client_exit": client_code,
        "kill_reason": kill_reason,
        "wall_seconds": wall_s,
        "daemon_state": daemon_state,
        "applied_flags": applied_flags,
        "stdout_bytes_raw": raw_size,
        "stdout_capped": capped,
        "stdout_head": sample.decode("utf-8", "replace"),
        "stderr_head": (stderr_bytes or b"")[:600].decode("utf-8", "replace"),
        "container_removed": removed,
    })
    return row


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--name", required=True)
    ap.add_argument("--payload", required=True)
    ap.add_argument("--profile", default="seccomp-runner-strict.json")
    ap.add_argument("--memory", default="256m")
    ap.add_argument("--cpus", default="0.5")
    ap.add_argument("--pids", type=int, default=16)
    ap.add_argument("--wall", type=float, default=10.0)
    ap.add_argument("--tmpfs", default="16m")
    args = ap.parse_args()
    row = run_job(
        args.name, args.payload,
        profile=args.profile, memory=args.memory, cpus=args.cpus,
        pids=args.pids, wall=args.wall, tmpfs_size=args.tmpfs,
    )
    print(json.dumps(row, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
