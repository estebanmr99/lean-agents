# Drives the interactive installer in a real pseudo-terminal: menus, keystrokes, then a dry-run plan.
# Usage: python3 tests/real-interactive.py  (temporary HOME, --no-exec, --dry-run; changes nothing)
import fcntl
import os
import pty
import re
import select
import struct
import sys
import tempfile
import termios
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
home = tempfile.mkdtemp(prefix="lean-tty-")
argv = ["node", os.path.join(ROOT, "scripts", "lean.mjs"), "--home", home, "--no-exec", "--dry-run", "--agents", "claude"]

pid, fd = pty.fork()
if pid == 0:
    os.execvp(argv[0], argv)
fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", 40, 100, 0, 0))

out = b""


def wait_for(pattern, timeout=30):
    global out
    end = time.time() + timeout
    while time.time() < end:
        if re.search(pattern.encode(), re.sub(rb"\x1b\[[0-9;?]*[A-Za-z]", b"", out)):
            return
        r, _, _ = select.select([fd], [], [], 0.2)
        if r:
            try:
                out += os.read(fd, 65536)
            except OSError:
                break
    sys.exit(f"timed out waiting for {pattern!r}; output so far:\n{out.decode(errors='replace')}")


def send(keys):
    time.sleep(0.3)
    os.write(fd, keys)


def finish(pid, timeout=30):
    # Keep reading: a full pty buffer blocks the installer's writes.
    global out
    end = time.time() + timeout
    while time.time() < end:
        done, status = os.waitpid(pid, os.WNOHANG)
        if done:
            return os.waitstatus_to_exitcode(status)
        r, _, _ = select.select([fd], [], [], 0.2)
        if r:
            try:
                out += os.read(fd, 65536)
            except OSError:
                pass
    os.kill(pid, 9)
    sys.exit("the installer did not exit")


SPACE, ENTER, UP, DOWN = b" ", b"\r", b"\x1b[A", b"\x1b[B"
wait_for("Optional tools")
send(SPACE + ENTER)  # first option: serena
wait_for("Telemetry, auto-updates")
send(UP + ENTER)  # from "All on" up to "All off"
wait_for("Serena config")
send(ENTER)  # keep the tool's default
if b"GitHub CLI" in out or os.system("command -v gh >/dev/null") != 0:
    wait_for("GitHub CLI")
    send(ENTER)  # default no
if os.system("command -v bun >/dev/null") != 0:
    wait_for("Install Bun")
    send(ENTER)  # preselected yes
wait_for("Language")
send(ENTER)
wait_for("Dry run: nothing was changed")
code = finish(pid)
text = re.sub(r"\x1b\[[0-9;?]*[A-Za-z]", "", out.decode(errors="replace"))
print(text)
assert code == 0, "installer exited with an error"
assert "tools: rtk, context-mode, serena" in text, "serena was not picked from the menu"
assert "network: telemetry off, autoUpdate off, outbound off" in text, "the all-off preset was not picked"
assert "bun: on" in text, "Bun was not preselected on"
assert os.listdir(home) == [], "the dry run wrote files"
print("interactive menus: ok")

# A terminal with no size makes clack hang, so the installer must fall back to plain questions.
pid, fd = pty.fork()
if pid == 0:
    os.execvp(argv[0], argv)
out = b""
wait_for(r"Add Serena MCP.*\[n\]")
os.kill(pid, 15)
finish(pid)
print("zero-width terminal falls back to plain questions: ok")

# Applying (files only, --no-exec) ends with the summary box.
home = tempfile.mkdtemp(prefix="lean-tty-")
argv = ["node", os.path.join(ROOT, "scripts", "lean.mjs"), "--home", home, "--no-exec", "--agents", "claude", "--no-tools", "--network", "on", "--lang", "en"]
pid, fd = pty.fork()
if pid == 0:
    os.execvp(argv[0], argv)
fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", 40, 100, 0, 0))
out = b""
if os.system("command -v gh >/dev/null") != 0:
    wait_for("GitHub CLI")
    send(ENTER)
wait_for("Apply these changes")
send(ENTER)
wait_for(r"files written, 0 commands run")
wait_for("Done")
assert finish(pid) == 0, "apply exited with an error"
assert os.path.exists(os.path.join(home, ".config", "lean-agents", "state.json")), "state.json missing"
print("apply with summary: ok")

# Pasting notes for an undocumented setting: saved as-is (password redacted), removed by --uninstall.
home = tempfile.mkdtemp(prefix="lean-tty-")
notes_src = os.path.join(tempfile.mkdtemp(prefix="lean-notes-"), "it.txt")
with open(notes_src, "w") as f:
    f.write("Serena: keep the dashboard off\nproxy http://u:s3cret@127.0.0.1:8080\n")
argv = ["node", os.path.join(ROOT, "scripts", "lean.mjs"), "--home", home, "--no-exec", "--agents", "claude", "--tools", "serena", "--network", "on", "--lang", "en", "--no-bun"]
pid, fd = pty.fork()
if pid == 0:
    os.execvp(argv[0], argv)
fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", 40, 100, 0, 0))
out = b""
wait_for("Serena config")
send(DOWN + ENTER)  # paste docs or IT notes
wait_for("One line of notes")
send(notes_src.encode() + ENTER)
if os.system("command -v gh >/dev/null") != 0:
    wait_for("GitHub CLI")
    send(ENTER)
wait_for("Apply these changes")
send(ENTER)
wait_for("Notes saved")
assert finish(pid) == 0, "apply with notes exited with an error"
notes = os.path.join(home, ".config", "lean-agents", "notes", "serena.md")
text = open(notes).read()
assert "Serena: keep the dashboard off" in text and "http://***@127.0.0.1:8080" in text, text
assert "s3cret" not in text, "the proxy password was written"
assert os.system(" ".join(["node", os.path.join(ROOT, "scripts", "lean.mjs"), "--home", home, "--no-exec", "--uninstall", "--yes", ">/dev/null"])) == 0
assert not os.path.exists(notes), "--uninstall left the notes file"
print("notes for undocumented settings: ok")
