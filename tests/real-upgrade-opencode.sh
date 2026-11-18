#!/usr/bin/env bash
# Real OpenCode 1.19 + `--upgrade-agent opencode --backup` (#80 part 2, P3; steps 1-3 of plan section 5).
# Three sessions are seeded through the mock LLM (tests/fixtures/mock-llm.mjs, no login). Then: the dry run leaves the whole
# HOME tree hash unchanged; the apply makes a backup and a frozen copy whose sha256 equal the live files, whose session
# count (on a temp copy) is 3, and leaves everything outside ~/.local/share/lean-agents byte-identical; a second apply and a
# run while `opencode serve` is up are refused. Needs `opencode` 1.x on PATH and node:sqlite on this Node.
# Used by CI (ubuntu, windows via Git Bash); safe locally because HOME is a temp directory.
set -uo pipefail

repo="$(cd "$(dirname "$0")/.." && pwd)"
command -v opencode >/dev/null || { echo "opencode not on PATH" >&2; exit 1; }
HOME="$(mktemp -d)"
T="$(mktemp -d)"
is_win=0
if command -v cygpath >/dev/null 2>&1; then is_win=1; HOME="$(cygpath -m "$HOME")"; T="$(cygpath -m "$T")"; fi
mkdir -p "$T/proj"
export HOME
if [ "$is_win" = 1 ]; then USERPROFILE="$HOME"; export USERPROFILE; fi
unset XDG_CONFIG_HOME XDG_CACHE_HOME XDG_DATA_HOME XDG_STATE_HOME OPENCODE_CONFIG OPENCODE_CONFIG_DIR OPENCODE_DB
LIVE="$HOME/.local/share/opencode"
CFG="$HOME/.config/opencode"
LEAN="$HOME/.local/share/lean-agents"
MOCK_PID="" SERVE_PID=""
# shellcheck disable=SC2329 # run by the EXIT trap below
cleanup() {
  for p in $MOCK_PID $SERVE_PID; do kill "$p" 2>/dev/null; done
  # CI only: taskkill by image name would also hit a developer's own sessions.
  if [ "$is_win" = 1 ] && [ -n "${CI:-}" ]; then taskkill //F //T //IM opencode.exe >/dev/null 2>&1; sleep 1; fi
  rm -rf "$T" "$HOME" 2>/dev/null
}
trap cleanup EXIT

fail=0
check() { # check <label> <command...>
  local label=$1; shift
  if "$@"; then echo "ok    $label"; else echo "FAIL  $label"; fail=1; fi
}
# refute <label> <command...>: ok when the command fails.
refute() { local label=$1; shift; if "$@"; then echo "FAIL  $label"; fail=1; else echo "ok    $label"; fi; }

# h.mjs tree <dir> [skip-rel] | same <a> <b> data|all | count <dir>: sha256 helpers, short output.
cat > "$T/h.mjs" <<'JS'
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
const [mode, a, b, c] = process.argv.slice(2);
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const files = (dir, skip) => {
  const out = {};
  const walk = (r) => {
    for (const e of fs.readdirSync(path.join(dir, r), { withFileTypes: true })) {
      const x = r ? `${r}/${e.name}` : e.name;
      if (skip && x === skip) continue;
      if (e.isDirectory()) walk(x); else if (e.isFile()) out[x] = sha(path.join(dir, x));
    }
  };
  walk('');
  return out;
};
if (mode === 'tree') {
  console.log(crypto.createHash('sha256').update(JSON.stringify(Object.entries(files(a, b)).sort())).digest('hex'));
} else if (mode === 'same') {
  const keep = (m) => Object.fromEntries(Object.entries(m).filter(([k]) => c === 'all' || /^(opencode\.db(-wal|-shm)?$|storage\/|snapshot\/)/.test(k)));
  const x = keep(files(a)), y = keep(files(b));
  const same = Object.keys(x).length > 0 && JSON.stringify(Object.entries(x).sort()) === JSON.stringify(Object.entries(y).sort());
  if (!same) console.log(`differs: ${Object.keys(x).length} vs ${Object.keys(y).length} files`);
  process.exit(same ? 0 : 1);
} else {
  const { DatabaseSync } = await import('node:sqlite');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'h-count-'));
  for (const ext of ['', '-wal', '-shm']) if (fs.existsSync(path.join(a, `opencode.db${ext}`))) fs.copyFileSync(path.join(a, `opencode.db${ext}`), path.join(tmp, `opencode.db${ext}`));
  const db = new DatabaseSync(path.join(tmp, 'opencode.db'), { readOnly: true });
  console.log(db.prepare('SELECT count(*) AS n FROM session').get().n);
  db.close();
  fs.rmSync(tmp, { recursive: true, force: true });
}
JS
tree() { node "$T/h.mjs" tree "$HOME" ".local/share/lean-agents"; }
count() { node "$T/h.mjs" count "$1" 2>/dev/null; }
lean() { node "$repo/scripts/lean.mjs" --home "$HOME" --no-exec --upgrade-agent opencode --backup "$@"; }
# run_to <secs> <cmd...>: no timeout binary on every runner, so poll in the background.
run_to() {
  local secs=$1; shift
  "$@" & local pid=$!
  local i=0
  while kill -0 "$pid" 2>/dev/null && [ "$i" -lt "$secs" ]; do sleep 1; i=$((i + 1)); done
  if kill -0 "$pid" 2>/dev/null; then kill "$pid" 2>/dev/null; echo "  (killed after ${secs}s)"; return 124; fi
  wait "$pid"
}
oc_procs() {
  if [ "$is_win" = 1 ]; then tasklist //FO CSV //NH 2>/dev/null | grep -ci '"opencode.exe"'; else ps -A -o comm= | grep -c '^opencode$'; fi
}
wait_procs() { # wait_procs <0|1>: 0 = none left, 1 = at least one, up to 20 s
  local i=0 n
  while [ "$i" -lt 20 ]; do
    n="$(oc_procs)"
    if [ "$1" = 0 ] && [ "${n:-0}" = 0 ]; then return 0; fi
    if [ "$1" = 1 ] && [ "${n:-0}" != 0 ]; then return 0; fi
    sleep 1; i=$((i + 1))
  done
  return 1
}

