# G4 spike probe — cloud metadata endpoint attempts (original synthetic).
import socket
import urllib.request

TARGETS = [
    ("169.254.169.254", 80),
    ("169.254.169.254", 8080),
    ("fd00:ec2::254", 80),
]
for host, port in TARGETS:
    try:
        conn = socket.create_connection((host, port), timeout=2)
        conn.close()
        print(f"CHECK|tcp_{host}_{port}|NOT_DENIED", flush=True)
    except Exception as exc:
        print(f"CHECK|tcp_{host}_{port}|DENIED|{type(exc).__name__}: {exc}", flush=True)

try:
    with urllib.request.urlopen("http://169.254.169.254/latest/meta-data/", timeout=3) as r:
        print(f"CHECK|http_metadata|NOT_DENIED|{r.read(64)!r}", flush=True)
except Exception as exc:
    print(f"CHECK|http_metadata|DENIED|{type(exc).__name__}: {exc}", flush=True)
print("PROBE|net_metadata|done", flush=True)
