#!/usr/bin/env bash
# Download a pinned CI file and check its SHA256 before anything runs it: ci-download.sh <key> <dest>
# Keys, URLs and hashes live in tests/ci-downloads.json. With CI_LATEST=true (ci-latest) a mismatch only warns,
# because that run exists to see the newest upstream; the file is still never piped into a shell.
set -euo pipefail
key=$1 dest=$2
url=$(node -p "require('./tests/ci-downloads.json')['$key'].url")
want=$(node -p "require('./tests/ci-downloads.json')['$key'].sha256")
curl -fsSL -o "$dest" "$url"
if command -v sha256sum >/dev/null; then got=$(sha256sum "$dest" | cut -d' ' -f1); else got=$(shasum -a 256 "$dest" | cut -d' ' -f1); fi
if [ "$got" != "$want" ]; then
  if [ "${CI_LATEST:-}" = true ]; then echo "::warning::$key changed upstream: sha256 $got (pinned $want)"; exit 0; fi
  echo "::error::$key: sha256 $got does not match the pinned $want" >&2
  rm -f "$dest"
  exit 1
fi
echo "$key: sha256 ok"
