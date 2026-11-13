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

if os.name == "nt":
    from winpty import PtyProcess

    # npm's opencode is a .cmd shim; ConPTY runs it through cmd.exe.
    proc = PtyProcess.spawn(["cmd", "/c", shutil.which("opencode")], cwd=cwd, env=env, dimensions=(40, 120))

    def drain():
        global out
        # Keep reading: a full pty buffer would block the TUI.
        try:
            while True:
                out += len(proc.read(65536))
        except Exception:
            pass

    threading.Thread(target=drain, daemon=True).start()
    time.sleep(seconds)
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
                out += len(os.read(fd, 65536))
            except OSError:
                break
    os.kill(pid, signal.SIGKILL)
    os.waitpid(pid, 0)
print(f"tui output bytes: {out}")
