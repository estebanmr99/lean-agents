#!/usr/bin/env bash
# Spike (#428 items 1-3): what the real OpenCode 2 binary does for a coordinator that starts workers headless.
# Prints one labelled line per case (help surface, exit codes, event types) for docs/compatibility.md.
# No login, no paid model: a local mock LLM (tests/fixtures/mock-llm.mjs) and a 403 stub stand in for the provider.
# Asserts only that the binary runs and the mock-backed session succeeds; every other line is evidence, not a gate.
# Safe locally: HOME is a temp directory.
set -uo pipefail

repo="$(cd "$(dirname "$0")/.." && pwd)"
T="$(mktemp -d)"
HOME="$T/home"
export HOME
mkdir -p "$HOME" "$T/proj"
export OPENCODE_DISABLE_AUTOUPDATE=1
fail=0
MOCK_PID="" DENY_PID=""
# The OpenCode service is found by port, not by HOME, so only CI stops it (a local run could stop the owner's own service).
# shellcheck disable=SC2329 # called through the trap
cleanup() {
  kill "$MOCK_PID" "$DENY_PID" 2>/dev/null
  if [ -n "${GITHUB_ACTIONS:-}" ]; then opencode service stop >/dev/null 2>&1; fi
  rm -rf "$T"
}
trap cleanup EXIT

run_to() {
  local secs=$1; shift
  "$@" & local pid=$!
  local i=0
  while kill -0 "$pid" 2>/dev/null && [ "$i" -lt "$secs" ]; do sleep 1; i=$((i + 1)); done
  if kill -0 "$pid" 2>/dev/null; then kill "$pid" 2>/dev/null; sleep 2; kill -9 "$pid" 2>/dev/null; return 124; fi
  wait "$pid"
}
# types <file>: distinct JSON event types, in first-seen order, comma separated.
types() {
  node -e '
const seen = [];
for (const l of require("fs").readFileSync(process.argv[1], "utf8").split("\n")) {
  try { const t = JSON.parse(l).type; if (t && !seen.includes(t)) seen.push(t); } catch {}
}
let msg = "";
for (const l of require("fs").readFileSync(process.argv[1], "utf8").split("\n")) {
  try { const e = JSON.parse(l); if (e.type === "error" && !msg) msg = [e.error?.type, e.error?.status, e.error?.message].filter(Boolean).join(" "); } catch {}
}
console.log((seen.join(",") || "none") + (msg ? " error=" + msg.slice(0, 100) : ""));' "$1"
}
has_session() { grep -q '"sessionID"' "$1" && echo yes || echo no; }

opencode --version >/dev/null 2>&1 || { echo "FAIL: opencode not on PATH"; exit 1; }
echo "VERSION $(opencode --version 2>&1 | head -1)"

# H: help surface (item 1 and 3).
opencode --help >"$T/help.txt" 2>&1
opencode run --help >"$T/run-help.txt" 2>&1
grep -q -- '--prompt' "$T/help.txt" && echo "H1 top-level --prompt: yes" || echo "H1 top-level --prompt: no"
grep -q -- '--attach' "$T/run-help.txt" && echo "H2 run --attach: yes" || echo "H2 run --attach: no"
for sub in serve attach; do
  run_to 30 opencode "$sub" --help >"$T/$sub-help.txt" 2>&1; echo "H3 $sub --help exit $?"
done
grep -q -- '--standalone' "$T/run-help.txt" && echo "H4 run --standalone: yes" || echo "H4 run --standalone: no"

# Providers: the mock LLM (answers), a stub that always answers HTTP 403 like a spend cap, and a closed port.
MOCK_LLM_PORT=0 MOCK_LLM_COMMAND='echo probe' node "$repo/tests/fixtures/mock-llm.mjs" >"$T/mock.log" 2>&1 &
MOCK_PID=$!
disown "$MOCK_PID"
cat > "$T/deny.mjs" <<'JS'
import http from 'node:http';
const s = http.createServer((req, res) => {
  res.writeHead(403, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ error: { code: 403, message: 'Spend cap breached (stub)', status: 'PERMISSION_DENIED' } }));
});
s.listen(0, '127.0.0.1', () => console.log(`DENY_PORT=${s.address().port}`));
JS
node "$T/deny.mjs" >"$T/deny.log" 2>&1 &
DENY_PID=$!
disown "$DENY_PID"
port=""; dport=""
for _ in 1 2 3 4 5 6 7 8 9 10; do
  port="$(sed -n 's/^MOCK_LLM_PORT=//p' "$T/mock.log" | head -1)"
  dport="$(sed -n 's/^DENY_PORT=//p' "$T/deny.log" | head -1)"
  [ -n "$port" ] && [ -n "$dport" ] && break; sleep 1
done
[ -n "$port" ] && [ -n "$dport" ] || { echo "FAIL: stub servers did not start"; exit 1; }

mkdir -p "$HOME/.config/opencode"
prov() { # prov <name> <port>
  printf '"%s": { "npm": "@ai-sdk/openai-compatible", "name": "%s", "options": { "baseURL": "http://127.0.0.1:%s/v1" }, "models": { "m": { "name": "M" } } }' "$1" "$1" "$2"
}
cat > "$HOME/.config/opencode/opencode.jsonc" <<JSON
{
  "\$schema": "https://opencode.ai/config.json",
  "autoupdate": false,
  "share": "disabled",
  "provider": { $(prov mock "$port"), $(prov deny "$dport"), $(prov down 9) }
}
JSON

cd "$T/proj" || exit 1
# case <label> <model> <prompt>: one headless run with JSON events, 180 s cap.
case_run() {
  local out="$T/$1.jsonl"
  run_to 180 opencode run --standalone --format json -m "$2" "$3" >"$out" 2>"$T/$1.err"
  local code=$?
  echo "$1 exit=$code types=$(types "$out") session=$(has_session "$out") stderr=$(tr '\n' ' ' <"$T/$1.err" | cut -c1-120)"
  return "$code"
}
case_run E1-mock-ok mock/m "Reply with OK." || { echo "FAIL: mock-backed run did not exit 0"; fail=1; }
grep -q '"type":"text"' "$T/E1-mock-ok.jsonl" || { echo "FAIL: mock-backed run printed no text event"; fail=1; }
case_run E2-unknown-model mock/nope "Reply with OK."
case_run E3-unknown-provider nosuch/m "Reply with OK."
case_run E4-provider-403 deny/m "Reply with OK."
case_run E5-provider-down down/m "Reply with OK."
case_run E6-empty-prompt mock/m ""

[ "$fail" = 0 ] && echo "PASS: spike-opencode-cli" || exit 1
