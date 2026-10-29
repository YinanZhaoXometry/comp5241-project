# G4 spike probe — raw socket syscall (original synthetic).
# With the strict seccomp profile, socket() itself must be denied at syscall
# level (independent of --network none).
import socket

try:
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    print("CHECK|socket_create|NOT_DENIED|socket constructed", flush=True)
    s.close()
except Exception as exc:
    print(f"CHECK|socket_create|DENIED|{type(exc).__name__}: {exc}", flush=True)

try:
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    print("CHECK|dgram_socket_create|NOT_DENIED|udp socket constructed", flush=True)
    s.close()
except Exception as exc:
    print(f"CHECK|dgram_socket_create|DENIED|{type(exc).__name__}: {exc}", flush=True)
print("PROBE|net_socket_create|done", flush=True)
