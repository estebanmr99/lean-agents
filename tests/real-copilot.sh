#!/usr/bin/env bash
# Installs lean-agents with real tools into a throwaway HOME and asks the real Copilot CLI
# what it loaded, then uninstalls. No login and no TTY. Used by CI; safe locally.
set -euo pipefail

# `! cmd` never stops a set -e script, so negative checks go through this.
refute() { if "$@"; then echo "must not succeed: $*" >&2; exit 1; fi; }

command -v copilot >/dev/null || { echo "copilot not on PATH" >&2; exit 1; }
copilot --version

HOME="$(mktemp -d)"
export HOME
export XDG_CONFIG_HOME="$HOME/.config"
repo="$(cd "$(dirname "$0")/.." && pwd)"
dir="$HOME/.copilot"

bash "$repo/install.sh" --yes --agents copilot-cli --tools serena,playwright,caveman,i-have-adhd,codeburn,gsd,autoskills \
  --privacy strict --lang en --ponytail-mode off </dev/null 2>&1 | tee "$HOME/install.txt"
refute grep -qE '^ *! ' "$HOME/install.txt"

grep -q 'lean-agents:start' "$dir/copilot-instructions.md"
grep -q '^model: claude-opus-5.5$' "$dir/agents/planner.agent.md"
grep -q '"autoUpdate": false' "$dir/settings.json"
test -f "$dir/hooks/rtk-rewrite.json"
test -f "$HOME/.agents/skills/caveman/SKILL.md"
grep -q '^disable-model-invocation: false$' "$HOME/.agents/skills/i-have-adhd/SKILL.md"
grep -q '"gsd-debugger": "claude-opus-5.5"' "$HOME/.gsd/defaults.json"
ls "$dir"/agents/gsd-* >/dev/null

copilot mcp list --json </dev/null | tee "$HOME/mcp.txt"
grep -q '"serena"' "$HOME/mcp.txt"
grep -q '"playwright"' "$HOME/mcp.txt"
# grep -q closes the pipe early and copilot dies on EPIPE, so read its output from files.
copilot instruction list </dev/null > "$HOME/rules.txt"
grep -q 'copilot-instructions.md' "$HOME/rules.txt"
copilot skill list </dev/null > "$HOME/skills.txt"
grep -q caveman "$HOME/skills.txt"
grep -q i-have-adhd "$HOME/skills.txt"
copilot plugin list </dev/null > "$HOME/plugins.txt"
grep -q context-mode "$HOME/plugins.txt"

node "$repo/scripts/lean.mjs" --doctor </dev/null

node "$repo/scripts/lean.mjs" --uninstall --yes </dev/null 2>&1 | tee "$HOME/uninstall.txt"
refute grep -qE '^ *! ' "$HOME/uninstall.txt"

refute test -e "$dir/agents/planner.agent.md"
refute test -e "$dir/hooks/rtk-rewrite.json"
refute test -e "$HOME/.agents/skills/caveman"
refute test -e "$HOME/.agents/skills/i-have-adhd"
refute compgen -G "$dir/agents/gsd-*"
refute grep -qs 'lean-agents:start' "$dir/copilot-instructions.md"
refute grep -qs serena "$dir/mcp-config.json"
copilot plugin list </dev/null > "$HOME/plugins-after.txt"
refute grep -q context-mode "$HOME/plugins-after.txt"
echo "real-copilot: OK"
