#!/bin/bash
# Local behavior diff (#226): runs the same engine flows at a base ref and at the working tree, each in a throwaway
# HOME with --no-exec, and diffs the output and the files written (normalized: temp paths, times, hashes). Not a CI job; nothing touches the real HOME.
#   bash scripts/behavior-diff.sh [base-ref]      (default: origin/main; exit 1 when anything differs)
set -eu -o pipefail
base=${1:-origin/main}
root=$(cd "$(dirname "$0")/.." && pwd -P)
tmp=$(cd "$(mktemp -d)" && pwd -P) # -P: macOS /tmp is /private/tmp, and the engine prints real paths
trap 'git -C "$root" worktree remove --force "$tmp/base" >/dev/null 2>&1 || true; rm -rf "$tmp"' EXIT
git -C "$root" worktree add --detach -q "$tmp/base" "$base"
ln -s "$root/node_modules" "$tmp/base/node_modules"

# One flow per line: name|step;step;... Every step runs in the same HOME, in order.
FLOWS='dry-run|--yes --dry-run --agents claude,opencode-v2,copilot-cli,cursor --all-tools --lang en --profile none
install-doctor-uninstall|--yes --agents claude,opencode-v2 --all-tools --lang en --profile none;--doctor;--yes --uninstall
opencode1|--yes --agents opencode-v1 --tools dcp,ponytail --lang en --profile none;--doctor
update|--yes --agents claude --lang en --profile none;--update --yes --dry-run
adopt|--yes --agents claude,opencode-v2 --lang en --profile none;--adopt;--adopt --json
upgrade-dry-run|--upgrade-agent opencode --dry-run;--upgrade-agent opencode --dry-run --json
version|--version'

# Temp paths, timestamps and pids differ on every run: normalize them so only behavior shows. <home> <tree>
norm() {
  sed -e "s#$1#~#g" -e "s#$2#ROOT#g" -e 's/[0-9]\{8\}T[0-9]\{6\}Z/STAMP/g' -e 's/[0-9]\{4\}-[0-9]\{2\}-[0-9]\{2\}T[0-9:.-]*Z/TIME/g' \
    -e 's/[0-9a-f]\{64\}/SHA/g' -e 's/[0-9]\{13\}/MS/g' -e 's/(node:[0-9]*)/(node:PID)/g'
}

run() { # <tree> <out dir>
  mkdir -p "$2"
  printf '%s\n' "$FLOWS" | while IFS='|' read -r name steps; do
    home=$(mktemp -d "$tmp/home.XXXXXX")
    printf '%s\n' "$steps" | tr ';' '\n' | while read -r step; do
      echo "\$ lean $step"
      # shellcheck disable=SC2086 # each step is a list of flags
      (cd "$home" && HOME="$home" USERPROFILE="$home" node "$1/scripts/lean.mjs" --home "$home" --no-exec $step 2>&1) || echo "[exit $?]"
    done | norm "$home" "$1" > "$2/$name.out"
    # A normalized copy of every file written, so the diff shows changed lines, not only changed files.
    (cd "$home" && find . -type f ! -path './.config/lean-agents/backups/*' | while read -r f; do
      t="$2/$name.home/$(printf '%s' "$f" | norm "$home" "$1")"
      mkdir -p "$(dirname "$t")" && norm "$home" "$1" < "$f" > "$t"
    done)
  done
}

run "$tmp/base" "$tmp/a"
run "$root" "$tmp/b"
if diff -ru "$tmp/a" "$tmp/b" | sed "s#$tmp/[ab]/##g"; then echo "no behavior change against $base"; else exit 1; fi
