# G4 spike probe — /proc tricks and namespace/syscall escapes (original synthetic).
import ctypes

def check(label, fn):
    try:
        data = fn()
        print(f"CHECK|{label}|RESULT|{repr(data)[:160]}", flush=True)
    except Exception as exc:
        print(f"CHECK|{label}|DENIED|{type(exc).__name__}: {exc}", flush=True)

def proc1():
    return open("/proc/1/cmdline", "rb").read().replace(b"\0", b" ").decode()
check("proc1_cmdline_pid_namespace", proc1)  # pid 1 must be the container's own python

def uid():
    for line in open("/proc/self/status"):
        if line.startswith(("Uid", "Gid")):
            yield line.strip()
check("self_uid_nonroot", lambda: list(uid()))

def tmpfs_flags():
    return [l.strip() for l in open("/proc/mounts") if l.split()[1] == "/tmp"]
check("tmpfs_mount_flags", lambda: tmpfs_flags())  # must show nosuid,noexec

check("write_proc_self_mem", lambda: open("/proc/self/mem", "wb", 0).write(b"x"))
check("read_proc_kcore", lambda: open("/proc/kcore", "rb").read(8))
check("write_proc_sysrq", lambda: open("/proc/sys/kernel/sysrq", "w").write("1"))
check("read_proc_keys", lambda: open("/proc/keys").read())

libc = ctypes.CDLL(None, use_errno=True)
def unshare_newuser():
    rv = libc.unshare(0x10000000)  # CLONE_NEWUSER
    if rv != 0:
        e = ctypes.get_errno()
        raise OSError(e, os_error_msg(e))
    return rv
def os_error_msg(e):
    import errno as _e
    return _e.errorcode.get(e, str(e))
check("unshare_clone_newuser", unshare_newuser)

def ptrace_traceme():
    rv = libc.ptrace(0, 0, 0, 0)  # PTRACE_TRACEME
    if rv != 0:
        e = ctypes.get_errno()
        raise OSError(e, os_error_msg(e))
    return rv
check("ptrace_traceme", ptrace_traceme)
print("PROBE|esc_proc_tricks|done", flush=True)
