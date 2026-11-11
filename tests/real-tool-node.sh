#!/usr/bin/env bash
# #44, #104: Context Mode and GSD run on an nvm Node 24 while an older Node leads PATH. Real nvm, real packages, real claude, throwaway HOME.
# CI: ubuntu (nvm from tests/ci-downloads.json, NVM_INSTALLER points at it) and windows (Git Bash; real-tool-node.ps1 installs nvm-windows first
# and exports NVM_HOME). Never run it on a machine that has its own nvm: NVM_DIR is a throwaway folder here.
set -euo pipefail

repo="$(cd "$(dirname "$0")/.." && pwd)"
case "$(uname -s)" in Linux|Darwin) os=linux ;; *) os=windows ;; esac
T="$(mktemp -d)"
HOME="$T/home"
export HOME
mkdir -p "$HOME"
unset XDG_CACHE_HOME XDG_DATA_HOME XDG_STATE_HOME
export XDG_CONFIG_HOME="$HOME/.config"
fail() { echo "FAIL: $*" >&2; exit 1; }

home="$HOME"
if [ "$os" = windows ]; then
  # Node, npm and PowerShell need Windows paths.
  home="$(cygpath -w "$HOME")"
  export USERPROFILE="$home" npm_config_prefix="$(cygpath -w "$T")\\npm" npm_config_cache="$(cygpath -w "$T")\\cache"
  export PATH="$T/npm:$PATH"
else
  export npm_config_prefix="$T/npm" npm_config_cache="$T/cache"
  export PATH="$T/npm/bin:$PATH"
fi

# Stubs: lean-agents calls `rtk`, and rtk is not what this test is about.
mkdir -p "$T/stubs"
printf '#!/bin/sh\nexit 0\n' > "$T/stubs/rtk"
printf '@exit /b 0\r\n' > "$T/stubs/rtk.cmd"
chmod +x "$T/stubs/rtk"
export PATH="$T/stubs:$PATH"

# The old Node: 22.20.0 first on PATH. On Linux nvm installs it (and makes it the default alias); on Windows the ps1 did.
if [ "$os" = linux ]; then
  [ -n "${NVM_INSTALLER:-}" ] || fail "NVM_INSTALLER (the pinned nvm install.sh) is not set"
  export NVM_DIR="$T/nvm"
  mkdir -p "$NVM_DIR"
  PROFILE=/dev/null bash "$NVM_INSTALLER"
  set +eu
  . "$NVM_DIR/nvm.sh" --no-use
  nvm install 22.20.0
  set -eu
  export PATH="$NVM_DIR/versions/node/v22.20.0/bin:$PATH"
  default_before="$(cat "$NVM_DIR/alias/default")"
  versions="$NVM_DIR/versions/node"
else
  [ -n "${NVM_HOME:-}" ] || fail "NVM_HOME (set by real-tool-node.ps1) is not set"
  versions="$(cygpath -u "$NVM_HOME")"
fi
case "$(node -p process.version)" in v22.*) ;; *) fail "the old Node is not first on PATH: $(node -p process.version)" ;; esac

# The real claude CLI at its pin, so `claude mcp add` is the real command.
npm install -g "$(node -e "import('$repo/scripts/lib/pins.mjs').then((m) => console.log(m.npmSpec('claude-code')))")"

lean() { node "$repo/scripts/lean.mjs" --home "$home" --yes --no-gh --no-bun "$@"; }
install_all() { lean --agents cursor,opencode-v2,claude --tools context-mode,gsd --profile none --lang en --privacy standard; }
oc="$HOME/.config/opencode/opencode.jsonc"
cursor="$HOME/.cursor/mcp.json"
node24() { ls -d "$versions"/v24.* 2>/dev/null | head -1; }

# A context-mode entry an earlier lean-agents wrote (npx) must be upgraded; one the user edited must stay.
mkdir -p "$(dirname "$oc")" "$(dirname "$cursor")"
echo '{"mcp":{"servers":{"context-mode":{"type":"local","command":["npx","-y","context-mode@2.1.4","server"],"enabled":true}}}}' > "$oc"
echo '{"mcpServers":{"context-mode":{"command":"my-own-ctx","args":[]}}}' > "$cursor"

