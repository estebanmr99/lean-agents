#!/usr/bin/env bash
# Real OpenCode 1.19 + `--upgrade-agent opencode --backup` (#80 part 2, P3; steps 1-3 of plan section 5) and `--opencode1` (P4).
# Three sessions are seeded through the mock LLM (tests/fixtures/mock-llm.mjs, no login). Then: the dry run leaves the whole
# HOME tree hash unchanged; the apply makes a backup and a frozen copy whose sha256 equal the live files, whose session
# count (on a temp copy) is 3, and leaves everything outside ~/.local/share/lean-agents byte-identical; a second apply and a
# run while `opencode serve` is up are refused. Then `--opencode1`: the binary copy and the shim report 1.19.0, a new session made
# through `opencode1` lands in the frozen copy (3 -> 4) while the live data hash stays equal, and `--uninstall` removes the shim,
# the copy and the PATH entry but keeps the backup and the frozen copy. Then apply and `--undo` (P6): an apply without a backup stamp is
# refused; on Linux the full apply (the pinned 2.x installer, config translation, DCP) and `--undo` give the 1.x state back (a 2.x
# start in between migrates the db; it is moved aside, never deleted), and one injected failure per step (LEAN_TEST_FAIL_AT, test
# guard LEAN_AGENTS_TEST=1) rolls back to a byte-identical live tree; on Windows the 2.x install is manual (VERIFY), so the apply
# fails at that step and rolls back. Needs `opencode` 1.x on PATH and node:sqlite on this Node.
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
// paths <p>...: one hash over every file under the given files or folders (a missing one counts as absent), for the live-tree checks.
if (mode === 'paths') {
  const lines = [];
  for (const p of process.argv.slice(3)) {
    if (!fs.existsSync(p)) { lines.push(`${p}:absent`); continue; }
    if (fs.statSync(p).isFile()) { lines.push(`${p}:${sha(p)}`); continue; }
    for (const [k, v] of Object.entries(files(p))) lines.push(`${p}/${k}:${v}`);
  }
  console.log(crypto.createHash('sha256').update(lines.sort().join('\n')).digest('hex'));
} else if (mode === 'sha') {
  console.log(sha(a));
} else if (mode === 'tree') {
  console.log(crypto.createHash('sha256').update(JSON.stringify(Object.entries(files(a, b)).sort())).digest('hex'));
} else if (mode === 'same') {
  const keep = (m) => Object.fromEntries(Object.entries(m).filter(([k]) => (c === 'all' && !/(^|\/)node_modules\//.test(k)) || /^(opencode\.db(-wal|-shm)?$|storage\/|snapshot\/)/.test(k)));
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
# The live tree the upgrade must give back: config, the 2.x installer's folder and the rc files that get the opencode1 PATH block.
ltree() { node "$T/h.mjs" paths "$CFG" "$HOME/.opencode" "$HOME/.profile" "$HOME/.bashrc" "$HOME/.zshrc" "$HOME/.bash_profile"; }
dtree() { node "$T/h.mjs" tree "$LIVE"; }
shaf() { node "$T/h.mjs" sha "$1"; }
# --version of an opencode binary on throwaway XDG dirs (2.x migrates a db it finds; --version itself does not, but stay clear).
# Both streams: a 2.x binary may print its version on stderr; the first x.y.z found is the version.
ver() { XDG_DATA_HOME="$T/scratch" XDG_STATE_HOME="$T/scratch" XDG_CACHE_HOME="$T/scratch" XDG_CONFIG_HOME="$T/scratch" "$1" --version 2>&1 | grep -Eo '[0-9]+\.[0-9]+\.[0-9]+' | head -n 1; }
# The upgrade command (apply; or --undo with --undo --yes); lean_fail runs it with the test guard and a failure after one step.
leanu() { node "$repo/scripts/lean.mjs" --home "$HOME" --upgrade-agent opencode "$@"; }
lean_fail() { env LEAN_AGENTS_TEST=1 LEAN_TEST_FAIL_AT="$1" node "$repo/scripts/lean.mjs" --home "$HOME" --upgrade-agent opencode --yes; }
jstatus() { node -e "try{console.log(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).upgrade?.status??'none')}catch{console.log('none')}" "$HOME/.config/lean-agents/state.json"; }
count() { node "$T/h.mjs" count "$1" 2>/dev/null; }
lean1() { node "$repo/scripts/lean.mjs" --home "$HOME" --upgrade-agent opencode --opencode1 "$@"; }
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
  if [ "$is_win" = 1 ]; then tasklist //FO CSV //NH 2>/dev/null | grep -ci '"opencode.exe"'; else pgrep -x opencode | wc -l | tr -d ' '; fi
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

echo "== upgrade apply without a backup stamp is refused (P6)"
pre_ns="$(tree)"
leanu --yes >"$T/nostamp.out" 2>&1; rc=$?
sed 's/^/  /' "$T/nostamp.out"
check "apply without a stamp exits 1" test "$rc" = 1
check "it names the missing stamp" grep -q 'no verified session backup' "$T/nostamp.out"
check "whole HOME tree unchanged by the refused apply" test "$(tree)" = "$pre_ns"
check "no lean-agents folder after the refused apply" test ! -e "$LEAN"

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

echo "== opencode1: binary copy + shim + PATH (P4)"
OC1="$LEAN/opencode1"
bin1="opencode"; [ "$is_win" = 1 ] && bin1="opencode.exe"
live_data_tree="$(node "$T/h.mjs" tree "$LIVE")"
pre1="$(tree)"
lean1 --dry-run >"$T/oc1-dry.out" 2>&1; rc=$?
sed 's/^/  /' "$T/oc1-dry.out"
check "opencode1 dry run exits 0" test "$rc" = 0
check "opencode1 dry run names 1.19.0" grep -q 'OpenCode 1\.19\.0' "$T/oc1-dry.out"
check "opencode1 dry run leaves the HOME tree unchanged" test "$(tree)" = "$pre1"
check "no binary copy after the dry run" test ! -e "$OC1/1.19.0"
lean1 --yes >"$T/oc1.out" 2>&1; rc=$?
sed 's/^/  /' "$T/oc1.out"
check "opencode1 apply exits 0" test "$rc" = 0
check "binary copied to opencode1/1.19.0" test -s "$OC1/1.19.0/$bin1"
check "shim written" test -s "$OC1/bin/opencode1"
if [ "$is_win" = 1 ]; then check "opencode1.cmd written" test -s "$OC1/bin/opencode1.cmd"; else check "PATH block in a shell rc file" grep -rq 'lean-agents:start' "$HOME/.profile" "$HOME/.bashrc" "$HOME/.zshrc" "$HOME/.bash_profile" 2>/dev/null; fi
binp="$OC1/bin"; if [ "$is_win" = 1 ]; then binp="$(cygpath -u "$binp")"; fi
check "opencode1 --version = 1.19.0 (shim by path)" test "$("$OC1/bin/opencode1" --version 2>/dev/null | tail -n 1)" = "1.19.0"
check "opencode1 --version = 1.19.0 (found on PATH)" test "$(PATH="$binp:$PATH" opencode1 --version 2>/dev/null | tail -n 1)" = "1.19.0"
if [ "$is_win" = 1 ]; then
  check "opencode1.cmd --version = 1.19.0 from cmd" test "$(PATH="$binp:$PATH" cmd //c "opencode1.cmd --version" 2>/dev/null | tr -d '\r' | tail -n 1)" = "1.19.0"
fi
check "frozen copy still has 3 sessions" test "$(count "$frozen")" = 3
PATH="$binp:$PATH" opencode1 session list >"$T/oc1-list.out" 2>&1; rc=$?
sed 's/^/  /' "$T/oc1-list.out"
check "opencode1 session list works (reads its own 1.x config and the frozen copy)" test "$rc" = 0
check "opencode1 has its own config copy (XDG_CONFIG_HOME under opencode1)" test -d "$OC1/config/opencode"
cd "$T/proj" || exit 1
run_to 120 env PATH="$binp:$PATH" opencode1 run "from opencode1" --model mock/mock-model >"$T/oc1-run.out" 2>&1; echo "  opencode1 run: exit $? ($(tail -n 1 "$T/oc1-run.out" | cut -c1-60))"
cd "$repo" || exit 1
wait_procs 0 || echo "  (an opencode process is still running)"
check "the new 1.x session landed in the frozen copy (3 -> 4)" test "$(count "$frozen")" = 4
check "live data hash unchanged by opencode1" test "$(node "$T/h.mjs" tree "$LIVE")" = "$live_data_tree"
check "live data still 3 sessions" test "$(count "$LIVE")" = 3
node "$repo/scripts/lean.mjs" --home "$HOME" --no-exec --uninstall --yes >"$T/oc1-un.out" 2>&1; rc=$?
sed 's/^/  /' "$T/oc1-un.out"
check "uninstall exits 0" test "$rc" = 0
check "binary copy removed" test ! -e "$OC1/1.19.0"
check "shim folder removed" test ! -e "$OC1/bin"
if [ "$is_win" = 0 ]; then refute "PATH block removed from the rc files" grep -rq 'lean-agents:start' "$HOME/.profile" "$HOME/.bashrc" "$HOME/.zshrc" "$HOME/.bash_profile" 2>/dev/null; fi
check "frozen copy kept (4 sessions)" test "$(count "$frozen")" = 4
check "backup kept" test -s "$bk/MANIFEST.sha256"
check "live data hash still unchanged" test "$(node "$T/h.mjs" tree "$LIVE")" = "$live_data_tree"

echo "== upgrade apply, injected failures and --undo (P6)"
ocbin="$HOME/.opencode/bin/opencode"
[ "$is_win" = 1 ] && ocbin="$HOME/.opencode/bin/opencode.exe"
mkdir -p "$T/scratch"
# kill_oc: lean-agents only refuses while an opencode runs (it never kills what it did not start); the test stops what it started.
kill_oc() {
  wait_procs 0 && return 0
  if [ -n "${CI:-}" ]; then
    if [ "$is_win" = 1 ]; then taskkill //F //T //IM opencode.exe >/dev/null 2>&1; else pkill -x opencode 2>/dev/null; fi
    wait_procs 0 && return 0
  fi
  return 1
}
# first_dir <glob...>: the first folder the glob matched (a no-match stays a literal and is not a folder).
first_dir() { local d; for d in "$@"; do if [ -d "$d" ]; then echo "$d"; return 0; fi; done; return 1; }
LIVE_STATE="$(ltree)"
LIVE_DATA="$(dtree)"
# round <step>: the apply fails right after <step>, which is undone with every step before it.
round() {
  local step=$1
  lean_fail "$step" >"$T/inj-$step.out" 2>&1; rc=$?
  tail -n 12 "$T/inj-$step.out" | sed 's/^/  /'
  check "failure after $step: exit 1" test "$rc" = 1
  check "failure after $step: the journal says rolled-back" test "$(jstatus)" = rolled-back
  check "failure after $step: config, rc files and ~/.opencode byte-identical" test "$(ltree)" = "$LIVE_STATE"
  check "failure after $step: live data byte-identical" test "$(dtree)" = "$LIVE_DATA"
  check "failure after $step: no shim folder left" test ! -e "$OC1/bin"
  check "failure after $step: backup and frozen copy kept" test -s "$bk/MANIFEST.sha256" -a -s "$frozen/opencode.db"
  check "failure after $step: a 1.x opencode still runs" test "$(opencode --version 2>/dev/null | tail -n 1)" = "1.19.0"
}
# LEAN_TEST_FAIL_AT without the guard is refused before anything runs.
env LEAN_TEST_FAIL_AT=config node "$repo/scripts/lean.mjs" --home "$HOME" --upgrade-agent opencode --yes >"$T/guard.out" 2>&1; rc=$?
check "LEAN_TEST_FAIL_AT without LEAN_AGENTS_TEST=1 is refused" test "$rc" = 1
check "and the live tree is unchanged" test "$(ltree)" = "$LIVE_STATE"

if [ "$is_win" = 1 ]; then
  # The 2.x install on Windows is not automated (VERIFY): the apply stops at that step and undoes what it did before.
  for step in backup opencode1; do round "$step"; done
  leanu --yes >"$T/win-apply.out" 2>&1; rc=$?
  tail -n 12 "$T/win-apply.out" | sed 's/^/  /'
  check "windows apply: stops at install2x (exit 1)" test "$rc" = 1
  check "windows apply: names the manual 2.x install" grep -q 'not proven yet' "$T/win-apply.out"
  check "windows apply: rolled back, live tree byte-identical" test "$(jstatus)" = rolled-back -a "$(ltree)" = "$LIVE_STATE" -a "$(dtree)" = "$LIVE_DATA"
else
  for step in backup opencode1 install2x config dcp; do round "$step"; done

  echo "-- full apply (1.x on PATH, 2.x from the pinned installer)"
  leanu --yes >"$T/up.out" 2>&1; rc=$?
  tail -n 25 "$T/up.out" | sed 's/^/  /'
  check "apply exits 0" test "$rc" = 0
  check "journal says applied" test "$(jstatus)" = applied
  check "the 2.x binary reports 2.x" test "$(ver "$ocbin" | cut -d. -f1)" = 2
  check "opencode1 still reports 1.19.0" test "$(ver "$OC1/bin/opencode1")" = "1.19.0"
  check "DCP is in the 2.x config" grep -q 'opencode-dcp' "$CFG/opencode.jsonc"
  check "dcp.jsonc written" test -s "$CFG/dcp.jsonc"
  check "the mock provider (a user key) is kept" grep -q '"mock"' "$CFG/opencode.jsonc"
  check "apply never touched the live data" test "$(dtree)" = "$LIVE_DATA"
  refute "a second apply is refused (already applied)" leanu --yes
  # opencode1 runs on its own 1.x config copy: the 2.x keys the apply wrote must not reach it.
  "$OC1/bin/opencode1" session list >"$T/oc1-after.out" 2>&1; rc=$?
  sed 's/^/  /' "$T/oc1-after.out"
  check "after apply: opencode1 session list still works" test "$rc" = 0
  "$OC1/bin/opencode1" debug config >"$T/oc1-cfg.out" 2>&1; rc=$?
  check "after apply: opencode1 debug config exits 0" test "$rc" = 0
  check "after apply: opencode1 sees the 1.x config (the user's mock provider)" grep -q '"mock"' "$T/oc1-cfg.out"
  refute "after apply: opencode1 does not see the 2.x config (no DCP)" grep -q 'opencode-dcp' "$T/oc1-cfg.out"
  # --uninstall is not blocked by an applied upgrade: it warns that 2.x stays. Dry run here: the --undo below needs the journal.
  node "$repo/scripts/lean.mjs" --home "$HOME" --no-exec --uninstall --dry-run --yes >"$T/un-applied.out" 2>&1; rc=$?
  check "--uninstall --dry-run is allowed while the upgrade is applied (exit 0)" test "$rc" = 0
  check "and it warns that the 2.x upgrade stays" grep -q 'OpenCode 2 upgrade stays' "$T/un-applied.out"
  check "and the journal still says applied" test "$(jstatus)" = applied

  echo "-- the first 2.x start migrates the live db; opencode must be closed before --undo"
  # An empty config folder: 2.x must not install DCP into the real one; the data folder is the live one, which is the point.
  run_to 120 env XDG_CONFIG_HOME="$T/cfg2x" "$ocbin" session list >"$T/2x-list.out" 2>&1; echo "  2.x session list: exit $? ($(tail -n 1 "$T/2x-list.out" | cut -c1-60))"
  check "the 2.x start changed the live db (migration)" test "$(dtree)" != "$LIVE_DATA"
  if wait_procs 1; then
    leanu --undo --yes >"$T/undo-busy.out" 2>&1; rc=$?
    check "--undo refuses while an opencode process runs" test "$rc" = 1 -a "$(jstatus)" = applied
    kill_oc || echo "  (an opencode process is still running)"
  else
    check "a 2.x background process appeared after the first start (needed for the --undo refusal check)" false
    kill_oc || true
  fi
  leanu --undo --yes >"$T/undo.out" 2>&1; rc=$?
  tail -n 25 "$T/undo.out" | sed 's/^/  /'
  check "--undo exits 0" test "$rc" = 0
  check "journal says undone" test "$(jstatus)" = undone
  check "no 2.x binary left" test ! -e "$ocbin"
  check "opencode --version = 1.19.0" test "$(opencode --version 2>/dev/null | tail -n 1)" = "1.19.0"
  check "live data is the frozen copy again: backup 3 + 1 made by opencode1 = 4 sessions" test "$(count "$LIVE")" = 4
  check "live data sha256 = frozen copy" node "$T/h.mjs" same "$LIVE" "$frozen" data
  check "the 2.x db was moved aside, not deleted" test -s "$(first_dir "$LEAN"/backups/opencode2-db-*)/opencode.db"
  check "config restored (sha256 = the 1.x snapshot in the backup)" node "$T/h.mjs" same "$CFG" "$bk/config" all
  check "no shim folder, backup and frozen copy kept" test ! -e "$OC1/bin" -a -s "$bk/MANIFEST.sha256" -a "$(count "$frozen")" = 4
  check "the backup still has 3 sessions" test "$(count "$bk/data")" = 3
  check "a second --undo has nothing to do (exit 0)" leanu --undo --yes

  echo "-- full apply with the 1.x binary in ~/.opencode/bin (the installer overwrites it), then --undo"
  src1x="$(node --input-type=module -e "import { candidates } from '$repo/scripts/lib/opencode1.mjs'; console.log(candidates({ home: process.argv[1], whichPath: process.argv[2] })[0] ?? '')" "$HOME" "$(command -v opencode)")"
  mkdir -p "$HOME/.opencode/bin"
  cp "$src1x" "$ocbin" && chmod 755 "$ocbin"
  check "the copy in ~/.opencode/bin reports 1.19.0" test "$(ver "$ocbin")" = "1.19.0"
  sha_1x="$(shaf "$ocbin")"
  leanu --yes >"$T/up2.out" 2>&1; rc=$?
  tail -n 25 "$T/up2.out" | sed 's/^/  /'
  check "apply exits 0" test "$rc" = 0
  check "the binary in ~/.opencode/bin is 2.x now" test "$(ver "$ocbin" | cut -d. -f1)" = 2
  leanu --undo --yes >"$T/undo2.out" 2>&1; rc=$?
  tail -n 25 "$T/undo2.out" | sed 's/^/  /'
  check "--undo exits 0" test "$rc" = 0
  check "the 1.x binary is back at ~/.opencode/bin (sha256 equal)" test "$(shaf "$ocbin")" = "$sha_1x"
  check "the 2.x binary was moved aside" test -s "$(first_dir "$LEAN"/backups/opencode2-bin-*)/opencode"
  check "live data is the frozen copy again (4 sessions)" test "$(count "$LIVE")" = 4
  check "config restored again" node "$T/h.mjs" same "$CFG" "$bk/config" all
  rm -f "$ocbin"; rmdir "$HOME/.opencode/bin" "$HOME/.opencode" 2>/dev/null
fi

echo "== refused while an opencode process runs"
opencode serve --port $((20000 + RANDOM % 40000)) --hostname 127.0.0.1 >"$T/serve.log" 2>&1 &
SERVE_PID=$!
if wait_procs 1; then
  lean --dry-run >"$T/run.out" 2>&1; rc=$?
  check "dry run: exit 0 while opencode serve runs (#270)" test "$rc" = 0
  check "dry run: still prints the size and free-space lines" grep -q 'free space:' "$T/run.out"
  check "dry run: names the running process as a blocker" grep -q 'blocker for apply:.*process is running' "$T/run.out"
  lean --yes >"$T/run-yes.out" 2>&1; rc=$?
  check "apply: exit 1 while opencode serve runs" test "$rc" = 1
  check "apply: refused and names the running process" grep -q 'process is running' "$T/run-yes.out"
else
  echo "FAIL  opencode serve did not start"; tail -n 5 "$T/serve.log"; fail=1
fi

if [ "$fail" -ne 0 ]; then echo "FAILED"; exit 1; fi
echo "real-upgrade-opencode OK"
