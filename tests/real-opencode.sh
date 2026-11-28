#!/usr/bin/env bash
# Installs lean-agents into a throwaway HOME and asks the real OpenCode 2 binary
# what it resolved, to prove every key lean-agents writes is accepted and loaded.
# Used by CI; safe to run locally because HOME is a temp directory.
set -euo pipefail

command -v opencode >/dev/null || { echo "opencode not on PATH" >&2; exit 1; }

HOME="$(mktemp -d)"
export HOME
export XDG_CONFIG_HOME="$HOME/.config"
unset XDG_CACHE_HOME XDG_DATA_HOME XDG_STATE_HOME
opencode --version
repo="$(cd "$(dirname "$0")/.." && pwd)"

# #548: show which lean-agents command starts the OpenCode 2 service, and fail if its own run leaves one behind.
# Match the executable name only (the engine does the same: `ps -A -o comm=`, basename), so this script's own
# `bash tests/real-opencode.sh` command line never matches. The second `ps` prints the evidence for the log.
opencode_pids() {
  ps -A -o pid=,comm= | awk '{
    name = $0;
    sub(/^[ \t]*[0-9]+[ \t]+/, "", name);
    sub(/^.*[\\\/]/, "", name);
    sub(/[ \t]+$/, "", name);
    if (name == "opencode" || name == "opencode.exe") { printf "%s%s", (pids ? "," : ""), $1; pids = pids $1 }
  }'
}
opencode_processes() {
  local pids
  pids="$(opencode_pids)"
  [ -n "$pids" ] || return 1
  ps -o pid,lstart,command -p "$pids"
}
# PIDs that appeared during the run; one that was already there belongs to the user or the test setup.
new_pids() {
  awk -v before=",$1," -v after="$2" 'BEGIN {
    n = split(after, a, ",");
    for (i = 1; i <= n; i++) if (a[i] != "" && index(before, "," a[i] ",") == 0) { printf "%s%s", (out ? "," : ""), a[i]; out = 1 }
  }'
}
lean_run() {
  local before after new rc=0
  before="$(opencode_pids)"
  echo "== $(date -u +%T) before: lean-agents $*"
  opencode_processes || true
  bash "$repo/install.sh" "$@" || rc=$?
  after="$(opencode_pids)"
  echo "== $(date -u +%T) after: lean-agents $*"
  opencode_processes || true
  new="$(new_pids "$before" "$after")"
  if [ -n "$new" ]; then
    echo "FAIL  an opencode process is left after: lean-agents $*" >&2
    ps -o pid,lstart,command -p "$new" >&2 || true
    exit 1
  fi
  return "$rc"
}

# The version probe above may start the service; clear it so every lean-agents run starts from none.
opencode service stop >/dev/null 2>&1 || true

lean_run --yes --no-exec --agents opencode-v2 \
  --tools serena,playwright,playwright-extension,ponytail,rtk --privacy strict --profile anthropic-api
# A real --update with one already-installed tool: it runs the adapter and the end-of-run doctor, and must stop the service.
lean_run --update --yes --tools rtk
# #592: --doctor's probe starts the OpenCode 2 service; lean_run fails if one is left that was not running before. Exit code not asserted.
lean_run --doctor || true

# Proves the file name the migration guide gives for the old tui.json.
LC_ALL=C grep -aq 'opencode/cli.json' "$(command -v opencode)"

# #556: a 1.x MCP entry translated by the upgrade code (oauth camelCase, enabled) must be accepted by 2.x as a
# pre-registered client (oauth.client_id) with disabled, not fall back to dynamic client registration.
node --input-type=module - "$repo" "$XDG_CONFIG_HOME/opencode/opencode.jsonc" <<'JS'
import fs from 'node:fs';
import { createRequire } from 'node:module';
const [repo, file] = process.argv.slice(2);
const { parse, modify, applyEdits } = createRequire(`${repo}/package.json`)('jsonc-parser');
const { translateEdits } = await import(`${repo}/scripts/lib/upgrade.mjs`);
const raw = fs.readFileSync(file, 'utf8');
const cfg = parse(raw);
const servers = cfg.mcp?.servers ?? {};
const flat = {
  ...servers,
  remote: { type: 'remote', url: 'https://mcp.example.invalid/mcp', enabled: false, oauth: { clientId: 'fake-client-id', clientSecret: 'fake-client-secret', scope: 'read' } }, // gitleaks:allow (synthetic values)
};
const items = Object.keys(flat).map((name) => ({ client: 'opencode', kind: 'mcp', name, file, keyPath: ['mcp'], upgrade: { class: 'user-translatable' } }));
let text = raw;
for (const e of translateEdits({ ...cfg, mcp: flat }, items)) {
  text = applyEdits(text, modify(text, e.path, e.mode === 'remove' ? undefined : e.value, { formattingOptions: { insertSpaces: true, tabSize: 2 } }));
}
fs.writeFileSync(file, text);
JS

