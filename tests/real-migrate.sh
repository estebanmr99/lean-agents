#!/usr/bin/env bash
# Migrates fixture setups with the real OpenCode 2 and Claude Code binaries in a throwaway HOME:
# a VS Code Copilot repository (project scope) and a Cursor user setup (user scope, where the
# Claude MCP server goes through `claude mcp add`). Used by CI; safe locally because HOME is a temp directory.
set -euo pipefail

command -v opencode >/dev/null || { echo "opencode not on PATH" >&2; exit 1; }
command -v claude >/dev/null || { echo "claude not on PATH" >&2; exit 1; }

HOME="$(mktemp -d)"
export HOME
export XDG_CONFIG_HOME="$HOME/.config"
unset XDG_CACHE_HOME XDG_DATA_HOME XDG_STATE_HOME
repo="$(cd "$(dirname "$0")/.." && pwd)"
# OpenCode 2 starts a background service per HOME; stop it so nothing outlives the job.
trap 'opencode service stop >/dev/null 2>&1 || true' EXIT
secret="SECRET-VALUE-123"
fail=0
check() { if "$@"; then echo "ok    $*"; else echo "FAIL  $*"; fail=1; fi; }
# The first `debug agents` call right after the service starts can miss project agents; ask again.
agents_in() {
  for _ in 1 2 3 4 5; do
    (cd "$1" && opencode debug agents) > "$2" 2>&1 || true
    grep -q "$3" "$2" && return 0
    sleep 2
  done
}
refute() { if "$@"; then echo "FAIL  not: $*"; fail=1; else echo "ok    not: $*"; fi; }

# 1. Project scope: .github/ plus .vscode/mcp.json -> opencode-v2 and claude, files only.
proj="$(mktemp -d)"
# OpenCode lists project agents only inside a git repository.
git init -q "$proj"
mkdir -p "$proj/.github/agents" "$proj/.github/prompts" "$proj/.vscode"
printf '%s\n' '---' 'name: reviewer' 'description: Reviews code' '---' 'Review carefully.' > "$proj/.github/agents/reviewer.agent.md"
printf 'Explain this code.\n' > "$proj/.github/prompts/explain.prompt.md"
printf 'Use tabs.\n' > "$proj/.github/copilot-instructions.md"
cat > "$proj/.vscode/mcp.json" <<JSON
{ "servers": { "gh": { "type": "stdio", "command": "npx", "args": ["-y", "gh-mcp"], "env": { "GH_TOKEN": "$secret" } } } }
JSON
bash "$repo/install.sh" --yes --no-exec --migrate vscode-copilot --project "$proj" --agents opencode-v2,claude
(cd "$proj" && opencode debug config) > "$HOME/project-config.txt"
agents_in "$proj" "$HOME/project-agents.txt" reviewer
check grep -q 'gh-mcp' "$HOME/project-config.txt"
check grep -q '{env:GH_TOKEN}' "$proj/opencode.jsonc"
check grep -q 'reviewer' "$HOME/project-agents.txt"
check test -f "$proj/.claude/agents/reviewer.md"
check test -f "$proj/.claude/commands/explain.md"
check grep -q '\${GH_TOKEN}' "$proj/.mcp.json"
refute grep -rq "$secret" "$proj/.claude" "$proj/.opencode" "$proj/.mcp.json" "$proj/opencode.jsonc" "$HOME/project-config.txt"

# 2. User scope: Cursor setup -> claude (claude mcp add runs here) and opencode-v2.
mkdir -p "$HOME/.cursor/agents"
printf '%s\n' '---' 'name: helper' 'description: Helps' '---' 'Help.' > "$HOME/.cursor/agents/helper.md"
cat > "$HOME/.cursor/mcp.json" <<JSON
{ "mcpServers": { "gh": { "command": "npx", "args": ["-y", "gh-mcp"], "env": { "GH_TOKEN": "$secret" } },
  "remote": { "url": "https://example.com/mcp", "headers": { "Authorization": "Bearer $secret" } } } }
JSON
bash "$repo/install.sh" --yes --migrate cursor --agents claude,opencode-v2
claude mcp get gh > "$HOME/claude-gh.txt" 2>&1 || true
claude mcp get remote > "$HOME/claude-remote.txt" 2>&1 || true
opencode debug config > "$HOME/user-config.txt"
agents_in "$HOME" "$HOME/user-agents.txt" helper
check grep -q 'gh-mcp' "$HOME/claude-gh.txt"
check grep -q 'example.com/mcp' "$HOME/claude-remote.txt"
check grep -q 'gh-mcp' "$HOME/user-config.txt"
check grep -q 'helper' "$HOME/user-agents.txt"
check test -f "$HOME/.claude/agents/helper.md"
refute grep -rq "$secret" "$HOME/.claude" "$HOME/.config/opencode" "$HOME/.claude.json" "$HOME/claude-gh.txt" "$HOME/claude-remote.txt" "$HOME/user-config.txt"

# 3. Uninstall removes the Claude server it added.
bash "$repo/install.sh" --yes --uninstall
refute claude mcp get gh

if [ "$fail" -ne 0 ]; then
  for f in project-config.txt project-agents.txt claude-gh.txt claude-remote.txt user-config.txt user-agents.txt; do echo "--- $f"; head -60 "$HOME/$f"; done
  exit 1
fi
