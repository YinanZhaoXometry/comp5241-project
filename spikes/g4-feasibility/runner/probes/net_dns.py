# G4 spike probe — DNS resolution attempt (original synthetic).
# Egress layer 1: no network namespace (--network none).
# Egress layer 2: socket syscalls denied by the seccomp profile.
import socket

try:
    infos = socket.getaddrinfo("example.com", 443)
    print(f"CHECK|dns_resolve|NOT_DENIED|{infos[:1]}", flush=True)
except Exception as exc:
    print(f"CHECK|dns_resolve|DENIED|{type(exc).__name__}: {exc}", flush=True)

try:
    infos = socket.getaddrinfo("metadata.google.internal", 80)
    print("CHECK|dns_metadata_name|NOT_DENIED", flush=True)
except Exception as exc:
    print(f"CHECK|dns_metadata_name|DENIED|{type(exc).__name__}: {exc}", flush=True)
print("PROBE|net_dns|done", flush=True)
