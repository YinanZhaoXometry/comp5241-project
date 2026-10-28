# G4 spike probe — privilege escalation attempts (original synthetic).
import ctypes
import os

def check(label, fn):
    try:
        data = fn()
        print(f"CHECK|{label}|RESULT|{repr(data)[:160]}", flush=True)
    except Exception as exc:
        print(f"CHECK|{label}|DENIED|{type(exc).__name__}: {exc}", flush=True)

check("setuid_root", lambda: os.setuid(0))
check("setgid_root", lambda: os.setgid(0))
check("chown_tmp_to_root", lambda: os.chown("/tmp", 0, 0))

libc = ctypes.CDLL(None, use_errno=True)
def mount_tmp():
    rv = libc.mount(b"none", b"/tmp", b"tmpfs", 0, b"")
    if rv != 0:
        import errno as _e
        e = ctypes.get_errno()
        raise OSError(e, _e.errorcode.get(e, str(e)))
    return rv
check("mount_call", mount_tmp)

check("write_etc", lambda: open("/etc/g4probe", "w").write("x"))
check("write_usr", lambda: open("/usr/g4probe", "w").write("x"))
check("write_var", lambda: open("/var/g4probe", "w").write("x"))

def setuid_bit():
    p = "/tmp/g4probe"
    with open(p, "w") as f:
        f.write("#!/bin/sh\n")
    os.chmod(p, 0o4755)
    return oct(os.stat(p).st_mode)
check("setuid_bit_on_tmpfs", setuid_bit)  # mode may show 4755 but /tmp is nosuid => inert
print("PROBE|esc_priv_escalation|done", flush=True)
