#!/usr/bin/env bash
# Download a pinned CI file and check its SHA256 before anything runs it: ci-download.sh <key> <dest>
# Keys, URLs and hashes live in tests/ci-downloads.json (CI_DOWNLOADS points a test at another file). With CI_LATEST=true (ci-latest) a mismatch only warns,
# because that run exists to see the newest upstream. The file is still run unverified then: the warning and the step
# summary say so, and nothing is merged without a human reviewing the pin-bump PR.
set -euo pipefail
key=$1 dest=$2
url=$(node -p "require(process.env.CI_DOWNLOADS || './tests/ci-downloads.json')['$key'].url")
want=$(node -p "require(process.env.CI_DOWNLOADS || './tests/ci-downloads.json')['$key'].sha256")
curl -fsSL -o "$dest" "$url"
# Hashed in node: sha256sum prefixes the hash with a backslash when the path has one (Windows runners).
got=$(node --input-type=module -e "import { sha256 } from './scripts/lib/verify-sha256.mjs'; console.log(sha256(process.argv[1]))" "$dest")
if [ "$got" != "$want" ]; then
  if [ "${CI_LATEST:-}" = true ]; then echo "::warning::$key changed upstream: sha256 $got (pinned $want)"; echo "- $key changed upstream, ran unverified: sha256 $got (pinned $want)" >> "${GITHUB_STEP_SUMMARY:-/dev/null}"; exit 0; fi
  echo "::error::$key: sha256 $got does not match the pinned $want" >&2
  rm -f "$dest"
  exit 1
fi
echo "$key: sha256 ok"
