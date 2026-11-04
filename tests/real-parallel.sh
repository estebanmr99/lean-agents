#!/usr/bin/env bash
# Real git worktrees in a throwaway repo and HOME: start two workers with a stub agent, status,
# ordered merge with rebase, clean. Real claude/opencode/orca binaries only get their flags checked.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="$(mktemp -d)"
export HOME="$WORK/home"
mkdir -p "$HOME"
trap 'rm -rf "$WORK"' EXIT
PAR=(node "$ROOT/scripts/parallel.mjs" --repo "$WORK/proj")

fail() { echo "FAIL: $*" >&2; exit 1; }
refute() { if "$@"; then fail "should have failed: $*"; fi; }
git_() { git -C "$WORK/proj" -c user.name=Test -c user.email=test@example.com "$@"; }

mkdir "$WORK/proj"
git_ init -q -b main
echo hi > "$WORK/proj/README.md"
git_ add .
git_ commit -qm init

cat > "$WORK/stub.sh" <<'EOS'
#!/usr/bin/env bash
# Stub agent: commits <task>.txt and reports done in the status file named in the prompt.
set -e
name="$(basename "$(dirname "$1")")"
status="$(sed -n 's/.*writing one line to \([^ ]*\):.*/\1/p' "$1")"
echo "$name" > "$name.txt"
git add .
git -c user.name=Stub -c user.email=stub@example.com commit -qm "$name"
echo done > "$status"
EOS
chmod +x "$WORK/stub.sh"
printf -- '---\nrole: explore\ncheck: git status\n---\nDo one.\n' > "$WORK/one.md"
printf -- '---\nrole: build\n---\nDo two.\n' > "$WORK/two.md"

"${PAR[@]}" start --agent custom --cmd "$WORK/stub.sh" --profile claude-subscription "$WORK/one.md" "$WORK/two.md" | tee "$WORK/start.out"
grep -q 'one: custom, tier cheap (haiku)' "$WORK/start.out" || fail "tier of one"
grep -q 'two: custom, tier balanced (sonnet)' "$WORK/start.out" || fail "tier of two"

for _ in $(seq 1 50); do
  n="$("${PAR[@]}" status | grep -c "done" || true)"
  if [ "$n" = 2 ]; then break; fi
  sleep 0.2
done
"${PAR[@]}" status
[ "$n" = 2 ] || fail "workers did not finish"

refute "${PAR[@]}" merge two --yes
"${PAR[@]}" merge one --yes | grep -q 'rebased two' || fail "second worker was not rebased"
"${PAR[@]}" merge two --yes
if [ ! -f "$WORK/proj/one.txt" ] || [ ! -f "$WORK/proj/two.txt" ]; then fail "merged files missing"; fi

"${PAR[@]}" clean
[ -z "$(git_ branch --list 'lean/*')" ] || fail "branch left behind"
[ "$(git_ worktree list | wc -l | tr -d ' ')" = 1 ] || fail "worktree left behind"
[ ! -e "$WORK/proj.lean" ] || fail "worktree folder left behind"

# Flags the helper builds, checked against real binaries when present.
if command -v claude >/dev/null 2>&1; then
  for f in --bg --permission-mode --model; do claude --help | grep -q -- "$f" || fail "claude lacks $f"; done
  claude --help | grep -qE -- '(-n, )?--name' || fail "claude lacks --name"
fi
if command -v opencode >/dev/null 2>&1; then
  for f in --agent --model --file --title; do opencode run --help | grep -q -- "$f" || fail "opencode run lacks $f"; done
fi
if command -v orca >/dev/null 2>&1 && orca agent-context --json >/dev/null 2>&1; then
  for f in --name --agent --model --prompt --surface --base-branch --json; do orca worktree create --help | grep -q -- "$f" || fail "orca lacks $f"; done
else
  echo "orca not available: Orca path stays VERIFY"
fi
echo "real-parallel: OK"
