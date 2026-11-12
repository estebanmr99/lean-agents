#!/usr/bin/env bash
# #44, #104: Context Mode and GSD run on an nvm Node 24 while an older Node leads PATH. Real nvm, real packages, real claude, throwaway HOME.
# CI: ubuntu (nvm.sh at v0.41.0 from tests/ci-downloads.json, SHA256-checked; NVM_SH points at it) and windows (Git Bash; real-tool-node.ps1 installs nvm-windows first
# and exports NVM_HOME). Never run it on a machine that has its own nvm: NVM_DIR is a throwaway folder here.
set -euo pipefail

repo="$(cd "$(dirname "$0")/.." && pwd)"
case "$(uname -s)" in Linux|Darwin) os=linux ;; *) os=windows ;; esac
HOME="$(mktemp -d)"
export HOME
T="$HOME"
unset XDG_CACHE_HOME XDG_DATA_HOME XDG_STATE_HOME
export XDG_CONFIG_HOME="$HOME/.config"
fail() { echo "FAIL: $*" >&2; exit 1; }

home="$HOME"
if [ "$os" = windows ]; then
  # Node, npm and PowerShell need Windows paths.
  home="$(cygpath -w "$HOME")"
  win_t="$(cygpath -w "$T")"
  export USERPROFILE="$home" npm_config_prefix="$win_t\\npm" npm_config_cache="$win_t\\cache"
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
  [ -n "${NVM_SH:-}" ] || fail "NVM_SH (the pinned nvm.sh) is not set"
  # nvm.sh is all nvm needs (it downloads Node itself); install.sh would git-fetch nvm unchecked.
  export NVM_DIR="$T/nvm"
  mkdir -p "$NVM_DIR"
  cp "$NVM_SH" "$NVM_DIR/nvm.sh"
  # nvm refuses to run with an npm prefix in the environment (this script sets one for its throwaway HOME), so only this subshell drops it.
  # The engine must cope with the prefix itself: it is still set for every lean.mjs run below.
  (
    unset npm_config_prefix NPM_CONFIG_PREFIX
    set +eu
    # shellcheck source=/dev/null
    . "$NVM_DIR/nvm.sh" --no-use
    nvm install 22.20.0
  )
  export PATH="$NVM_DIR/versions/node/v22.20.0/bin:$PATH"
  # A fresh NVM_DIR may have no default alias, so "none" is a valid value to compare.
  default_alias() { cat "$NVM_DIR/alias/default" 2>/dev/null || echo none; }
  default_before="$(default_alias)"
  versions="$NVM_DIR/versions/node"
else
  [ -n "${NVM_HOME:-}" ] || fail "NVM_HOME (set by real-tool-node.ps1) is not set"
  versions="$(cygpath -u "$NVM_HOME")"
fi
case "$(node -p process.version)" in v22.*) ;; *) fail "the old Node is not first on PATH: $(node -p process.version)" ;; esac

# The real claude CLI at its pin, so `claude mcp add` is the real command.
# A relative import: a bash path (/d/a/...) inside node -e would turn into a doubled-drive file URL on Windows.
claude_spec="$(cd "$repo" && node -e "import('./scripts/lib/pins.mjs').then((m) => console.log(m.npmSpec('claude-code')))")"
[ -n "$claude_spec" ] || fail "no claude-code pin spec"
npm install -g "$claude_spec"

lean() { node "$repo/scripts/lean.mjs" --home "$home" --yes --no-gh --no-bun "$@"; }
install_all() { lean --agents cursor,opencode-v2,claude --tools context-mode,gsd --profile none --lang en --privacy standard; }
oc="$HOME/.config/opencode/opencode.jsonc"
cursor="$HOME/.cursor/mcp.json"
node24() { local d; for d in "$versions"/v24.*; do if [ -e "$d" ]; then echo "$d"; return; fi; done; }
count_nodes() { find "$versions" -mindepth 1 -maxdepth 1 | wc -l; }

# A context-mode entry an earlier lean-agents wrote (npx) must be upgraded; one the user edited must stay.
mkdir -p "$(dirname "$oc")" "$(dirname "$cursor")"
echo '{"mcp":{"servers":{"context-mode":{"type":"local","command":["npx","-y","context-mode@2.1.4","server"],"enabled":true}}}}' > "$oc"
echo '{"mcpServers":{"context-mode":{"command":"my-own-ctx","args":[]}}}' > "$cursor"

echo "--- old Node first on PATH: Node 24 comes from nvm, entries are absolute, the default alias stays"
install_all
n24="$(node24)"
[ -n "$n24" ] || fail "no Node 24 under $versions"
case "$(node -p process.version)" in v22.*) ;; *) fail "PATH Node changed" ;; esac
[ "$os" != linux ] || [ "$(default_alias)" = "$default_before" ] || fail "nvm's default alias changed"
# The seeded legacy npx entry must now be the absolute Node 24 server (the user's own Cursor entry stays below).
oc_cmd="$(cd "$repo" && node -e "const { parse } = require('jsonc-parser'); const e = parse(require('fs').readFileSync(process.argv[1], 'utf8')).mcp.servers['context-mode']; console.log(e ? e.command.join(' ') : 'none')" "$oc")"
case "$oc_cmd" in *v24.*cli.mjs\ server) ;; *) fail "the OpenCode entry is not the absolute Node 24 server: $oc_cmd" ;; esac
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
count="$(count_nodes)"
install_all
[ "$(cat "$oc" "$cursor")" = "$before" ] || fail "a rerun changed the configs"
[ "$(count_nodes)" = "$count" ] || fail "a rerun installed another Node"

