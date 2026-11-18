#!/usr/bin/env bash
# Spike (#80 B0): OpenCode 1.19 and 2.2.5 side by side in one throwaway HOME. Prints labelled V1-V4 lines for the
# layout decision (shared vs isolated config/data); asserts that both binaries run --version.
# Spike (#80 part 2, P1): proves which env set runs 1.19 on a frozen copy while the live dirs stay byte-identical
# (P1 lines; asserts the XDG sets, prints OPENCODE_DB as evidence), and whether 2.x migrates the db on --version / debug config.
# Used by CI (ubuntu, windows via Git Bash); safe locally because HOME is a temp directory.
set -uo pipefail

repo="$(cd "$(dirname "$0")/.." && pwd)"
T="$(mktemp -d)"
HOME="$T/home"
export HOME
mkdir -p "$HOME"
if command -v cygpath >/dev/null 2>&1; then USERPROFILE="$(cygpath -w "$HOME")"; export USERPROFILE; fi
unset XDG_CONFIG_HOME XDG_CACHE_HOME XDG_DATA_HOME XDG_STATE_HOME OPENCODE_CONFIG OPENCODE_CONFIG_DIR
export npm_config_cache="$T/npmcache"

CFG="$HOME/.config/opencode"
DATA="$HOME/.local/share/opencode"
B1="" B2="" MOCK_PID=""
# shellcheck disable=SC2329 # called through the trap
cleanup() { [ -n "$MOCK_PID" ] && { kill "$MOCK_PID"; wait "$MOCK_PID"; } 2>/dev/null; [ -n "$B2" ] && "$B2" service stop >/dev/null 2>&1; rm -rf "$T"; }
trap cleanup EXIT

# tree.mjs snap <label> <dir> <out.json> | diff <label> <a.json> <b.json>: sha256 manifests, short output.
cat > "$T/tree.mjs" <<'JS'
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const [mode, label, a, b] = process.argv.slice(2);
const walk = (dir, root, out) => {
  let ents = [];
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of ents) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, root, out);
    else if (e.isFile()) out[path.relative(root, p).split(path.sep).join('/')] = crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex').slice(0, 8);
  }
  return out;
};
const cap = (lines) => { console.log(lines.slice(0, 15).join('\n')); if (lines.length > 15) console.log(`  ... +${lines.length - 15} more`); };
if (mode === 'snap') {
  const m = walk(a, a, {});
  fs.writeFileSync(b, JSON.stringify(m));
  const tree = crypto.createHash('sha256').update(JSON.stringify(Object.entries(m).sort())).digest('hex').slice(0, 8);
  const dbs = Object.entries(m).filter(([k]) => /^opencode\.db/.test(k)).map(([k, v]) => `${k}=${v}`).join(' ') || 'none';
  console.log(`${label}: ${Object.keys(m).length} files tree=${tree} db: ${dbs}`);
} else {
  const x = JSON.parse(fs.readFileSync(a, 'utf8')), y = JSON.parse(fs.readFileSync(b, 'utf8'));
  const lines = [];
  for (const k of Object.keys(y)) if (!(k in x)) lines.push(`  + ${k}`); else if (x[k] !== y[k]) lines.push(`  ~ ${k}`);
  for (const k of Object.keys(x)) if (!(k in y)) lines.push(`  - ${k}`);
  console.log(`${label}: ${lines.length} differences`);
  cap(lines);
}
JS
# dbinfo <label>: schema facts from a copy of the db (+wal/shm) so the original is never opened. n/a when node:sqlite is missing.
cat > "$T/dbinfo.mjs" <<'JS'
import fs from 'node:fs';
const [src, label, tmp] = process.argv.slice(2);
try {
  const { DatabaseSync } = await import('node:sqlite');
  fs.mkdirSync(tmp, { recursive: true });
  for (const ext of ['', '-wal', '-shm']) if (fs.existsSync(src + ext)) fs.copyFileSync(src + ext, `${tmp}/c.db${ext}`);
  const db = new DatabaseSync(`${tmp}/c.db`);
  const tables = db.prepare("select name from sqlite_master where type='table'").all().map((r) => r.name);
  const count = (t) => (tables.includes(t) ? db.prepare(`select count(*) n from "${t}"`).get().n : 'no-table');
  const mig = tables.filter((t) => /migrat/i.test(t)).map((t) => `${t}=${count(t)}`).join(',') || 'none';
  console.log(`${label}: user_version=${db.prepare('pragma user_version').get().user_version} tables=${tables.length} migrations: ${mig} sessions=${count('session')}`);
  db.close();
} catch (e) { console.log(`${label}: n/a (${String(e.message).slice(0, 60)})`); }
JS
dbinfo() { [ -e "$DATA/opencode.db" ] && node "$T/dbinfo.mjs" "$DATA/opencode.db" "$1" "$T/dbcopy-$1" || echo "$1: no db"; }
snap() { node "$T/tree.mjs" snap "$1 $2" "$3" "$T/$1-$2.json"; }
snapdiff() { node "$T/tree.mjs" diff "$1" "$T/$2.json" "$T/$3.json"; }
snap_both() { snap "$1" config "$CFG"; snap "$1" data "$DATA"; }
capn() { head -n "${1:-12}" | sed 's/^/  /'; }
# run_to <secs> <cmd...>: no timeout binary on every runner, so poll in the background.
run_to() {
  local secs=$1; shift
  "$@" & local pid=$!
  local i=0
  while kill -0 "$pid" 2>/dev/null && [ "$i" -lt "$secs" ]; do sleep 1; i=$((i + 1)); done
  if kill -0 "$pid" 2>/dev/null; then kill "$pid" 2>/dev/null; echo "  (killed after ${secs}s)"; return 124; fi
  wait "$pid"
}
user_path() { powershell.exe -NoProfile -Command "[Environment]::GetEnvironmentVariable('Path','User')" 2>/dev/null | tr -d '\r'; }
is_windows() { case "$(uname -s)" in MINGW*|MSYS*|CYGWIN*) return 0 ;; *) return 1 ;; esac; }

