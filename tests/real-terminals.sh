#!/usr/bin/env bash
# Installs the Warp and Orca agent integrations with the real agent CLIs into a throwaway HOME,
# checks what the agents resolved, then uninstalls. The terminal apps are GUI-only and never
# installed: --terminal forces the choice. Used by CI; safe locally because HOME is a temp directory.
# Usage: tests/real-terminals.sh <claude|opencode-v1|opencode-v2>
set -euo pipefail

# `! cmd` never stops a set -e script, so negative checks go through this.
refute() { if "$@"; then echo "must not succeed: $*" >&2; exit 1; fi; }

target="${1:?usage: real-terminals.sh <target>}"

HOME="$(mktemp -d)"
export HOME
export XDG_CONFIG_HOME="$HOME/.config"
unset XDG_CACHE_HOME XDG_DATA_HOME XDG_STATE_HOME
repo="$(cd "$(dirname "$0")/.." && pwd)"

node "$repo/scripts/lean.mjs" --home "$HOME" --yes --agents "$target" --no-tools --terminal both \
  --privacy standard --lang en --profile anthropic-api </dev/null 2>&1 | tee "$HOME/install.txt"
refute grep -qE '^ *! ' "$HOME/install.txt"

case "$target" in
  claude)
    claude plugin list 2>&1 | tee "$HOME/plugins.txt"
    grep -q 'warp@claude-code-warp' "$HOME/plugins.txt"
    test -f "$HOME/.claude/skills/orca-cli/SKILL.md"
    ;;
  *)
    opencode debug config > "$HOME/resolved.txt" 2>&1
    grep -q '@warp-dot-dev/opencode-warp' "$HOME/resolved.txt"
    test -f "$HOME/.agents/skills/orca-cli/SKILL.md"
    ;;
esac

node "$repo/scripts/lean.mjs" --home "$HOME" --uninstall --yes </dev/null 2>&1 | tee "$HOME/uninstall.txt"
refute grep -qE '^ *! ' "$HOME/uninstall.txt"

case "$target" in
  claude)
    claude plugin list 2>&1 | tee "$HOME/plugins-after.txt"
    refute grep -q 'warp@claude-code-warp' "$HOME/plugins-after.txt"
    refute test -e "$HOME/.claude/skills/orca-cli"
    ;;
  *)
    # The file is the proof: OpenCode's own output can still mention a plugin it cached in HOME.
    if test -e "$XDG_CONFIG_HOME/opencode/opencode.jsonc"; then refute grep -q '@warp-dot-dev/opencode-warp' "$XDG_CONFIG_HOME/opencode/opencode.jsonc"; fi
    refute test -e "$HOME/.agents/skills/orca-cli"
    ;;
esac
echo "real-terminals: $target OK"