opencode debug config > "$HOME/resolved.txt" 2>"$HOME/stderr.txt" || { cat "$HOME/resolved.txt" "$HOME/stderr.txt"; exit 1; }

if LC_ALL=C grep -E -i 'LoadError|failed to load plugin' "$HOME/stderr.txt" "$HOME/resolved.txt"; then
  echo "FAIL: OpenCode logged a plugin load error" >&2
  exit 1
fi

opencode debug agents > "$HOME/agents.txt" 2>&1 || true
node --input-type=module - "$HOME/resolved.txt" "$repo" "$HOME/agents.txt" <<'JS'
import fs from 'node:fs';
const out = fs.readFileSync(process.argv[2], 'utf8');
const agentsOut = fs.readFileSync(process.argv[4], 'utf8');
const { resolvedOpenCodeConfig } = await import(`${process.argv[3]}/scripts/lib/doctor.mjs`);
const { satisfies } = await import(`${process.argv[3]}/scripts/lib/node-runtime.mjs`);
const { npmSpec, nodeRange } = await import(`${process.argv[3]}/scripts/lib/pins.mjs`);
let cfg;
try { cfg = resolvedOpenCodeConfig(out); } catch (e) { console.log(out); throw e; }
const servers = cfg.mcp?.servers ?? cfg.mcp ?? {};
const checks = {
  'rules in instructions': (cfg.instructions ?? []).some((i) => String(i).includes('lean-agents')),
  'mcp serena': !!servers.serena,
  'mcp playwright': !!servers.playwright,
  'mcp playwright-extension': (servers['playwright-extension']?.command ?? []).includes('--extension'),
  'mcp context-mode': !!servers['context-mode'] || !satisfies(process.versions.node, nodeRange('context-mode')), // skipped on a Node below the pin's range
  'plan model': JSON.stringify(cfg.agents?.plan?.model ?? null).includes('claude-opus-5-5'),
  'subagents loaded': ['explore', 'research', 'review', 'debug', 'planner'].every((a) => agentsOut.includes(a)),
  'deny opencode provider': (cfg.policies ?? []).some((p) => p.resource === 'opencode' && p.effect === 'deny'),
  'compaction buffer': cfg.compaction?.buffer === 40000,
  'ponytail plugin': (cfg.plugins ?? []).includes(npmSpec('ponytail')),
  'default_agent plan': cfg.default_agent === 'plan',
  'share disabled': cfg.share === 'disabled',
  'mcp oauth client_id': servers.remote?.oauth?.client_id === 'fake-client-id' && servers.remote?.oauth?.client_secret !== undefined && servers.remote?.oauth?.scope === 'read',
  'mcp oauth 1.x names gone': servers.remote && servers.remote.oauth.clientId === undefined && servers.remote.oauth.clientSecret === undefined,
  'mcp enabled -> disabled': servers.remote?.disabled === true && servers.remote.enabled === undefined,
};
let failed = false;
for (const [name, ok] of Object.entries(checks)) {
  console.log(`${ok ? 'ok    ' : 'FAIL  '} ${name}`);
  if (!ok) failed = true;
}
console.log('compaction:', JSON.stringify(cfg.compaction ?? null));
console.log('top-level keys:', Object.keys(cfg).sort().join(', '));
if (failed) { console.log('--- config ---'); console.log(out.split('\n').slice(0, 150).join('\n')); console.log('--- agents ---'); console.log(agentsOut.slice(0, 4000)); process.exit(1); }
JS