echo "== setup: $(uname -s), node $(node -v)"
cd "$repo" || exit 1

# --- install 1.x (npm, separate prefix) and 2.x (pinned installer) ---
v1spec="$(node --input-type=module -e "import('./scripts/lib/pins.mjs').then((m) => console.log(m.npmSpec('opencode-v1')))")"
npm install -g --prefix "$T/npm1" "$v1spec" >"$T/npm1.log" 2>&1 || { tail -5 "$T/npm1.log"; echo "FAIL npm install $v1spec"; exit 1; }
# Newer npm blocks install scripts unless allowed; 1.x needs its postinstall (it links the platform binary), so run it by hand.
for d in "$T/npm1/lib/node_modules/opencode-ai" "$T/npm1/node_modules/opencode-ai"; do [ -d "$d" ] && (cd "$d" && node postinstall.mjs >/dev/null 2>&1); done
if [ -e "$T/npm1/bin/opencode" ]; then B1="$T/npm1/bin/opencode"; else B1="$T/npm1/opencode.cmd"; fi

: > "$HOME/.bashrc"; : > "$HOME/.zshrc"; : > "$HOME/.profile"
find "$HOME" -type f 2>/dev/null | sort > "$T/home-before.txt"
rc_before="$(cat "$HOME/.bashrc" "$HOME/.zshrc" "$HOME/.profile" | wc -c | tr -d ' ')"
is_windows && path_before="$(user_path)"

mkdir -p "$T/dl"
bash scripts/ci-download.sh opencode-installer "$T/dl/opencode-install" || exit 1
v2ver="$(node -p "require('./core/pins.json').pins['opencode-v2'].version")"
bash "$T/dl/opencode-install" --version "$v2ver" --no-modify-path >"$T/v2-install.log" 2>&1 || { tail -8 "$T/v2-install.log"; echo "FAIL v2 installer"; exit 1; }

