#!/usr/bin/env bash
# Release gate for a tag. Checks this version's lean-update skill pin, audit, open audit issues and a green ci.yml run for the SHA.
# Start the audit from docs/audit-template.md.
# Usage: bash scripts/release-gate.sh [--pins-only] <version> [sha]   (default SHA: git rev-parse HEAD)
set -eu

pins_only=false
if [ "${1:-}" = "--pins-only" ]; then pins_only=true; shift; fi
version="${1:-}"
if [ -z "$version" ]; then
  echo "usage: bash scripts/release-gate.sh [--pins-only] <version> [sha]" >&2
  exit 2
fi
# The release ships its own skill, so the pin must be the tag being released (#547).
pin="$(node -e "process.stdout.write(String(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).pins['lean-update'].version))" "$(dirname "$0")/../core/pins.json")"
if [ "$pin" != "v$version" ]; then
  echo "::error::core/pins.json lean-update pin is $pin; the release must ship its own skill (set it to v$version)" >&2
  exit 1
fi
[ "$pins_only" = true ] && exit 0
sha="${2:-$(git rev-parse HEAD)}"
# gh matches only the full SHA; resolve a short one when the commit is present locally.
sha=$(git rev-parse --verify --quiet "${sha}^{commit}" || printf '%s' "$sha")
repo="${GITHUB_REPOSITORY:-$(gh repo view --json nameWithOwner --jq .nameWithOwner)}"

audit="docs/audit-${version}.md"
test -f "$audit" || { echo "::error::$audit is missing" >&2; exit 1; }
if ! grep -q '^## Summary' "$audit" || ! grep -q '^## Findings and issues' "$audit"; then
  echo "::error::$audit lacks the Summary and Findings and issues sections" >&2
  exit 1
fi

ok=$(gh run list --repo "$repo" --commit "$sha" --workflow ci.yml --json conclusion --jq 'map(select(.conclusion == "success")) | length')
[ "${ok:-0}" -gt 0 ] || { echo "::error::no successful ci.yml run for $sha" >&2; exit 1; }

# An open audit issue labelled release-proof does not block: its proof is the release run itself.
issues=$(gh issue list --repo "$repo" --label audit --state open --limit 1000 --json number,labels \
  --jq '.[] | "\(if ([.labels[].name] | index("release-proof")) then "exempt" else "open" end) \(.number)"')
blocked=""
while read -r kind number; do
  [ -n "$number" ] || continue
  if [ "$kind" = exempt ]; then
    echo "::notice::exempt (release-proof): #$number, the release run is its proof"
  else
    blocked="$blocked #$number"
  fi
done <<<"$issues"
[ -z "$blocked" ] || { echo "::error::open audit issues:$blocked" >&2; exit 1; }