# The registered Context Mode command must start an MCP server (#107) and answer a real ctx_execute call (#562): without
# `--agent opencode`, every ctx_* call fails with "Project source --agent is missing".
node --input-type=module - "$HOME/resolved.txt" "$repo" "$HOME" <<'JS'
import fs from 'node:fs';
const { resolvedOpenCodeConfig } = await import(`${process.argv[3]}/scripts/lib/doctor.mjs`);
const { probeInitialize, probeToolCall } = await import(`${process.argv[3]}/scripts/lib/inventory.mjs`);
const { satisfies } = await import(`${process.argv[3]}/scripts/lib/node-runtime.mjs`);
const { nodeRange } = await import(`${process.argv[3]}/scripts/lib/pins.mjs`);
if (!satisfies(process.versions.node, nodeRange('context-mode'))) { console.log('skip  context-mode initialize (Node below the pin range)'); process.exit(0); }
const cfg = resolvedOpenCodeConfig(fs.readFileSync(process.argv[2], 'utf8'));
const entry = (cfg.mcp?.servers ?? cfg.mcp)?.['context-mode'];
if (!entry) { console.log('FAIL  context-mode is not registered'); process.exit(1); }
if (entry.command[entry.command.indexOf('--agent') + 1] !== 'opencode') { console.log(`FAIL  context-mode has no --agent opencode: ${entry.command.join(' ')}`); process.exit(1); }
const r = await probeInitialize(entry.command, { expect: 'context-mode' });
console.log(`${r.ok ? 'ok    ' : 'FAIL  '} context-mode initialize serverInfo.name = ${r.name}${r.error ? ` (${r.error})` : ''}`);
const t = await probeToolCall(entry.command, { cwd: process.argv[4], expect: 'ctx-ok' });
console.log(`${t.ok ? 'ok    ' : 'FAIL  '} context-mode ctx_execute --agent opencode${t.error ? ` (${t.error})` : ''}`);
process.exit(r.ok && t.ok ? 0 : 1);
JS

# copilot-usage (fresh HOME, network on: strict skips it). Proves the plugin file lands and no tui.json entry is written
# (2.x discovers plugins/<dir>/tui.js itself). The TUI rendering is proven by real-usage-v2 (tests/real-usage-v2.py).
HOME="$(mktemp -d)"
export HOME
export XDG_CONFIG_HOME="$HOME/.config"
lean_run --yes --no-exec --agents opencode-v2 --tools copilot-usage --network on --lang en --profile anthropic-api
node --input-type=module - "$HOME/.config/opencode" <<'JS'
import fs from 'node:fs';
import path from 'node:path';
const dir = process.argv[2];
const file = path.join(dir, 'plugins', 'lean-copilot-usage', 'tui.js');
if (!fs.existsSync(file) || fs.existsSync(path.join(dir, 'tui.json'))) { console.log('FAIL  copilot-usage plugin file missing, or a tui.json was written on 2.x'); process.exit(1); }
console.log('ok    copilot-usage plugin file (no tui.json entry on 2.x)');
JS
# No second `opencode debug config` here: the first HOME's managed OpenCode service still holds its fixed port, so a new HOME cannot start one.

# RTK on 2.x (#478): rtk's own plugins/rtk.ts has both entries, so 2.x loads it and the hook rewrites a shell call.
# A mock LLM (tests/fixtures/mock-llm.mjs) asks for `ls -la`; an `rtk` wrapper on PATH logs every call and runs the real rtk.
# Needs rtk with `hook opencode` on PATH: CI installs it, locally the check is skipped when it is missing.
rtk_usable=1
if ! command -v rtk >/dev/null || ! rtk hook opencode --help >/dev/null 2>&1; then
  [ -z "${CI:-}" ] || { echo "FAIL  rtk with 'hook opencode' is not on PATH in CI" >&2; exit 1; }
  echo "skip  rtk plugin on 2.x (no rtk with 'hook opencode' on PATH)"
  rtk_usable=0
fi
if [ "$rtk_usable" = 1 ]; then
real_rtk="$(command -v rtk)"
HOME="$(mktemp -d)"
export HOME
export XDG_CONFIG_HOME="$HOME/.config" XDG_DATA_HOME="$HOME/.local/share" XDG_STATE_HOME="$HOME/.local/state" XDG_CACHE_HOME="$HOME/.cache"
T="$HOME"
mkdir -p "$T/bin" "$T/work" "$XDG_CONFIG_HOME/opencode"
pids=""
# shellcheck disable=SC2329 # run by the EXIT trap below
cleanup() { for p in $pids; do kill "$p" 2>/dev/null || true; done; rm -rf "$T" 2>/dev/null || true; }
trap cleanup EXIT
# Same command lean-agents runs on 2.x (the adapter test checks that); rtk writes ~/.config/opencode/plugins/rtk.ts.
"$real_rtk" init -g --opencode >"$T/init.out" 2>&1 || { cat "$T/init.out"; echo "FAIL  rtk init -g --opencode"; exit 1; }
[ -f "$XDG_CONFIG_HOME/opencode/plugins/rtk.ts" ] || { cat "$T/init.out"; echo "FAIL  rtk init wrote no plugins/rtk.ts (rtk init writes under the OS config folder, not XDG?)"; exit 1; }
printf '#!/bin/sh\necho "$*" >> "%s/rtk.log"\nexec "%s" "$@"\n' "$T" "$real_rtk" > "$T/bin/rtk"
chmod +x "$T/bin/rtk"
export PATH="$T/bin:$PATH"