find "$HOME" -type f 2>/dev/null | sort > "$T/home-after.txt"
for c in "$HOME/.opencode/bin/opencode" "$HOME/.opencode/bin/opencode.exe"; do [ -e "$c" ] && B2="$c" && break; done
[ -z "$B2" ] && B2="$(grep -E '/opencode(\.exe)?$' "$T/home-after.txt" | grep -v "$T/npm1" | head -1)"

echo "== V4: where the v2 installer put files"
echo "V4 binary: ${B2#"$HOME"/}"
echo "V4 new files under HOME: $(comm -13 "$T/home-before.txt" "$T/home-after.txt" | wc -l | tr -d ' ')"
comm -13 "$T/home-before.txt" "$T/home-after.txt" | sed "s|^$HOME/||" | sed 's|/[^/]*$||' | sort | uniq -c | capn 10
rc_after="$(cat "$HOME/.bashrc" "$HOME/.zshrc" "$HOME/.profile" | wc -c | tr -d ' ')"
echo "V4 rc files (.bashrc .zshrc .profile) bytes before/after: $rc_before/$rc_after"
if is_windows; then
  path_after="$(user_path)"
  [ "$path_before" = "$path_after" ] && echo "V4 HKCU Path: unchanged" || echo "V4 HKCU Path: CHANGED (mentions .opencode: $(printf '%s' "$path_after" | grep -ci '\.opencode'))"
fi
echo "V4 installer log (last lines):"; tail -n 4 "$T/v2-install.log" | capn 4

echo "== run --version (the only assertions)"
v1out="$(run_to 60 "$B1" --version 2>&1)"; rc1=$?
v2out="$(run_to 60 "$B2" --version 2>&1)"; rc2=$?
echo "1.x --version: $v1out (exit $rc1)"
echo "2.x --version: $v2out (exit $rc2)"
fail=0
[ "$rc1" -eq 0 ] || fail=1
[ "$rc2" -eq 0 ] || fail=1

# Own service port: 2.x defaults to one shared port, and another opencode on the machine may hold it.
"$B2" service set port $((20000 + RANDOM % 40000)) >/dev/null 2>&1

echo "== V1: opencode debug paths"
echo "V1 1.x:"; run_to 60 "$B1" debug paths 2>&1 | sed "s|$HOME|~|g" | capn 14
echo "V1 2.x:"; run_to 60 "$B2" debug paths 2>&1 | sed "s|$HOME|~|g" | capn 14

# --- hand config with 1.x keys, then the first starts ---
mkdir -p "$CFG"
cat > "$CFG/opencode.jsonc" <<'JSON'
{
  "$schema": "https://opencode.ai/config.json",
  "agent": { "spike1x": { "description": "1.x agent", "prompt": "x" } },
  "plugin": ["@tarquinen/opencode-dcp@3.2.0"],
  "mcp": { "spike1x": { "type": "local", "command": ["echo", "x"] } },
  "compaction": { "auto": true, "reserved": 12345 },
  "autoupdate": false,
  "share": "disabled"
}
JSON
# shellcheck disable=SC2016 # literal $schema key
printf '%s\n' '{ "$schema": "https://opencode.ai/tui.json", "theme": "opencode" }' > "$CFG/tui.json"
snap_both S0-seeded

echo "== V1/V2: hashes around the first starts (session list creates the db)"
run_to 90 "$B1" session list >"$T/s1.txt" 2>&1; echo "1.x session list exit $?"
snap_both S1-after-1x
dbinfo "V2 db after 1.x"
run_to 90 "$B2" session list >"$T/s2.txt" 2>&1; echo "2.x session list exit $?"; capn 4 < "$T/s2.txt"
snap_both S2-after-2x
dbinfo "V2 db after 2.x"
echo "V2 1.x start -> 2.x start:"
snapdiff "V2 config" S1-after-1x-config S2-after-2x-config
snapdiff "V2 data" S1-after-1x-data S2-after-2x-data
run_to 90 "$B1" session list >"$T/s3.txt" 2>&1; echo "1.x session list after 2.x exit $?"; capn 4 < "$T/s3.txt"
snap_both S3-after-1x-again
dbinfo "V2 db after 1.x again"
snapdiff "V2 config after 1.x again" S2-after-2x-config S3-after-1x-again-config
snapdiff "V2 data after 1.x again" S2-after-2x-data S3-after-1x-again-data

