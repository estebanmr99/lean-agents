#!/usr/bin/env bash
# Installs lean-agents with real tools into a throwaway HOME and asks the real Antigravity CLI
# what it loaded, then uninstalls. No login and no TTY. Used by CI; safe locally.
set -euo pipefail

# `! cmd` never stops a set -e script, so negative checks go through this.
refute() { if "$@"; then echo "must not succeed: $*" >&2; exit 1; fi; }

command -v agy >/dev/null || { echo "agy not on PATH" >&2; exit 1; }

agy_bin="$(command -v agy)"
HOME="$(mktemp -d)"
export HOME
export XDG_CONFIG_HOME="$HOME/.config"
unset XDG_CACHE_HOME XDG_DATA_HOME XDG_STATE_HOME
"$agy_bin" --version
repo="$(cd "$(dirname "$0")/.." && pwd)"
dir="$HOME/.gemini/config"

bash "$repo/install.sh" --yes --no-app --agents antigravity --tools serena,playwright,caveman,i-have-adhd,gsd \
  --privacy strict --lang en --ponytail-mode off </dev/null 2>&1 | tee "$HOME/install.txt"
refute grep -qE '^ *! ' "$HOME/install.txt"

test -f "$dir/rules/lean-agents.md"
grep -q '^model: pro$' "$dir/agents/planner.md"
test -f "$dir/plugins/rtk/plugin.json"
# skills 1.7 installs Antigravity skills in ~/.agents/skills, skills 1.8 in ~/.gemini/config/skills (#112).
# GSD also creates ~/.gemini/config/skills, so pick the folder that holds i-have-adhd.
skills="$HOME/.gemini/config/skills"
if [ ! -f "$skills/i-have-adhd/SKILL.md" ]; then skills="$HOME/.agents/skills"; fi
test -f "$skills/caveman/SKILL.md"
grep -q '^disable-model-invocation: false$' "$skills/i-have-adhd/SKILL.md"
ls "$dir"/agents/gsd-* >/dev/null

"$agy_bin" agents </dev/null | tee "$HOME/agents.txt"
for name in explore research review debug planner; do grep -q "$name" "$HOME/agents.txt"; done
"$agy_bin" mcp list </dev/null | tee "$HOME/mcp.txt"
grep -q serena "$HOME/mcp.txt"
grep -q playwright "$HOME/mcp.txt"
"$agy_bin" plugin list --json </dev/null | tee "$HOME/plugins.txt"
grep -q '"rtk"' "$HOME/plugins.txt"

node "$repo/scripts/lean.mjs" --doctor </dev/null

node "$repo/scripts/lean.mjs" --uninstall --yes </dev/null 2>&1 | tee "$HOME/uninstall.txt"
refute grep -qE '^ *! ' "$HOME/uninstall.txt"

refute test -e "$dir/rules/lean-agents.md"
refute test -e "$dir/agents/planner.md"
refute test -e "$dir/plugins/rtk"
refute test -e "$skills/caveman"
refute compgen -G "$dir/agents/gsd-*"
refute grep -qs serena "$dir/mcp_config.json"
echo "real-antigravity: OK"
