#!/usr/bin/env bash
# Creates or updates the issue labels lean-agents uses. Safe to run again.
# Old GitHub default labels are renamed, so issues that carry them keep them.
#
#   bash scripts/labels.sh [--dry-run] [owner/repo]
set -euo pipefail

dry_run=false
repo_args=()
for arg in "$@"; do
  case "$arg" in
    --dry-run) dry_run=true ;;
    -*) echo "usage: labels.sh [--dry-run] [owner/repo]" >&2; exit 2 ;;
    *) repo_args+=(--repo "$arg") ;;
  esac
done

gh_run() {
  if $dry_run; then printf 'gh'; printf ' %q' "$@"; printf '\n'; else gh "$@"; fi
}

# gh label list is read-only, so it also runs in --dry-run.
existing="$(gh label list ${repo_args[@]+"${repo_args[@]}"} --limit 200 --json name --jq '.[].name')"
has() { printf '%s\n' "$existing" | grep -Fxq "$1"; }

# old|new
for pair in 'bug|type: bug' 'documentation|type: docs' 'enhancement|type: feature'; do
  old="${pair%%|*}"
  new="${pair#*|}"
  if has "$old" && ! has "$new"; then
    gh_run label edit "$old" --name "$new" ${repo_args[@]+"${repo_args[@]}"}
  fi
done

# name|color|description
while IFS='|' read -r name color desc; do
  [[ -n "$name" ]] || continue
  gh_run label create "$name" --color "$color" --description "$desc" --force ${repo_args[@]+"${repo_args[@]}"}
done <<'EOF'
type: bug|d73a4a|Something does not work
type: feature|a2eeef|New capability or change
type: update|0e8a16|Pinned tool version, drift or update failure
type: docs|0075ca|Documentation only
type: ci|ededed|Workflows and test jobs
type: security|b60205|Security hardening or exposure
priority: p0|b60205|Blocks users or leaks data; fix now
priority: p1|d93f0b|Next release
priority: p2|fbca04|Later, no deadline
area: engine|5319e7|scripts/lean.mjs and scripts/lib
area: installer|5319e7|install.sh and install.ps1
area: ci|5319e7|.github/workflows and tests/real-*
area: docs|5319e7|README, docs/, CHANGELOG
area: adapters|5319e7|scripts/lib/adapters and per-agent output
version-watch|ededed|Opened by the daily version watch
EOF
