# G4 spike probe — fork bomb under the TEST-ONLY relaxed profile (original synthetic).
# clone is allowed here ONLY so that the cgroup pids-limit is the layer under
# test: children hold pids and re-fork; the loop records how many forks
# succeeded before the cgroup refused (expect ~pids-limit), proving the
# kernel-level process cap independent of seccomp.
import os
import sys
import time

if os.fork() != 0:
    # Initial parent: just holds a pid while the bomb runs in the child.
    time.sleep(30)
    sys.exit(0)

ok = 0
try:
    while True:
        pid = os.fork()
        ok += 1
        if pid == 0:
            while True:
                try:
                    os.fork()
                except OSError:
                    time.sleep(30)  # cap reached inside a child too
            sys.exit(0)
        if ok % 4 == 0:
            print(f"CHECK|pids_fork_progress|forks_ok={ok}", flush=True)
except OSError as exc:
    print(f"CHECK|pids_limit_hit|DENIED|forks_ok={ok}: {type(exc).__name__}: {exc}", flush=True)
time.sleep(2)
print(f"PROBE|res_forkbomb_pids|done|forks_ok={ok}", flush=True)
