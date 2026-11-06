#!/usr/bin/env bash
# Real Bun install, reuse, opt-out, fallback and uninstall with the real engine, a real Context Mode and
# a throwaway HOME (USERPROFILE on Windows). Proves detection through the MCP client, not by file checks.
# Used by CI on Linux, macOS and Windows (Git Bash); never run on a machine with its own Bun on PATH.
set -euo pipefail

HOME="$(mktemp -d)"
export HOME
repo="$(cd "$(dirname "$0")/.." && pwd)"
case "$(uname -s)" in Darwin) os=mac ;; Linux) os=linux ;; *) os=windows ;; esac
unset XDG_CACHE_HOME XDG_DATA_HOME XDG_STATE_HOME
export XDG_CONFIG_HOME="$HOME/.config"
if [ "$os" = windows ]; then
  # Node, npm and PowerShell need Windows paths; npm puts global bins in the prefix itself.
  win="$(cygpath -w "$HOME")"
  export USERPROFILE="$win" npm_config_prefix="$win\\npm"
else
  export npm_config_prefix="$HOME/npm"
fi
export PATH="$HOME/npm/bin:$HOME/npm:$PATH"
if command -v bun >/dev/null; then echo "Bun is already on PATH; the install would not be tested" >&2; exit 1; fi
fail() { echo "FAIL: $*" >&2; exit 1; }

home="$HOME"
[ "$os" = windows ] && home="$win"
bunbin="$HOME/.bun/bin"
# Stubs: lean-agents calls `rtk` for OpenCode, and rtk itself is not what this test is about.
stubs="$HOME/stubs"
mkdir -p "$stubs"
printf '#!/bin/sh\nexit 0\n' > "$stubs/rtk"
printf '@exit /b 0\r\n' > "$stubs/rtk.cmd"
chmod +x "$stubs/rtk"
export PATH="$stubs:$PATH"

lean() { node "$repo/scripts/lean.mjs" --home "$home" --yes "$@"; }
do_install() { lean --agents opencode-v2 --profile none --lang en --privacy standard "$@"; }
do_uninstall() { lean --uninstall; }
bun_gone() {
  [ ! -e "$HOME/.bun" ] || fail ".bun exists"
  if [ "$os" = mac ] && brew list bun >/dev/null 2>&1; then fail "brew still has bun"; fi
  if [ "$os" = windows ] && user_path | grep -qi '\.bun\\bin'; then fail "user PATH still has .bun\\bin"; fi
  if command -v bun >/dev/null; then fail "bun is on PATH"; fi
}
user_path() { powershell -NoProfile -Command "[Environment]::GetEnvironmentVariable('Path','User')"; }
no_profile_edit() { for f in .bashrc .bash_profile .profile .zshrc .zshenv .zprofile; do [ ! -e "$HOME/$f" ] || fail "$f was created or edited"; done; }

echo "--- default: Bun installed, found by Context Mode"
do_install
case "$os" in
  linux)
    [ -x "$bunbin/bun" ] || fail "no $bunbin/bun"
    if command -v bun >/dev/null; then fail "bun is on PATH on Linux"; fi
    no_profile_edit ;;
  mac)
    command -v bun | grep -Eq '^/(opt/homebrew|usr/local)/bin/bun$' || fail "bun is not Homebrew's"
    no_profile_edit ;;
  windows)
    user_path | grep -qi '\.bun\\bin' || fail "user PATH has no .bun\\bin"
    "$bunbin/bun.exe" --version
    # A new terminal reads the user PATH; this shell started before the install.
    export PATH="$PATH:$bunbin" ;;
esac
grep -q '"bun": true' "$HOME/.config/lean-agents/state.json" || fail "state does not record bun"
node "$repo/tests/bench-context-mode.mjs" check | tee "$HOME/check.txt"
# Context Mode 2 (2.1.4) no longer reports its runtime in ctx_doctor and runs ctx_execute under Node even with Bun on PATH,
# so this proves what lean-agents controls (Bun on PATH, recorded in state) plus a working TypeScript ctx_execute.
grep -qx 'ts-ok 42' "$HOME/check.txt" || fail "TypeScript ctx_execute failed"

echo "--- uninstall removes the Bun it installed"
[ "$os" = windows ] && export PATH="${PATH%:"$bunbin"}"
do_uninstall
bun_gone

echo "--- --no-bun, then --update keeps it off"
do_install --no-bun
bun_gone
lean --update
bun_gone
do_uninstall

echo "--- an existing Bun is reused and survives --uninstall"
other="$HOME/other-bun"
mkdir -p "$other"
printf '#!/bin/sh\necho 1.0.0\n' > "$other/bun"
printf '@echo 1.0.0\r\n' > "$other/bun.cmd"
chmod +x "$other/bun"
PATH="$other:$PATH" do_install
[ ! -e "$HOME/.bun" ] || fail "Bun was installed next to an existing one"
if [ "$os" = mac ] && brew list bun >/dev/null 2>&1; then fail "brew installed bun next to an existing one"; fi
PATH="$other:$PATH" do_uninstall
[ -e "$other/bun" ] || fail "uninstall removed a Bun it did not install"

# Linux only: brew on macOS reinstalls from its download cache, even with no network.
if [ "$os" = linux ]; then
  echo "--- a failed Bun install only warns and exits 0"
  HTTPS_PROXY=http://127.0.0.1:9 HTTP_PROXY=http://127.0.0.1:9 do_install | tee "$HOME/fallback.txt"
  grep -q '! Bun install failed; Context Mode will run on Node.' "$HOME/fallback.txt" || fail "no fallback line"
  bun_gone
  do_uninstall
fi
echo "real-bun: ok"