echo "--- old Node first on PATH: Node 24 comes from nvm, entries are absolute, the default alias stays"
install_all
n24="$(node24)"
[ -n "$n24" ] || fail "no Node 24 under $versions"
case "$(node -p process.version)" in v22.*) ;; *) fail "PATH Node changed" ;; esac
[ "$os" != linux ] || [ "$(cat "$NVM_DIR/alias/default")" = "$default_before" ] || fail "nvm's default alias changed"
grep -q 'context-mode' "$oc" || fail "no context-mode in the OpenCode config"
grep -q 'my-own-ctx' "$cursor" || fail "the hand-edited Cursor entry was not kept"
[ -e "$n24/lib/node_modules/context-mode/cli.mjs" ] || [ -e "$n24/node_modules/context-mode/cli.mjs" ] || fail "context-mode is not installed in Node 24's prefix"
claude mcp get context-mode | tee "$T/claude-get.txt"
grep -q 'v24\.' "$T/claude-get.txt" || fail "claude's context-mode entry is not the absolute Node 24 server"
# VERIFY: how GSD writes its hooks (does the command name Node 24?). Informational until a real run settles it.
grep -h '"command"' "$HOME/.claude/settings.json" 2>/dev/null | grep -i gsd | head -3 || echo "no GSD hook commands in ~/.claude/settings.json"

echo "--- the registered command answers initialize with the old Node first on PATH (#104)"
node --input-type=module - "$oc" "$repo" <<'JS'
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
// The config is JSONC (comments allowed): parse it with the engine's own parser.
const { parse } = createRequire(path.join(process.argv[3], 'package.json'))('jsonc-parser');
const entry = parse(fs.readFileSync(process.argv[2], 'utf8')).mcp.servers['context-mode'];
const [cmd, ...args] = entry.command;
if (!/v24\./.test(cmd)) { console.log(`FAIL  not an absolute Node 24 command: ${cmd}`); process.exit(1); }
const child = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'inherit'] });
const timer = setTimeout(() => { console.log('FAIL  no initialize reply in 120s'); child.kill(); process.exit(1); }, 120000);
let buf = '';
child.on('exit', (code) => { console.log(`FAIL  exited (${code}) before replying to initialize`); process.exit(1); });
child.stdout.on('data', (d) => {
  buf += d;
  for (const line of buf.split('\n')) {
    let msg; try { msg = JSON.parse(line); } catch { continue; }
    if (msg?.id !== 1) continue;
    console.log(`initialize reply: ${line}`);
    const name = msg.result?.serverInfo?.name;
    clearTimeout(timer); child.removeAllListeners('exit'); child.kill();
    console.log(`${name === 'context-mode' ? 'ok    ' : 'FAIL  '} serverInfo.name = ${name}`);
    process.exit(name === 'context-mode' ? 0 : 1);
  }
});
child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'lean-agents-ci', version: '0' } } })}\n`);
JS

echo "--- a rerun changes nothing and installs no second Node"
before="$(cat "$oc" "$cursor")"
count="$(ls "$versions" | wc -l)"
install_all
[ "$(cat "$oc" "$cursor")" = "$before" ] || fail "a rerun changed the configs"
[ "$(ls "$versions" | wc -l)" = "$count" ] || fail "a rerun installed another Node"

echo "--- --uninstall removes the entries and the prefixed package; Node 24 stays"
lean --uninstall
grep -q 'context-mode' "$oc" && fail "the OpenCode entry is still there"
grep -q 'my-own-ctx' "$cursor" || fail "uninstall removed the hand-edited Cursor entry"
[ ! -e "$n24/lib/node_modules/context-mode" ] && [ ! -e "$n24/node_modules/context-mode" ] || fail "the prefixed context-mode package is still installed"
[ -d "$n24" ] || fail "uninstall removed Node 24"
if claude mcp get context-mode >/dev/null 2>&1; then fail "claude still has the context-mode entry"; fi

echo "--- no nvm: the skip line, and no context-mode key"
if [ "$os" = linux ]; then export NVM_DIR="$T/no-nvm"; else unset NVM_HOME; fi
rm -rf "$HOME/.config" "$HOME/.cursor"
lean --no-exec --agents cursor,opencode-v2 --tools context-mode --profile none --lang en --privacy standard | tee "$T/skip.txt"
grep -q 'context-mode needs Node >=24.15.0, found 22.20.0: skipped. Install nvm or Node 24.15+, then run --update.' "$T/skip.txt" || fail "no skip line"
grep -rq 'context-mode' "$HOME/.config/opencode" "$HOME/.cursor" 2>/dev/null && fail "context-mode was registered without a matching Node"
echo "real-tool-node: ok"
