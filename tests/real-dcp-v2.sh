#!/usr/bin/env bash
# DCP on OpenCode 2.x (#80 part 2, P2): does the pinned DCP load there and prune a long session?
# Real `opencode` 2.x on PATH and a throwaway HOME. A mock LLM (tests/fixtures/mock-llm.mjs) reports 250K prompt
# tokens per turn, so DCP (thresholds 200K/220K, model limit 300K) sees the context over its max limit, and the mock
# answers DCP's `compress` tool call. Proves the mechanism, not token savings with a real model.
# Checks: GET /api/command lists dcp-compress (the 1.x health check from #212; the 2.x route is /api/command, behind the server password), then one compression shows in the DCP debug log.
set -euo pipefail

repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOME="$(mktemp -d)"
# Native Windows binaries need a drive path, not the MSYS /tmp one.
is_win=0
if command -v cygpath >/dev/null 2>&1; then is_win=1; HOME="$(cygpath -m "$HOME")"; fi
export HOME USERPROFILE="$HOME" XDG_CONFIG_HOME="$HOME/.config"
T="$HOME"
CFG="$HOME/.config/opencode"
mkdir -p "$CFG"

pids=""
# shellcheck disable=SC2329 # run by the EXIT trap below
cleanup() {
  for p in $pids; do kill "$p" 2>/dev/null || true; done
  # Windows CI: kill only reaches the MSYS pid, so end opencode and its children before removing a HOME they may hold open.
  # CI only: taskkill by image name would also hit a developer's own sessions.
  if [ "$is_win" = "1" ] && [ -n "${CI:-}" ]; then taskkill //F //T //IM opencode.exe >/dev/null 2>&1 || true; sleep 1; fi
  rm -rf "$T" 2>/dev/null || true
}
trap cleanup EXIT

fail=0
ok() { echo "ok    $*"; }
bad() { echo "FAIL  $*"; fail=1; }

# GET with the server password; prints the command names from `{"data":[{"name":...}]}`.
command_names() {
  node -e "
const auth = 'Basic ' + Buffer.from('opencode:' + process.env.OPENCODE_SERVER_PASSWORD).toString('base64');
fetch(process.argv[1], { headers: { authorization: auth } })
  .then((r) => r.json()).then((j) => console.log((j.data ?? []).map((c) => c.name).join(' ')))
  .catch(() => {});" "$1"
}

free_port() { node -e "require('net').createServer().listen(0,'127.0.0.1',function(){console.log(this.address().port);this.close()})"; }

dcp_spec="$(cd "$repo" && node -e "import('./scripts/lib/pins.mjs').then((m) => console.log(m.npmSpec('opencode-dcp')))")" || { echo "FAIL  cannot read the DCP pin"; exit 1; }
echo "opencode: $(opencode --version)  dcp: $dcp_spec"

# Mock LLM: ephemeral port, printed on its first stdout line.
MOCK_LLM_PORT=0 MOCK_LLM_PROMPT_TOKENS=250000 MOCK_LLM_COMPRESS=1 MOCK_LLM_DEBUG=1 \
  node "$repo/tests/fixtures/mock-llm.mjs" >"$T/mock.out" 2>"$T/mock.err" &
pids="$pids $!"
mock_port=""
for _ in $(seq 1 50); do
  mock_port="$(sed -n 's/^MOCK_LLM_PORT=//p' "$T/mock.out" | head -n 1)"
  [ -n "$mock_port" ] && break
  sleep 0.2
done
[ -n "$mock_port" ] || { echo "FAIL  mock LLM did not start"; exit 1; }

cat >"$CFG/opencode.jsonc" <<JSON
{
  "model": "mock/mock-model",
  "plugins": ["$dcp_spec"],
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
cat >"$CFG/dcp.jsonc" <<JSON
{
  "debug": true,
  "compress": { "minContextLimit": 200000, "maxContextLimit": 220000 }
}
JSON

port="$(free_port)"
mkdir -p "$T/work"
export OPENCODE_SERVER_PASSWORD="dcp-test-$$"
(cd "$T/work" && exec opencode serve --hostname 127.0.0.1 --port "$port" >"$T/serve.out" 2>&1) &
pids="$pids $!"
url="http://127.0.0.1:$port"

# DCP installs through the plugin loader on first start (about a minute), so poll.
commands=""
for _ in $(seq 1 120); do
  commands="$(command_names "$url/api/command")"
  case "$commands" in *dcp-compress*) break ;; esac
  sleep 2
