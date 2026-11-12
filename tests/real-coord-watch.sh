#!/usr/bin/env bash
# The coordinate skill's watcher, copied out of the repo like the Skills CLI would, run in a throwaway git repo
# against fake worker transcripts in a git worktree. One run per exit reason. No agent binaries needed.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOME="$(mktemp -d)"
export HOME
WORK="$HOME"
trap 'rm -rf "$WORK"' EXIT
fail() { echo "FAIL: $*" >&2; exit 1; }

# Only what the skill folder ships.
SKILL="$WORK/skills/coordinate"
mkdir -p "$SKILL"
cp "$ROOT"/skills/coordinate/* "$SKILL/"
WATCH="$SKILL/coord-watch.sh"
[ -f "$SKILL/session-prompt.md" ] || fail "session-prompt.md not next to the watcher"

git init -q -b main "$WORK/proj"
git -C "$WORK/proj" -c user.name=Test -c user.email=test@example.com commit -q --allow-empty -m init
git -C "$WORK/proj" worktree add -q "$WORK/proj-s1" -b session-1-demo
COORD="$WORK/proj/.git/lean-coord"
mkdir -p "$COORD"

# expect <reason> <plan-flag-or-empty> <line the fake worker prints>
expect() {
  local reason="$1" plan="$2" line="$3" log="$WORK/proj-s1/transcript.log" out
  echo "working..." > "$log"
  rm -f "$COORD/plan-1.md"
  ( sleep 1
    if [ "$plan" = plan ]; then echo "# plan" > "$COORD/plan-1.md"; else printf '%s\n' "$line" >> "$log"; fi ) &
  out="$(bash "$WATCH" s1 --file "$log" --plan "$COORD/plan-1.md" --interval 0.2 --max-polls 100)"
  wait
  [ "$out" = "s1: $reason" ] || fail "expected 's1: $reason', got '$out'"
  echo "ok: $reason"
}

expect "plan file written" plan ""
expect "new PR URL https://github.com/o/r/pull/9" "" "PR: https://github.com/o/r/pull/9"
expect "menu/question" "" "Do you want to proceed? (y/n)"
expect "limit" "" "usage limit reached"
expect "error" "" "API Error: overloaded"
expect "turn ended" "" "next: review"

# Nothing happens: exit 2 and say so.
echo "working..." > "$WORK/proj-s1/transcript.log"
set +e
out="$(bash "$WATCH" s1 --file "$WORK/proj-s1/transcript.log" --interval 0.1 --max-polls 3)"
code=$?
set -e
[ "$code" = 2 ] && [ "$out" = "s1: timeout" ] || fail "timeout case: code $code, '$out'"
echo "ok: timeout"
