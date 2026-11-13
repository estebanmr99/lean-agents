#!/usr/bin/env bash
# Spike (#80 B0): OpenCode 1.19 and 2.2.5 side by side in one throwaway HOME. Prints labelled V1-V4 lines for the
# layout decision (shared vs isolated config/data); asserts only that both binaries run --version.
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
B1="" B2=""
cleanup() { [ -n "$B2" ] && "$B2" service stop >/dev/null 2>&1; rm -rf "$T"; }
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
cd "$repo"

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
echo '{ "$schema": "https://opencode.ai/tui.json", "theme": "opencode" }' > "$CFG/tui.json"
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

[ "$fail" -eq 0 ] && echo "SPIKE OK: both binaries ran --version" || echo "FAIL: a binary did not run --version"
exit "$fail"
