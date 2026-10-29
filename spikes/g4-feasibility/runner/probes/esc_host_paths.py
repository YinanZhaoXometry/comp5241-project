# G4 spike probe — escape/host-read attempts (original synthetic).
# Each CHECK line records the kernel's answer. With no bind mounts the host
# filesystem is unreachable by construction; this records what each attempt
# actually met. Any host-data content appearing would be a LEAK.
def check(label, fn):
    try:
        data = fn()
        text = repr(data)[:120]
        tag = "READ" if data else "EMPTY"
        print(f"CHECK|{label}|{tag}|{text}", flush=True)
    except Exception as exc:
        print(f"CHECK|{label}|DENIED|{type(exc).__name__}: {exc}", flush=True)

check("etc_passwd_image_own", lambda: open("/etc/passwd").readline())
check("etc_shadow", lambda: open("/etc/shadow").read())
check("docker_socket", lambda: open("/var/run/docker.sock").read(16))
check("host_user_dir", lambda: open("/Users/zhaoyinan/document/Polyu/COMP5241 软工/project-new/AGENTS.md").read(16))
check("host_root_guess", lambda: open("/Users").read())
check("traversal_shadow", lambda: open("../../../../../../etc/shadow").read())
check("docker_cli_binary", lambda: len(open("/usr/bin/docker").read()))
check("containerd_sock", lambda: open("/run/containerd/containerd.sock").read(4))
print("PROBE|esc_host_paths|done", flush=True)
