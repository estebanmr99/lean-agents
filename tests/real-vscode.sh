#!/usr/bin/env bash
# Installs lean-agents for VS Code Copilot into a throwaway HOME, then lets the real `code` CLI
# write to the same user mcp.json and install Copilot Chat, which proves the path and format.
# Also renders the --project files. No login and no TTY. Used by CI; safe locally.
set -euo pipefail

# `! cmd` never stops a set -e script, so negative checks go through this.
refute() { if "$@"; then echo "must not succeed: $*" >&2; exit 1; fi; }

command -v code >/dev/null || { echo "code not on PATH" >&2; exit 1; }

code_bin="$(command -v code)"
HOME="$(mktemp -d)"
export HOME
export XDG_CONFIG_HOME="$HOME/.config"
unset XDG_CACHE_HOME XDG_DATA_HOME XDG_STATE_HOME
"$code_bin" --version
repo="$(cd "$(dirname "$0")/.." && pwd)"
if [[ "$(uname)" == Darwin ]]; then user="$HOME/Library/Application Support/Code/User"; else user="$HOME/.config/Code/User"; fi

bash "$repo/install.sh" --yes --agents vscode-copilot --tools serena,playwright,caveman \
  --privacy strict --lang en --ponytail-mode off </dev/null 2>&1 | tee "$HOME/install.txt"
refute grep -qE '^ *! ' "$HOME/install.txt"

grep -q 'lean-agents:start' "$HOME/.copilot/copilot-instructions.md"
grep -q '^model: claude-opus-5.5$' "$HOME/.copilot/agents/planner.agent.md"
test -f "$HOME/.agents/skills/caveman/SKILL.md"
grep -q '"telemetry.telemetryLevel": "off"' "$user/settings.json"

# VS Code writes its own server into the user mcp.json: ours must be in the same file, beside it.
"$code_bin" --add-mcp '{"name":"probe","command":"node","args":["--version"]}' </dev/null
node -e '
  const s = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).servers;
  for (const k of ["probe", "serena", "playwright", "context-mode"]) if (!s[k]) throw new Error(`no ${k} in user mcp.json`);
  if (s.serena.type !== "stdio") throw new Error("serena is not stdio");
' "$user/mcp.json"

ext="$HOME/vscode-extensions"
"$code_bin" --extensions-dir "$ext" --install-extension GitHub.copilot-chat </dev/null
"$code_bin" --extensions-dir "$ext" --list-extensions </dev/null > "$HOME/extensions.txt"
grep -qi '^github.copilot-chat$' "$HOME/extensions.txt"

node "$repo/scripts/lean.mjs" --doctor </dev/null

node "$repo/scripts/lean.mjs" --uninstall --yes </dev/null 2>&1 | tee "$HOME/uninstall.txt"
refute grep -qE '^ *! ' "$HOME/uninstall.txt"
refute test -e "$HOME/.copilot/agents/planner.agent.md"
refute test -e "$HOME/.agents/skills/caveman"
refute grep -qs telemetryLevel "$user/settings.json"
refute grep -qs serena "$user/mcp.json"
grep -q probe "$user/mcp.json"

# Team mode: the files VS Code reads from a workspace, valid and free of local paths.
proj="$HOME/team-repo"
mkdir -p "$proj"
git -C "$proj" init -q
node "$repo/scripts/lean.mjs" --project "$proj" --yes --tools serena,playwright --privacy standard --lang en </dev/null
node -e '
  const s = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).servers;
  for (const k of ["serena", "playwright", "context-mode"]) if (s[k]?.type !== "stdio") throw new Error(`no stdio ${k}`);
' "$proj/.vscode/mcp.json"
grep -q '^name: review$' "$proj/.github/agents/review.agent.md"
grep -q 'AGENTS.md' "$proj/.github/copilot-instructions.md"
refute grep -rqs "$HOME" "$proj/AGENTS.md" "$proj/.github" "$proj/.vscode" "$proj/.cursor"
node "$repo/scripts/lean.mjs" --project "$proj" --uninstall --yes </dev/null
test -z "$(git -C "$proj" status --porcelain)"
echo "real-vscode: OK"
