# Starts the real OpenCode TUI in a pseudo-terminal for a few seconds, then stops it.
# Usage: python3 tests/real-opencode-tui.py <HOME>  (HOME and XDG_CONFIG_HOME come from the environment)
import fcntl
import os
import pty
import select
import signal
import struct
import sys
import termios
import time

cwd = os.path.join(sys.argv[1], "project")
os.makedirs(cwd, exist_ok=True)
pid, fd = pty.fork()
if pid == 0:
    os.chdir(cwd)
    os.execvpe("opencode", ["opencode"], {**os.environ, "TERM": "xterm-256color", "OPENCODE_DISABLE_AUTOUPDATE": "1"})
fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", 40, 120, 0, 0))

# Keep reading: a full pty buffer would block the TUI. The worker starts plugins within seconds.
end = time.time() + 20
out = b""
while time.time() < end:
    r, _, _ = select.select([fd], [], [], 0.2)
    if r:
        try:
            out += os.read(fd, 65536)
        except OSError:
            break
os.kill(pid, signal.SIGKILL)
os.waitpid(pid, 0)
print(f"tui output bytes: {len(out)}")
