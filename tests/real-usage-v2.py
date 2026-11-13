# Real OpenCode 2.x TUI in a pseudo-terminal, throwaway HOME, a fake `gh` that prints a fixed copilot_internal/user JSON:
# proves the sidebar box ("Copilot credits" with the fixed numbers) and the /copilot-usage command + toast (#123).
# Usage: python3 tests/real-usage-v2.py  (needs `opencode` 2.x on PATH; no login, no model request)
import fcntl
import os
import pty
import re
import select
import socket
import struct
import subprocess
import sys
import tempfile
import termios
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
home = tempfile.mkdtemp(prefix="lean-usage-v2-")
bin_dir = os.path.join(home, "fakebin")
os.makedirs(bin_dir)
with open(os.path.join(bin_dir, "gh"), "w") as f:
    f.write('#!/bin/sh\ncat <<\'J\'\n{"quota_reset_date":"2026-12-01","quota_snapshots":{"premium_interactions":{"unlimited":false,"entitlement":25000,"remaining":15441,"percent_remaining":61.7}}}\nJ\n')
os.chmod(os.path.join(bin_dir, "gh"), 0o755)

env = {k: v for k, v in os.environ.items() if not k.startswith("XDG_")}
env.update(HOME=home, PATH=bin_dir + os.pathsep + os.environ["PATH"], TERM="xterm-256color")

# The managed background service listens on a fixed port: use a free one so a service already running on the machine cannot get in the way.
with socket.socket() as sock:
    sock.bind(("127.0.0.1", 0))
    port = sock.getsockname()[1]
subprocess.run(["opencode", "service", "set", "port", str(port)], check=True, env=env)

subprocess.run(["node", os.path.join(ROOT, "scripts", "lean.mjs"), "--home", home, "--no-exec", "--yes", "--lang", "en", "--profile", "none",
                "--agents", "opencode-v2", "--tools", "copilot-usage", "--network", "on"], check=True, env=env, stdout=subprocess.DEVNULL)
assert os.path.exists(os.path.join(home, ".config", "opencode", "plugins", "lean-copilot-usage", "tui.js")), "plugin file missing"

pid, fd = pty.fork()
if pid == 0:
    os.chdir(home)
    os.execvpe("opencode", ["opencode"], env)
fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", 50, 160, 0, 0))
out = b""


def pump(seconds):
    global out
    end = time.time() + seconds
    while time.time() < end:
        r, _, _ = select.select([fd], [], [], 0.2)
        if r:
            try:
                out += os.read(fd, 65536)
            except OSError:
                return


def text():
    return re.sub(r"\s+", " ", re.sub(r"\x1b\[[0-9;?<>=]*[A-Za-z]|\x1b[\]P_].*?(\x07|\x1b\\)|[\x00-\x08\x0b-\x1f]", "", out.decode(errors="replace")))


def wait_for(needle, seconds, what):
    end = time.time() + seconds
    while time.time() < end:
        pump(0.5)
        if needle in text():
            return
    print(text()[-1500:])
    sys.exit(f"timed out waiting for {what} ({needle!r})")


def send(data, settle=1.0):
    pump(settle)
    os.write(fd, data)


try:
    wait_for("Ask anything", 40, "the home prompt")
    pump(3)
    # 1. The slash command shows the toast with the fixed numbers.
    send(b"/copilot-usage", 1.0)
    pump(1.5)
    send(b"\r")
    wait_for("Left 15,441 ($154.41)", 20, "the /copilot-usage toast")
    print("2.x /copilot-usage toast: ok")
    # 2. The sidebar only exists inside a session: open one (it fails without a login, which is fine), then show the sidebar.
    pump(9)  # let the toast go away
    out = b""
    send(b"hello")
    send(b"\r")
    pump(10)
    send(b"\x10", 1.0)  # ctrl+p: command palette
    send(b"sidebar", 1.0)
    pump(1.5)
    send(b"\r")
    for needle in ("Copilot credits", "61% left", "Spent", "9,559", "Left", "15,441", "Resets", "Dec 1"):
        wait_for(needle, 15, f"the sidebar text {needle!r}")
    print("2.x sidebar box with credits: ok")
    print(re.findall(r"Copilot credits.{0,160}", text())[-1])
finally:
    os.kill(pid, 9)
    subprocess.run(["opencode", "service", "stop"], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