echo "== setup: $(uname -s), node $(node -v), opencode $(opencode --version 2>/dev/null | tail -n 1)"
MOCK_LLM_PORT=0 MOCK_LLM_COMMAND='echo seed' MOCK_LLM_TOOL=bash node "$repo/tests/fixtures/mock-llm.mjs" >"$T/mock.log" 2>&1 &
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
  "provider": { "mock": { "npm": "@ai-sdk/openai-compatible", "name": "Mock", "options": { "baseURL": "http://127.0.0.1:$port/v1" }, "models": { "mock-model": { "name": "Mock Model" } } } }
}
JSON

echo "== seed 3 sessions on real 1.19"
cd "$T/proj" || exit 1
for i in 1 2 3; do
  run_to 120 opencode run "seed $i" --model mock/mock-model >"$T/run-$i.out" 2>&1; echo "  seed $i: exit $? ($(tail -n 1 "$T/run-$i.out" | cut -c1-60))"
done
cd "$repo" || exit 1
wait_procs 0 || { echo "FAIL: an opencode process is still running after the seeds"; exit 1; }
n0="$(count "$LIVE")"
echo "live sessions: ${n0:-?}"
[ "$n0" = 3 ] || { echo "FAIL: expected 3 live sessions"; exit 1; }
live_tree="$(tree)"
cfg_tree="$(node "$T/h.mjs" tree "$CFG")"

echo "== dry run changes nothing"
lean --dry-run >"$T/dry.out" 2>&1; rc=$?
sed 's/^/  /' "$T/dry.out"
check "dry run exits 0" test "$rc" = 0
check "dry run names 3 sessions" grep -q '3 sessions' "$T/dry.out"
check "whole HOME tree hash unchanged by the dry run" test "$(tree)" = "$live_tree"
check "no lean-agents folder after the dry run" test ! -e "$LEAN"

echo "== apply: permanent backup + frozen copy"
lean --yes >"$T/apply.out" 2>&1; rc=$?
sed 's/^/  /' "$T/apply.out"
check "apply exits 0" test "$rc" = 0
bk=""
for d in "$LEAN"/backups/opencode1-sessions-*; do [ -d "$d" ] && bk="$d"; done
frozen="$LEAN/opencode1/data/opencode"
check "backup folder exists" test -d "$bk"
check "RESTORE.md and MANIFEST.sha256 written" test -s "$bk/RESTORE.md" -a -s "$bk/MANIFEST.sha256"
check "backup data sha256 = live data" node "$T/h.mjs" same "$LIVE" "$bk/data" data
check "backup config sha256 = live config" node "$T/h.mjs" same "$CFG" "$bk/config" all
check "frozen copy sha256 = live data" node "$T/h.mjs" same "$LIVE" "$frozen" data
check "backup has 3 sessions (temp copy)" test "$(count "$bk/data")" = 3
check "frozen copy has 3 sessions (temp copy)" test "$(count "$frozen")" = 3
check "everything outside lean-agents byte-identical (live data, config, state)" test "$(tree)" = "$live_tree"
check "live config untouched" test "$(node "$T/h.mjs" tree "$CFG")" = "$cfg_tree"
if [ "$is_win" = 0 ]; then check "backup folder is 0700" test "$(stat -c %a "$bk" 2>/dev/null || stat -f %Lp "$bk")" = 700; fi
refute "a second apply is refused (frozen copy exists)" lean --yes

echo "== refused while an opencode process runs"
opencode serve --port $((20000 + RANDOM % 40000)) --hostname 127.0.0.1 >"$T/serve.log" 2>&1 &
SERVE_PID=$!
if wait_procs 1; then
  lean --dry-run >"$T/run.out" 2>&1; rc=$?
  check "exit 1 while opencode serve runs" test "$rc" = 1
  check "names the running process" grep -q 'process is running' "$T/run.out"
else
  echo "FAIL  opencode serve did not start"; tail -n 5 "$T/serve.log"; fail=1
fi

if [ "$fail" -ne 0 ]; then echo "FAILED"; exit 1; fi
echo "real-upgrade-opencode OK"
