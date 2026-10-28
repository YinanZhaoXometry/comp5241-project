# G4 spike probe — CPU quota enforcement (original synthetic).
# Busy-counts for ~3 seconds and prints the iteration count; run twice by the
# battery (cpus=1.0 reference vs cpus=0.25) so the cgroup CPU quota's effect
# is visible as an iteration-count ratio.
import time

deadline = time.monotonic() + 3.0
n = 0
x = 1
while time.monotonic() < deadline:
    x = (x * 3 + 1) % 1_000_000_007
    n += 1
print(f"CHECK|cpu_iterations|count={n}", flush=True)
print("PROBE|cpu_count|done", flush=True)
