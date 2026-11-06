#!/usr/bin/env bash
# Installs lean-agents with real tools into a throwaway HOME and asks the real Copilot CLI
# what it loaded, then uninstalls. No login and no TTY. Used by CI; safe locally.
set -euo pipefail
trap 'echo "failed at line $LINENO" >&2' ERR

# `! cmd` never stops a set -e script, so negative checks go through this.
refute() { if "$@"; then echo "must not succeed: $*" >&2; exit 1; fi; }

command -v copilot >/dev/null || { echo "copilot not on PATH" >&2; exit 1; }

HOME="$(mktemp -d)"
export HOME
export XDG_CONFIG_HOME="$HOME/.config"
unset XDG_CACHE_HOME XDG_DATA_HOME XDG_STATE_HOME
copilot --version
repo="$(cd "$(dirname "$0")/.." && pwd)"
dir="$HOME/.copilot"

bash "$repo/install.sh" --yes --agents copilot-cli --tools serena,playwright,playwright-extension,caveman,i-have-adhd,codeburn,gsd,autoskills \
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
grep -q '"playwright-extension"' "$HOME/mcp.txt"
# grep -q closes the pipe early and copilot dies on EPIPE, so read its output from files.
copilot instruction list </dev/null > "$HOME/rules.txt"
grep -q 'copilot-instructions.md' "$HOME/rules.txt"
copilot skill list </dev/null > "$HOME/skills.txt"
grep -q caveman "$HOME/skills.txt"
grep -q i-have-adhd "$HOME/skills.txt"
# Context Mode 2 is added with `copilot mcp add` (upstream docs/install/copilot-cli.md), so it shows in `mcp list`.
grep -q '"context-mode"' "$HOME/mcp.txt"
# The registered server file must exist, or Copilot would list a server that cannot start.
node -e 'const fs = require("fs"); const s = JSON.parse(fs.readFileSync(process.argv[1], "utf8")).mcpServers["context-mode"]; process.exit(fs.existsSync(s.args.find((a) => a.endsWith("server.mjs"))) ? 0 : 1)' "$HOME/mcp.txt"

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
refute grep -qs playwright-extension "$dir/mcp-config.json"
# Uninstall must leave a config Copilot accepts (it rejects a file without mcpServers).
copilot mcp list --json </dev/null > "$HOME/mcp-after.txt"
refute grep -q '"context-mode"' "$HOME/mcp-after.txt"
echo "real-copilot: OK"
