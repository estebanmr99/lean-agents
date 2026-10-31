#!/usr/bin/env bash
# lean-agents bootstrap for macOS, Linux and Git Bash on Windows.
# Makes sure git and Node.js 20+ exist, fetches lean-agents, then hands over to the
# Node engine (scripts/lean.mjs), which shows the full plan before changing anything.
#
#   curl -fsSL https://raw.githubusercontent.com/estebanmr99/lean-agents/main/install.sh | bash -s -- --dry-run
set -euo pipefail

REPO_URL="${LEAN_AGENTS_REPO:-https://github.com/estebanmr99/lean-agents}"
REF="${LEAN_AGENTS_REF:-main}"
SRC="${LEAN_AGENTS_SRC:-$HOME/.config/lean-agents/src}"

say() { printf '%s\n' "$*"; }
die() { printf 'lean-agents: %s\n' "$*" >&2; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }

ask() {
  # Read from the terminal even when this script is piped into bash.
  local answer=""
  if [[ -r /dev/tty ]]; then read -r -p "$1 [y/N] " answer </dev/tty || true; fi
  [[ "$answer" =~ ^([yY]|[yY]es|[sS]i|[sS]í)$ ]]
}

dry_run=false
for arg in "$@"; do [[ "$arg" == "--dry-run" ]] && dry_run=true; done

ensure_tool() {
  local bin="$1" formula="$2" url="$3"
  have "$bin" && return 0
  if have brew; then
    if $dry_run; then say "Would run: brew install $formula"; return 1; fi
    ask "$bin is missing. Install it with 'brew install $formula'?" && brew install "$formula" && return 0
  fi
  die "$bin is required. Install it from $url and run this again."
}

ensure_tool git git https://git-scm.com/downloads || true
ensure_tool node node https://nodejs.org/ || true
if have node; then
  major="$(node -p 'process.versions.node.split(".")[0]')"
  (( major >= 20 )) || die "Node.js 20 or newer is required (found $(node --version)). Update from https://nodejs.org/"
else
  die "Node.js is required for the engine. Install it and run this again."
fi

# Use the checkout this script lives in, if any; otherwise clone or update ~/.config/lean-agents/src.
here="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" 2>/dev/null && pwd || true)"
if [[ -n "$here" && -f "$here/scripts/lean.mjs" ]]; then
  SRC="$here"
elif [[ -d "$SRC/.git" ]]; then
  git -C "$SRC" fetch --quiet --depth 1 origin "$REF"
  git -C "$SRC" checkout --quiet FETCH_HEAD
else
  have git || die "git is required to download lean-agents."
  mkdir -p "$(dirname "$SRC")"
  git clone --quiet --depth 1 --branch "$REF" "$REPO_URL" "$SRC"
fi

if [[ ! -d "$SRC/node_modules/jsonc-parser" ]]; then
  (cd "$SRC" && npm ci --omit=dev --silent --no-audit --no-fund) || die "npm install failed in $SRC"
fi

exec node "$SRC/scripts/lean.mjs" "$@"