echo "== V3: key tolerance (debug config, top-level keys the binary resolved)"
cat > "$T/keys.mjs" <<'JS'
import fs from 'node:fs';
const out = fs.readFileSync(process.argv[2], 'utf8');
const { resolvedOpenCodeConfig } = await import(`${process.argv[3]}/scripts/lib/doctor.mjs`);
try {
  const c = resolvedOpenCodeConfig(out);
  const has = (k) => (k in c ? 'kept' : 'dropped');
  console.log(`  keys: ${Object.keys(c).sort().join(',')}`);
  console.log(`  1.x agent:${has('agent')} plugin:${has('plugin')} compaction.reserved:${'reserved' in (c.compaction ?? {}) ? 'kept' : 'dropped'} autoupdate:${has('autoupdate')} | 2.x agents:${has('agents')} plugins:${has('plugins')} compaction.buffer:${'buffer' in (c.compaction ?? {}) ? 'kept' : 'dropped'} update:${has('update')}`);
  console.log(`  mcp: ${JSON.stringify(c.mcp ?? null).slice(0, 160)}`);
} catch (e) { console.log(`  not JSON (${String(e.message).slice(0, 80)}); first lines:`); console.log(out.split('\n').slice(0, 3).map((l) => `    ${l}`).join('\n')); }
JS
probe() { # probe <label> <binary>
  run_to 90 "$2" debug config >"$T/dc.out" 2>"$T/dc.err"; local rc=$?
  echo "V3 $1: exit $rc"
  node "$T/keys.mjs" "$T/dc.out" "$repo" 2>&1
  [ -s "$T/dc.err" ] && { echo "  stderr:"; head -n 3 "$T/dc.err" | cut -c1-160 | sed 's/^/    /'; }
}
cp "$CFG/opencode.jsonc" "$T/cfg-1x.jsonc"
cat > "$T/cfg-2x.jsonc" <<'JSON'
{
  "agents": { "spike2x": { "description": "2.x agent", "prompt": "x" } },
  "plugins": ["@tarquinen/opencode-dcp@3.2.0"],
  "mcp": { "servers": { "spike2x": { "type": "local", "command": ["echo", "x"] } } },
  "compaction": { "auto": true, "buffer": 40000 },
  "update": "disable",
  "share": "disabled"
}
JSON
node -e "
const fs=require('fs'),{parse}=(()=>{try{return require('jsonc-parser')}catch{return {parse:JSON.parse}}})();
const a=parse(fs.readFileSync('$T/cfg-1x.jsonc','utf8')),b=parse(fs.readFileSync('$T/cfg-2x.jsonc','utf8'));
const m={...a,...b,compaction:{...a.compaction,...b.compaction},mcp:{...a.mcp,...b.mcp}};
fs.writeFileSync('$T/cfg-mixed.jsonc',JSON.stringify(m,null,2));
"
for cfgname in 1x 2x mixed; do
  cp "$T/cfg-$cfgname.jsonc" "$CFG/opencode.jsonc"
  probe "1.x binary reads ${cfgname}-keys config" "$B1"
  probe "2.x binary reads ${cfgname}-keys config" "$B2"
done
snap_both S4-after-probes
snapdiff "V3 config after probes (vs S3)" S3-after-1x-again-config S4-after-probes-config
snapdiff "V3 data after probes (vs S3)" S3-after-1x-again-data S4-after-probes-data