echo "--- --uninstall removes the entries and the prefixed package; Node 24 stays"
lean --uninstall
grep -q 'context-mode' "$oc" && fail "the OpenCode entry is still there"
grep -q 'my-own-ctx' "$cursor" || fail "uninstall removed the hand-edited Cursor entry"
if [ -e "$n24/lib/node_modules/context-mode" ] || [ -e "$n24/node_modules/context-mode" ]; then fail "the prefixed context-mode package is still installed"; fi
[ -d "$n24" ] || fail "uninstall removed Node 24"
if claude mcp get context-mode >/dev/null 2>&1; then fail "claude still has the context-mode entry"; fi

echo "--- --doctor shows the Node per tool: a symlink-launched MCP is flagged, an absolute one is ok, a duplicate skill is reported (#104, #132)"
native() { if [ "$os" = windows ]; then cygpath -w "$1"; else printf '%s\n' "$1"; fi; }
# A link to Node 22 like nvm's "current" (a directory junction on Windows, which needs no admin rights).
link="$T/node-current"
# The doctor calls a link "nvm's" only at $NVM_DIR/current (POSIX) or at NVM_SYMLINK (nvm-windows).
if [ "$os" = linux ]; then link="$NVM_DIR/current"; else export NVM_SYMLINK="$(native "$link")"; fi
node -e "require('fs').symlinkSync(process.argv[1], process.argv[2], 'junction')" "$(native "$versions/v22.20.0")" "$(native "$link")"
if [ "$os" = linux ]; then link_node="$link/bin/node"; abs_node="$n24/bin/node"; mods="$n24/lib/node_modules"; else link_node="$link/node.exe"; abs_node="$n24/node.exe"; mods="$n24/node_modules"; fi
mkdir -p "$HOME/.copilot" "$HOME/.agents/skills/dup-demo" "$HOME/.claude/skills/dup-demo"
node -e "
const [file, link, abs, mods] = process.argv.slice(1);
const cli = require('path').join(mods, 'context-mode', 'cli.mjs');
require('fs').writeFileSync(file, JSON.stringify({ mcpServers: { 'ctx-link': { command: link, args: [cli, 'server'] }, 'ctx-abs': { command: abs, args: [cli, 'server'] } } }));
" "$HOME/.copilot/mcp-config.json" "$(native "$link_node")" "$(native "$abs_node")" "$(native "$mods")"
echo '# one' > "$HOME/.agents/skills/dup-demo/SKILL.md"
echo '# two' > "$HOME/.claude/skills/dup-demo/SKILL.md"
lean --doctor --json --no-exec > "$T/doctor.json" || true
node -e "
const d = JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8'));
console.log(JSON.stringify({ nodes: d.nodes, skills: d.skills }, null, 2));
const n = Object.fromEntries(d.nodes.map((x) => [x.name, x]));
const bad = [];
if (n['ctx-link']?.style !== 'symlink' || n['ctx-link'].status !== 'error' || !/^22\./.test(n['ctx-link'].nodeVersion)) bad.push('ctx-link is not a flagged symlink on Node 22');
if (n['ctx-abs']?.style !== 'absolute' || n['ctx-abs'].status !== 'ok' || !/^24\./.test(n['ctx-abs'].nodeVersion)) bad.push('ctx-abs is not an ok absolute Node 24');
const s = d.skills.find((x) => x.name === 'dup-demo');
if (!s || !s.differs || s.winner !== 'unknown (load order)') bad.push('dup-demo is not reported as a differing duplicate');
if (bad.length) { console.log('FAIL ' + bad.join('; ')); process.exit(1); }
" "$T/doctor.json" || fail "the doctor rows are wrong (see above)"

echo "--- no nvm: the skip line, and no context-mode key"
if [ "$os" = linux ]; then export NVM_DIR="$T/no-nvm"; else unset NVM_HOME; fi
rm -rf "$HOME/.config" "$HOME/.cursor"
lean --no-exec --agents cursor,opencode-v2 --tools context-mode --profile none --lang en --privacy standard | tee "$T/skip.txt"
grep -q 'context-mode needs Node >=24.15.0, found 22.20.0: skipped. Install nvm or Node 24.15+, then run --update.' "$T/skip.txt" || fail "no skip line"
grep -rq 'context-mode' "$HOME/.config/opencode" "$HOME/.cursor" 2>/dev/null && fail "context-mode was registered without a matching Node"
echo "real-tool-node: ok"
