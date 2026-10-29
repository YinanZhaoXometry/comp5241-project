# G4 spike probe — fork bomb under the STRICT profile (original synthetic).
# Layer 1: seccomp denies clone/fork outright, so the bomb cannot even start.
import os
import sys

try:
    pid = os.fork()
    if pid == 0:
        sys.exit(0)
    os.waitpid(pid, 0)
    print("CHECK|strict_fork|NOT_DENIED|fork succeeded", flush=True)
except Exception as exc:
    print(f"CHECK|strict_fork|DENIED|{type(exc).__name__}: {exc}", flush=True)

try:
    import subprocess
    subprocess.run(["/bin/true"])
    print("CHECK|strict_subprocess|NOT_DENIED|subprocess ran", flush=True)
except Exception as exc:
    print(f"CHECK|strict_subprocess|DENIED|{type(exc).__name__}: {exc}", flush=True)

try:
    import threading
    t = threading.Thread(target=lambda: None)
    t.start()
    t.join()
    print("CHECK|strict_thread|NOT_DENIED|thread started", flush=True)
except Exception as exc:
    print(f"CHECK|strict_thread|DENIED|{type(exc).__name__}: {exc}", flush=True)
print("PROBE|res_forkbomb_seccomp|done", flush=True)