# ===== P1 (#80 part 2): can `opencode1` (1.19) run on a frozen copy while the live dirs stay untouched? =====
# Fresh HOME so the B0 runs above (which left 2.x-migrated data) do not leak in. "Live" = the default dirs of this HOME.
"$B2" service stop >/dev/null 2>&1
HOME="$T/p1home"; export HOME
mkdir -p "$HOME/AppData/Roaming" "$T/proj"
if command -v cygpath >/dev/null 2>&1; then USERPROFILE="$(cygpath -w "$HOME")"; APPDATA="$(cygpath -w "$HOME/AppData/Roaming")"; export USERPROFILE APPDATA; fi
unset XDG_CONFIG_HOME XDG_CACHE_HOME XDG_DATA_HOME XDG_STATE_HOME OPENCODE_CONFIG OPENCODE_CONFIG_DIR OPENCODE_DB GH_TOKEN GITHUB_TOKEN GH_CONFIG_DIR
CFG="$HOME/.config/opencode"; DATA="$HOME/.local/share/opencode"; STATE="$HOME/.local/state/opencode"
np() { if command -v cygpath >/dev/null 2>&1; then cygpath -m "$1"; else printf '%s' "$1"; fi; } # native path for env values
echo "== P1: isolation proof (1.19 on a frozen copy)"

# Synthetic gh login in the place gh reads without any env (Windows: %AppData%\GitHub CLI), to see whether XDG_CONFIG_HOME hides it.
if is_windows; then ghdir="$HOME/AppData/Roaming/GitHub CLI"; else ghdir="$HOME/.config/gh"; fi
mkdir -p "$ghdir"
printf 'github.com:\n    oauth_token: synthetic-not-a-token\n    user: synthetic\n    git_protocol: https\n' > "$ghdir/hosts.yml"

