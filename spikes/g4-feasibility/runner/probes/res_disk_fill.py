# G4 spike probe — disk fill on the ephemeral tmpfs scratch (original synthetic).
# /tmp is a capped tmpfs (16m): writes must hit ENOSPC (errno 28) quickly and
# never touch host disk. The scratch dies with the container.
import errno

written = 0
try:
    with open("/tmp/fill.bin", "wb") as f:
        while True:
            f.write(b"\0" * (1024 * 1024))
            f.flush()
            written += 1
            print(f"CHECK|disk_progress|written_MiB={written}", flush=True)
except OSError as exc:
    tag = "ENOSPC" if exc.errno == errno.ENOSPC else f"errno_{exc.errno}"
    print(f"CHECK|disk_fill|{tag}|written_MiB={written}: {exc}", flush=True)
print(f"PROBE|res_disk_fill|done|written_MiB={written}", flush=True)
