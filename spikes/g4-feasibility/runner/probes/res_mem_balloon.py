# G4 spike probe — memory balloon (original synthetic).
# Allocate in 8 MiB chunks past the 256 MiB memory=swap cap; the cgroup OOM
# killer (or Python MemoryError) must stop it. Expect exit 137 / OOMKilled.
chunks = []
total = 0
try:
    while True:
        chunk = bytearray(8 * 1024 * 1024)
        chunk[::4096] = b"\x01" * len(chunk[::4096])  # touch pages
        chunks.append(chunk)
        total += 8
        if total % 64 == 0:
            print(f"CHECK|balloon_progress|allocated_MiB={total}", flush=True)
except MemoryError:
    print(f"CHECK|balloon|MemoryError|allocated_MiB={total}", flush=True)
print(f"PROBE|res_mem_balloon|done|allocated_MiB={total}", flush=True)