# Fake stdio MCP server: logs what an MCP child inherits (booleans only), answers the handshake with no tools.
cat > "$T/p1probe.mjs" <<'JS'
import fs from 'node:fs';
import readline from 'node:readline';
import { spawnSync } from 'node:child_process';
const gh = (args) => spawnSync('gh', args, { encoding: 'utf8' });
const v = gh(['--version']);
const t = gh(['auth', 'token']);
const e = process.env;
fs.appendFileSync(process.env.P1_PROBE_LOG, `${JSON.stringify({ gh: v.status === 0 ? 'on-PATH' : 'missing', ghLogin: t.status === 0 && t.stdout.trim() ? 'found' : 'missing', xdgData: !!e.XDG_DATA_HOME, xdgState: !!e.XDG_STATE_HOME, xdgConfig: !!e.XDG_CONFIG_HOME })}\n`);
const send = (m) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...m })}\n`);
readline.createInterface({ input: process.stdin }).on('line', (l) => {
  let m;
  try { m = JSON.parse(l); } catch { return; }
  if (m.method === 'initialize') send({ id: m.id, result: { protocolVersion: m.params?.protocolVersion ?? '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'p1probe', version: '0' } } });
  else if (m.method === 'tools/list') send({ id: m.id, result: { tools: [] } });
  else if (m.id !== undefined) send({ id: m.id, result: {} });
});
JS

# Mock LLM (read only: tests/fixtures/mock-llm.mjs): one bash tool call, then "done". Ephemeral port.
MOCK_LLM_PORT=0 MOCK_LLM_COMMAND='echo p1' MOCK_LLM_TOOL=bash node "$repo/tests/fixtures/mock-llm.mjs" >"$T/mock.log" 2>&1 &
MOCK_PID=$!
port=""
for _ in 1 2 3 4 5 6 7 8 9 10; do
  port="$(sed -n 's/^MOCK_LLM_PORT=//p' "$T/mock.log" | head -1)"; [ -n "$port" ] && break; sleep 1
done
[ -n "$port" ] || { echo "FAIL: mock LLM did not start"; exit 1; }

mkdir -p "$CFG"
cat > "$CFG/opencode.jsonc" <<JSON
{
  "\$schema": "https://opencode.ai/config.json",
  "model": "mock/mock-model",
  "autoupdate": false,
  "share": "disabled",
  "provider": { "mock": { "npm": "@ai-sdk/openai-compatible", "name": "Mock", "options": { "baseURL": "http://127.0.0.1:$port/v1" }, "models": { "mock-model": { "name": "Mock Model" } } } },
  "mcp": { "p1probe": { "type": "local", "command": ["node", "$(np "$T/p1probe.mjs")"] } }
}
JSON

# p1run <secs> <cmd...>: runs under the P1ENV assignments (a subshell, so nothing leaks into later cases).
P1ENV=()
p1run() { ( export "${P1ENV[@]}"; run_to "$@" ); }
# sessions <label>: number of sessions 1.19 lists for the P1ENV dirs (same cwd every time: the list is per project).
sessions() {
  p1run 90 "$B1" session list --format json >"$T/sl-$1.json" 2>"$T/sl-$1.err"
  node -e "try{const j=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'));console.log(Array.isArray(j)?j.length:'?')}catch{console.log('?')}" "$(np "$T/sl-$1.json")"
}
seed() { # seed <label>: one session through the mock LLM
  p1run 120 "$B1" run "p1 seed $1" --model mock/mock-model >"$T/run-$1.out" 2>&1; echo "  seed $1: exit $? ($(tail -n 1 "$T/run-$1.out" | cut -c1-60))"
}
ndiff() { node "$T/tree.mjs" diff x "$T/$1.json" "$T/$2.json" | head -1 | sed 's/^x: \([0-9]*\) differences$/\1/'; }
snap3() { snap "$1" data "$DATA" >/dev/null; snap "$1" state "$STATE" >/dev/null; snap "$1" config "$CFG" >/dev/null; }

cd "$T/proj" || exit 1
echo "-- live seed (default dirs, the way 1.19 runs today)"
P1ENV=(P1_PROBE_LOG="$(np "$T/probe-live.log")")
seed live
live_n="$(sessions live)"
snap3 L0
case "$live_n" in ''|*[!0-9]*|0) echo "FAIL: the live seed made no session (count: $live_n)"; exit 1 ;; esac
[ -s "$T/L0-data.json" ] && [ "$(wc -c < "$T/L0-data.json")" -gt 5 ] || { echo "FAIL: live data dir is empty"; exit 1; }
echo "P1 live: sessions=$live_n; MCP child: $(tail -n 1 "$T/probe-live.log" 2>/dev/null || echo 'did not run')"

# p1_case <name> <assert:yes|no>: copy live -> frozen root, run 1.19 under the env set, compare.
p1_case() {
  local name=$1 must=$2 root="$T/frozen-$1" ok=1
  mkdir -p "$root/data" "$root/state" "$root/config" "$root/db"
  case $name in
    a1) cp -R "$DATA" "$root/data/opencode"; cp -R "$STATE" "$root/state/opencode"; cp -R "$CFG" "$root/config/opencode"
        P1ENV=(XDG_DATA_HOME="$(np "$root/data")" XDG_STATE_HOME="$(np "$root/state")" XDG_CONFIG_HOME="$(np "$root/config")") ;;
    a2) cp -R "$DATA" "$root/data/opencode"; cp -R "$STATE" "$root/state/opencode"
        P1ENV=(XDG_DATA_HOME="$(np "$root/data")" XDG_STATE_HOME="$(np "$root/state")") ;;
    b)  cp "$DATA"/opencode.db* "$root/db/"; cp -R "$CFG" "$root/config/opencode"
        P1ENV=(OPENCODE_DB="$(np "$root/db/opencode.db")" OPENCODE_CONFIG_DIR="$(np "$root/config/opencode")") ;;
  esac
  P1ENV+=(P1_PROBE_LOG="$(np "$T/probe-$name.log")")
  local before after
  before="$(sessions "$name-before")"
  if [ "$name" = a1 ]; then echo "  1.x debug paths:"; p1run 60 "$B1" debug paths 2>&1 | sed "s|$(np "$root")|<frozen>|g; s|$HOME|~|g" | grep -iE 'data|state|config' | capn 6; fi
  seed "$name"
  after="$(sessions "$name-after")"
  snap3 "L-$name"
  local dd ds dc; dd="$(ndiff L0-data "L-$name-data")"; ds="$(ndiff L0-state "L-$name-state")"; dc="$(ndiff L0-config "L-$name-config")"
  echo "P1 $name: live changed files data=$dd state=$ds config=$dc | frozen sessions $before -> $after (live had $live_n) | MCP child: $(tail -n 1 "$T/probe-$name.log" 2>/dev/null || echo 'did not run')"
  [ "$dd" = 0 ] && [ "$ds" = 0 ] && [ "$dc" = 0 ] || { ok=0; echo "  live files that changed:"; for k in data state config; do snapdiff "  $k" L0-$k "L-$name-$k" | tail -n +2 | capn 5; done; }
  case "$before$after$live_n" in *[!0-9]*) ok=0 ;; *) [ "$before" = "$live_n" ] && [ "$after" = $((before + 1)) ] || ok=0 ;; esac
  if [ "$ok" = 1 ]; then echo "P1 $name: PASS (live untouched, the session landed in the frozen copy)"; else echo "P1 $name: not isolated"; [ "$must" = yes ] && fail=1; fi
}
p1_case a1 yes
p1_case a2 yes
p1_case b no

# a2 keeps the shared config dir, so an MCP child that needs gh must still see it there (n/a only when the runner has no gh).
if [ ! -s "$T/probe-a2.log" ]; then echo "P1 a2: the MCP child never ran"; fail=1
elif grep -q '"gh":"on-PATH"' "$T/probe-a2.log"; then
  grep -q '"ghLogin":"found"' "$T/probe-a2.log" || { echo "P1 a2: MCP child lost the gh login"; fail=1; }
else echo "P1 a2: gh not on PATH in the MCP child (n/a if the runner has no gh)"; fi

# --- does 2.x migrate the db on --version / debug config? (own XDG dirs, copy of the 1.x data) ---
echo "== P1: 2.x on a copy of the 1.x data"
v2="$T/frozen-v2"; mkdir -p "$v2/data" "$v2/state" "$v2/config"
cp -R "$DATA" "$v2/data/opencode"
P1ENV=(XDG_DATA_HOME="$(np "$v2/data")" XDG_STATE_HOME="$(np "$v2/state")" XDG_CONFIG_HOME="$(np "$v2/config")")
( export "${P1ENV[@]}"; "$B2" service set port $((20000 + RANDOM % 40000)) >/dev/null 2>&1 )
echo "  2.x debug paths (XDG honored?):"; p1run 60 "$B2" debug paths 2>&1 | sed "s|$(np "$v2")|<frozen>|g; s|$HOME|~|g" | grep -iE 'data|state|config' | capn 6
v2step() { # v2step <label> <args...>: run 2.x, then say whether the db file changed since the last step
  local label=$1; shift
  p1run 90 "$B2" "$@" >"$T/v2-$label.out" 2>&1; local rc=$?
  node "$T/tree.mjs" snap "v2 $label" "$v2/data" "$T/v2-$label.json" >/dev/null
  local changed; changed="$(node -e "const f=(n)=>JSON.parse(require('fs').readFileSync(process.argv[n],'utf8'))['opencode/opencode.db'];console.log(f(1)===f(2)?0:1)" "$(np "$T/v2-$prev.json")" "$(np "$T/v2-$label.json")")"
  echo "P1 2.x $label: exit $rc, db file changed since previous step: $([ "$changed" -gt 0 ] && echo YES || echo no)"; prev=$label
  node "$T/dbinfo.mjs" "$v2/data/opencode/opencode.db" "  db after $label" "$T/dbcopy-$label"
}
node "$T/tree.mjs" snap "v2 start" "$v2/data" "$T/v2-start.json" >/dev/null; prev=start
node "$T/dbinfo.mjs" "$v2/data/opencode/opencode.db" "  db before" "$T/dbcopy-before"
v2step version --version
v2step debug-config debug config
v2step session-list session list
( export "${P1ENV[@]}"; "$B2" service stop >/dev/null 2>&1 )

[ "$fail" -eq 0 ] && echo "SPIKE OK: both binaries ran --version, the XDG isolation proof held" || echo "FAIL: see the lines above (a --version, or an isolation check)"
exit "$fail"
