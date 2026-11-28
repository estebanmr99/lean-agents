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
# Same version shape as VERSION_RE in scripts/changelog.mjs: /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/
version_re='^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$'
if ! [[ "$version" =~ $version_re ]]; then
  echo "::error::invalid version \"$version\" (expected x.y.z or x.y.z-suffix)" >&2
  exit 2
fi
# #542: resolve the repo root from the script's own checkout (git 1.7.0), never the caller's cwd, then cd there.
# Anchoring on $0 keeps #587 (a caller in another repo must not change what is gated) and still works from a subfolder.
cd "$(dirname "$0")"
root="$(git rev-parse --show-toplevel)" || { echo "::error::not inside a git checkout; run the gate from the repo" >&2; exit 1; }
cd "$root"
head="$(git rev-parse --verify -q HEAD 2>/dev/null)" || { echo "::error::HEAD does not resolve to a commit in this checkout; commit first" >&2; exit 1; }
# The pins, audit and gh repo are read from this checkout, so HEAD must be the commit being gated.
if [ -n "${2:-}" ]; then
  sha="$(git rev-parse --verify -q "${2}^{commit}" 2>/dev/null)" || { echo "::error::${2} does not resolve to a commit here; git fetch first" >&2; exit 1; }
  if [ "$head" != "$sha" ]; then
    echo "::error::checkout HEAD $head is not the gated SHA $sha; run git pull (or check out $sha) first" >&2
    exit 1
  fi
else
  sha="$head"
  echo "::notice::gating HEAD $head"
fi
# Same check as release.yml: only a commit on main can be released. Skipped when origin/main is not fetched locally.
if git rev-parse --verify -q origin/main >/dev/null 2>&1; then
  git merge-base --is-ancestor "$sha" origin/main || { echo "::error::$sha is not on main" >&2; exit 1; }
fi
# Uncommitted or untracked edits in the gated paths would be gated instead of the SHA (#587).
dirty="$(git status --porcelain -- core scripts docs changes)"
if [ -n "$dirty" ]; then
  echo "::error::core/, scripts/, docs/ or changes/ has uncommitted or untracked files; commit or discard them so the gate reads only the gated SHA:" >&2
  printf '%s\n' "$dirty" >&2
  exit 1
fi
# The release ships its own skill, so the pin must be the tag being released (#547).
pin="$(node -e "process.stdout.write(String(JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).pins['lean-update'].version))" core/pins.json)"
if [ "$pin" != "v$version" ]; then
  echo "::error::core/pins.json lean-update pin is $pin; the release must ship its own skill (set it to v$version)" >&2
  exit 1
fi
# Compare against the highest v* tag that is not this release (not HEAD^: a release PR can hold several commits) (#590).
prev="$(git tag --list 'v*' --sort=-v:refname 2>/dev/null | grep -vx "v$version" | head -n 1 || true)"
if [ -n "$prev" ] && old="$(git show "$prev:core/pins.json" 2>/dev/null)"; then
  OLD_PINS="$old" node --input-type=module - "$root" <<'NODE' || exit 1
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const root = process.argv[2];
// import() needs a file URL: a bare Windows path such as c:\... is rejected as an unsupported scheme (#590).
const { pinDowngrades } = await import(pathToFileURL(path.join(root, 'scripts/lib/pin-downgrades.mjs')).href);
const { errors, notices } = pinDowngrades(JSON.parse(process.env.OLD_PINS).pins, JSON.parse(fs.readFileSync(path.join(root, 'core/pins.json'), 'utf8')).pins);
for (const n of notices) console.log(n);
for (const e of errors) console.error(e);
process.exit(errors.length ? 1 : 0);
NODE
fi
[ "$pins_only" = true ] && exit 0
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

# Optional app pins lag upstream: a warning, never a failure (the owner decides when to bump).
node --input-type=module <<'NODE' || echo "::notice::app pin check skipped (node or network unavailable)"
import fs from 'node:fs';
import { compareAppVersions } from './scripts/lib/update-plan.mjs';
const pins = JSON.parse(fs.readFileSync('core/pins.json', 'utf8')).pins;
const latest = {};
try {
  const r = await fetch('https://api.github.com/repos/stablyai/orca/releases/latest', { headers: { accept: 'application/vnd.github+json' } });
  if (r.ok) latest['orca-app'] = (await r.json()).tag_name;
} catch { /* offline: no warning */ }
try {
  const r = await fetch('https://releases.warp.dev/channel_versions.json');
  if (r.ok) latest['warp-app'] = (await r.json()).stable?.version;
} catch { /* offline: no warning */ }
for (const [key, version] of Object.entries(latest)) {
  if (!version || compareAppVersions(version, pins[key].version) <= 0) continue;
  console.log(`::warning::${key} pin ${pins[key].version} lags upstream latest ${version}; bump it before the next release`);
}
NODE