port() { node -e "require('net').createServer().listen(0,'127.0.0.1',function(){console.log(this.address().port);this.close()})"; }
MOCK_LLM_PORT=0 MOCK_LLM_COMMAND='ls -la' MOCK_LLM_TOOL=shell node "$repo/tests/fixtures/mock-llm.mjs" >"$T/mock.out" 2>"$T/mock.err" &
pids="$pids $!"
mock_port=""
for _ in $(seq 1 50); do
  mock_port="$(sed -n 's/^MOCK_LLM_PORT=//p' "$T/mock.out" | head -n 1)"
  [ -n "$mock_port" ] && break
  sleep 0.2
done
[ -n "$mock_port" ] || { echo "FAIL  mock LLM did not start"; exit 1; }
cat >"$XDG_CONFIG_HOME/opencode/opencode.jsonc" <<JSON
{
  "model": "mock/mock-model",
  "providers": {
    "mock": {
      "name": "Mock",
      "package": "@opencode/ai/providers/openai-compatible",
      "settings": { "baseURL": "http://127.0.0.1:$mock_port/v1" },
      "models": { "mock-model": { "name": "Mock Model", "limit": { "context": 300000, "output": 8000 } } }
    }
  }
}
JSON
srv_port="$(port)"
export OPENCODE_SERVER_PASSWORD="rtk-test-$$" OPENCODE_PASSWORD="rtk-test-$$"
(cd "$T/work" && exec opencode serve --hostname 127.0.0.1 --port "$srv_port" >"$T/serve.out" 2>&1) &
pids="$pids $!"
up=0
for _ in $(seq 1 60); do
  if curl -s -o /dev/null "http://127.0.0.1:$srv_port/" 2>/dev/null; then up=1; break; fi
  sleep 0.5
done
[ "$up" = 1 ] || { echo "FAIL  opencode serve did not start"; tail -n 5 "$T/serve.out"; exit 1; }
(cd "$T/work" && exec opencode run --server "http://127.0.0.1:$srv_port" --format json 'list files' >"$T/turn.out" 2>&1) &
turn=$!
for _ in $(seq 1 90); do kill -0 "$turn" 2>/dev/null || break; sleep 1; done
if kill -0 "$turn" 2>/dev/null; then kill "$turn" 2>/dev/null || true; echo "FAIL  the mock turn timed out"; tail -n 5 "$T/turn.out"; exit 1; fi

rtk_ok=1
if LC_ALL=C grep -a -E -i 'LoadError|failed to load plugin' "$T/serve.out" "$T/turn.out" "$XDG_DATA_HOME"/opencode/log/*.log 2>/dev/null; then
  echo "FAIL  OpenCode 2 logged a plugin load error for plugins/rtk.ts"; rtk_ok=0
else
  echo "ok    OpenCode 2 loads plugins/rtk.ts (no LoadError)"
fi
# The plugin asks `rtk hook opencode ... ls -la` and the shell then runs the rewrite, so rtk is called a second time as `ls -la`.
if grep -q '^hook opencode .*ls -la$' "$T/rtk.log" 2>/dev/null && grep -q '^ls -la$' "$T/rtk.log"; then
  echo "ok    the 2.x hook rewrote the shell call to rtk ls -la"
else
  echo "FAIL  no rewrite seen; rtk calls:"; cat "$T/rtk.log" 2>/dev/null || true; tail -n 5 "$T/turn.out"; rtk_ok=0
fi
[ "$rtk_ok" = 1 ] || exit 1
# The undo lean-agents registers for rtk on 2.x removes the plugin again.
"$real_rtk" init -g --opencode --uninstall >"$T/uninstall.out" 2>&1 || { cat "$T/uninstall.out"; echo "FAIL  rtk init -g --opencode --uninstall"; exit 1; }
if [ -e "$XDG_CONFIG_HOME/opencode/plugins/rtk.ts" ]; then echo "FAIL  --uninstall left plugins/rtk.ts"; exit 1; fi
echo "ok    rtk init --uninstall removes plugins/rtk.ts"
fi
