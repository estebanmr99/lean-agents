# Starts the real OpenCode TUI in a pseudo-terminal for a few seconds, then stops it.
# Usage: python3 tests/real-opencode-tui.py <HOME>  (HOME, USERPROFILE and XDG_CONFIG_HOME come from the environment)
# Windows has no pty module: CI installs pywinpty in a throwaway venv for that job only.
import os
import shutil
import signal
import sys
import threading
import time

cwd = os.path.join(sys.argv[1], "project")
os.makedirs(cwd, exist_ok=True)
env = {**os.environ, "TERM": "xterm-256color", "OPENCODE_DISABLE_AUTOUPDATE": "1"}
seconds = 20
out = 0
tail = ""

if os.name == "nt":
    from winpty import PtyProcess

    # npm's opencode is a .cmd shim; ConPTY runs it through cmd.exe.
    proc = PtyProcess.spawn(["cmd", "/c", shutil.which("opencode")], cwd=cwd, env=env, dimensions=(40, 120))

    def drain():
        global out, tail
        # Keep reading: a full pty buffer would block the TUI.
        try:
            while True:
                chunk = proc.read(65536)
                out += len(chunk)
                tail = (tail + chunk)[-6000:]
        except Exception:
            pass

    threading.Thread(target=drain, daemon=True).start()
    time.sleep(seconds)
    print(f"alive at the end: {proc.isalive()}")
    # The process tree, so no opencode worker outlives the case.
    os.system(f"taskkill /F /T /PID {proc.pid} >NUL 2>&1")
else:
    import fcntl
    import pty
    import select
    import struct
    import termios

    pid, fd = pty.fork()
    if pid == 0:
        os.chdir(cwd)
        os.execvpe("opencode", ["opencode"], env)
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", 40, 120, 0, 0))
    end = time.time() + seconds
    while time.time() < end:
        r, _, _ = select.select([fd], [], [], 0.2)
        if r:
            try:
                chunk = os.read(fd, 65536)
                out += len(chunk)
                tail = (tail + chunk.decode(errors="replace"))[-6000:]
            except OSError:
                break
    os.kill(pid, signal.SIGKILL)
    os.waitpid(pid, 0)
import re

print(f"tui output bytes: {out}")
print(repr(tail[-400:]))
# What the TUI showed last, without escape codes: tells a real screen from an error.
print(re.sub(r"\s+", " ", re.sub(r"\x1b(\[[0-9;?]*[A-Za-z]|\][^\x07]*\x07)", "", tail))[-700:])
