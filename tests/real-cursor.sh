#!/usr/bin/env bash
# Installs lean-agents for Cursor with real tools into a throwaway HOME, asks the real Cursor
# CLI (`agent`) what it sees, then writes the team files with --project. No login and no TTY.
# Used by CI; safe locally.
set -euo pipefail

# `! cmd` never stops a set -e script, so negative checks go through this.
refute() { if "$@"; then echo "must not succeed: $*" >&2; exit 1; fi; }
trap 'echo "failed at line $LINENO" >&2' ERR

command -v agent >/dev/null || { echo "agent (Cursor CLI) not on PATH" >&2; exit 1; }

agent_bin="$(command -v agent)"
HOME="$(mktemp -d)"
export HOME
export XDG_CONFIG_HOME="$HOME/.config"
unset XDG_CACHE_HOME XDG_DATA_HOME XDG_STATE_HOME
"$agent_bin" --version
repo="$(cd "$(dirname "$0")/.." && pwd)"
dir="$HOME/.cursor"

bash "$repo/install.sh" --yes --agents cursor --tools serena,playwright,playwright-extension,caveman,i-have-adhd,gsd \
  --privacy strict --lang en --ponytail-mode off </dev/null 2>&1 | tee "$HOME/install.txt"
refute grep -qE '^ *! ' "$HOME/install.txt"

grep -q '^readonly: true$' "$dir/agents/explore.md"
grep -q '^model: inherit$' "$dir/agents/planner.md"
test -f "$dir/hooks.json"
grep -q rtk "$dir/hooks.json"
# GSD (#20) adds its lifecycle hooks next to the RTK hook.
grep -qi gsd "$dir/hooks.json"
# The Skills CLI puts Cursor skills in ~/.agents/skills, which Cursor reads.
test -f "$HOME/.agents/skills/caveman/SKILL.md"
grep -q '^disable-model-invocation: false$' "$HOME/.agents/skills/i-have-adhd/SKILL.md"

# grep -q closes the pipe early, so read CLI output from files.
"$agent_bin" mcp list </dev/null > "$HOME/mcp.txt" 2>&1 || { cat "$HOME/mcp.txt"; exit 1; }
cat "$HOME/mcp.txt"
grep -q serena "$HOME/mcp.txt"
grep -qE "(^|[^-[:alnum:]])playwright([^-]|$)" "$HOME/mcp.txt"
grep -q playwright-extension "$HOME/mcp.txt"
grep -q context-mode "$HOME/mcp.txt"

node "$repo/scripts/lean.mjs" --doctor </dev/null

node "$repo/scripts/lean.mjs" --uninstall --yes </dev/null 2>&1 | tee "$HOME/uninstall.txt"
refute grep -qE '^ *! ' "$HOME/uninstall.txt"
refute test -e "$dir/agents/explore.md"
refute grep -qs rtk "$dir/hooks.json"
refute test -e "$HOME/.agents/skills/caveman"
refute grep -qs serena "$dir/mcp.json"
refute grep -qs playwright-extension "$dir/mcp.json"

# Team mode: with the user config gone, Cursor can only find serena in the repo's .cursor/mcp.json.
proj="$HOME/team-repo"
mkdir -p "$proj"
git -C "$proj" init -q
node "$repo/scripts/lean.mjs" --project "$proj" --yes --tools serena --privacy standard --lang en </dev/null
grep -q 'lean-agents:start' "$proj/AGENTS.md"
grep -q '^alwaysApply: true$' "$proj/.cursor/rules/lean-agents.mdc"
(cd "$proj" && "$agent_bin" mcp list </dev/null > "$HOME/project-mcp.txt" 2>&1) || { cat "$HOME/project-mcp.txt"; exit 1; }
cat "$HOME/project-mcp.txt"
grep -q serena "$HOME/project-mcp.txt"
node "$repo/scripts/lean.mjs" --project "$proj" --uninstall --yes </dev/null
test -z "$(git -C "$proj" status --porcelain)"
echo "real-cursor: OK"
