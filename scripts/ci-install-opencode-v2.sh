#!/usr/bin/env bash
# OpenCode 2 for the real-* jobs: the installer is checked against its pinned SHA256, then run with the pinned version
# (core/pins.json "opencode-v2", package @opencode/cli on npm; the installer downloads that version from the npm registry).
set -euo pipefail
bash scripts/ci-download.sh opencode-installer "$RUNNER_TEMP/opencode-install"
bash "$RUNNER_TEMP/opencode-install" --version "$(node -p "require('./core/pins.json').pins['opencode-v2'].version")"
