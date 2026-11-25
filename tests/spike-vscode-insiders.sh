#!/usr/bin/env bash
# Spike (1.2.1): the real VS Code Insiders CLI writes its user mcp.json where lean-agents writes it
# (`Code - Insiders/User`), lean-agents' servers sit beside VS Code's own, and --uninstall removes only ours.
# No login, no TTY. HOME is a temp directory, so it is safe locally (needs `code-insiders` on PATH).
set -euo pipefail
trap 'echo "failed at line $LINENO" >&2' ERR

command -v code-insiders >/dev/null || { echo "code-insiders not on PATH" >&2; exit 1; }
bin="$(command -v code-insiders)"
repo="$(cd "$(dirname "$0")/.." && pwd)"
HOME="$(mktemp -d)"
export HOME XDG_CONFIG_HOME="$HOME/.config"
unset XDG_CACHE_HOME XDG_DATA_HOME XDG_STATE_HOME
"$bin" --version | head -1
if [[ "$(uname)" == Darwin ]]; then user="$HOME/Library/Application Support/Code - Insiders/User"; else user="$HOME/.config/Code - Insiders/User"; fi

# VS Code Insiders picks the folder itself: nothing exists before this call.
"$bin" --add-mcp '{"name":"probe","command":"node","args":["--version"]}' </dev/null
test -f "$user/mcp.json" || { echo "Insiders did not write $user/mcp.json" >&2; find "$HOME" -name mcp.json >&2; exit 1; }
echo "Insiders user mcp.json: ${user#"$HOME"/}"

node "$repo/scripts/lean.mjs" --home "$HOME" --yes --no-exec --agents vscode-copilot --tools serena --privacy strict --lang en --profile none </dev/null >/dev/null
servers() { node -e 'console.log(Object.keys(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).servers).sort().join(","))' "$user/mcp.json"; }
echo "after install: $(servers)"
[[ ",$(servers)," == *,probe,* && ",$(servers)," == *,serena,* ]]
grep -q '"telemetry.telemetryLevel": "off"' "$user/settings.json"

node "$repo/scripts/lean.mjs" --home "$HOME" --uninstall --yes --no-exec </dev/null >/dev/null
echo "after uninstall: $(servers)"
[[ "$(servers)" == probe ]]
rm -rf "$HOME"
echo "PASS: spike-vscode-insiders"