done
case "$commands" in
  *dcp-compress*) ok "GET /api/command lists dcp-compress" ;;
  *) bad "GET /api/command has no dcp-compress: $commands"; tail -n 20 "$T/serve.out"; exit 1 ;;
esac

# #495: doctor's DCP row must find the copy this OpenCode just cached (2.2.7: <cache>/npm/<pkg>@<spec>/<id>/node_modules).
dcp_row="$(cd "$repo" && node --input-type=module -e "import('./scripts/lib/plugin-health.mjs').then((m) => { const r = m.dcpRow(process.argv[1]); console.log(r.status + ' ' + r.detail); })" "$HOME")" || dcp_row="crashed: the dcpRow call failed"
want="${dcp_spec##*@}"
case "$dcp_row" in
  "ok "*"resolved: $want ;"*) ok "doctor DCP row: $dcp_row" ;;
  *) bad "doctor DCP row is not ok with resolved $want: $dcp_row"; find "$HOME/.cache/opencode" -maxdepth 5 -type d -name '*opencode-dcp*' ;;
esac

# A turn that does not finish in 2 minutes is a failure, not a hang.
run_turn() { # run_turn <name> <opencode run flags and message...>
  local name="$1" i=0; shift
  (cd "$T/work" && exec opencode run --server "$url" --format json "$@" >"$T/$name.out" 2>&1) &
  local pid=$!
  while kill -0 "$pid" 2>/dev/null && [ "$i" -lt 120 ]; do sleep 1; i=$((i + 1)); done
  if kill -0 "$pid" 2>/dev/null; then kill "$pid" 2>/dev/null || true; bad "$name timed out: $(tail -n 5 "$T/$name.out")"; return 0; fi
  wait "$pid" || bad "$name failed: $(tail -n 5 "$T/$name.out")"
}

# Turn 1 puts 250K tokens in the session; turn 2 is the first request DCP sees over its max limit.
run_turn turn1 'first turn'
run_turn turn2 --continue 'second turn'

log_dir="$CFG/logs/dcp/daily"
dcp_log() { cat "$log_dir"/*.log 2>/dev/null || true; }
echo "--- DCP debug log ---"
dcp_log | cut -c1-220 | tail -n 40
echo "--- mock tools seen ---"
grep '^tools:' "$T/mock.err" | sort | uniq -c || true

# The mock compresses only after DCP's max-limit nudge reached it, so one "Compression #1" and no "#2" means DCP
# reached its max-limit nudge (no below-threshold control run) and pruned once.
n1="$(dcp_log | grep -c 'Compression #1' || true)"
n2="$(dcp_log | grep -c 'Compression #2' || true)"
# DCP may print the token more than once; what matters is at least one compression and never a second.
if [ "$n1" -ge 1 ] && [ "$n2" = "0" ]; then ok "compression in the DCP debug log, no second one"; else bad "expected compression #1 and no #2 in the DCP debug log, found #1 x$n1, #2 x$n2"; fi
# Windows interleaves the log writer, so the start of that line can be cut: there summaryLength= is its tail,
# accepted only on a line after a "Compression #1" line.
if [ "$is_win" = "1" ]; then
  if dcp_log | awk '/Compression #1/ { seen = 1; next } seen && /summaryLength=[0-9]+/ { found = 1 } END { exit !found }'; then ok "compress summary injected back into the context"; else bad "no injected compress summary after Compression #1 in the DCP debug log"; fi
elif dcp_log | grep -q 'Injected compress summary'; then ok "compress summary injected back into the context"; else bad "no injected compress summary in the DCP debug log"; fi

exit "$fail"
