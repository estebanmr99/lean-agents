#!/usr/bin/env bash
# lean-agents bootstrap for macOS, Linux and Git Bash on Windows.
# Makes sure git and Node.js 22.20+ exist, downloads the latest release (npm tarball), checks it against
# the release's SHA256SUMS, then hands over to the Node engine (scripts/lean.mjs), which shows the full
# plan before changing anything. Node users can skip this: npx lean-agents@latest
#
#   curl -fsSL https://github.com/estebanmr99/lean-agents/releases/latest/download/install.sh | bash -s -- --dry-run
#
# Env: LEAN_AGENTS_VERSION=0.7.0 pins a release; LEAN_AGENTS_DIST=<dir or https url> reads the release
# files from there instead (CI and mirrors; prints a warning); LEAN_AGENTS_SRC moves the install folder.
set -euo pipefail

REPO="estebanmr99/lean-agents"
SRC="${LEAN_AGENTS_SRC:-$HOME/.config/lean-agents/src}"

say() { printf '%s\n' "$*"; }
warn() { printf 'lean-agents: %s\n' "$*" >&2; }
die() { warn "$*"; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }
sha256_of() { node -e 'const h=process.getBuiltinModule("node:crypto").createHash("sha256");h.update(process.getBuiltinModule("node:fs").readFileSync(process.argv[1]));process.stdout.write(h.digest("hex"))' "$1"; }

ask() {
  # Read from the terminal even when this script is piped into bash.
  local answer=""
  if [[ -r /dev/tty ]]; then read -r -p "$1 [y/N] " answer </dev/tty || true; fi
  [[ "$answer" =~ ^([yY]|[yY]es|[sS]i|[sS]í)$ ]]
}

dry_run=false
offline=false
update=false
for arg in "$@"; do
  case "$arg" in
    --dry-run) dry_run=true; offline=true ;;
    --doctor|--uninstall) offline=true ;;
    --update) update=true ;;
  esac
done

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
  minor="$(node -p 'process.versions.node.split(".")[1]')"
  (( major > 22 || (major == 22 && minor >= 20) )) || die "Node.js 22.20 or newer is required (found $(node --version)). Update from https://nodejs.org/"
else
  die "Node.js is required for the engine. Install it and run this again."
fi

run_engine() {
  local code=0
  node "$1/scripts/lean.mjs" "${@:2}" || code=$?
  return "$code"
}

# A checkout is used only when this script is a real file next to scripts/lean.mjs. Piped into bash,
# BASH_SOURCE is empty, so a scripts/lean.mjs in the current directory is never run.
# A checkout you run as a file is trusted as it is (you chose it); only the release download is checksum-verified.
here=""
if [[ -f "${BASH_SOURCE[0]:-}" ]] && script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd)"; then here="$script_dir"; fi
if [[ -n "$here" && -f "$here/scripts/lean.mjs" ]]; then
  # node_modules/.lean-agents-lock holds the package-lock.json hash from the last npm ci, so a changed lockfile reinstalls.
  lock=""
  [[ -f "$here/package-lock.json" ]] && lock="$(sha256_of "$here/package-lock.json")"
  if [[ ! -d "$here/node_modules/jsonc-parser" || ! -d "$here/node_modules/@clack/prompts" || "$(cat "$here/node_modules/.lean-agents-lock" 2>/dev/null || true)" != "$lock" ]]; then
    (cd "$here" && npm ci --omit=dev --silent --no-audit --no-fund) || die "npm install failed in $here"
    printf '%s\n' "$lock" > "$here/node_modules/.lean-agents-lock"
  fi
  exec node "$here/scripts/lean.mjs" "$@"
fi

stamp="$SRC/.lean-agents-release"

# Already installed: --dry-run, --doctor and --uninstall (without --update) run it with no network.
if $offline && ! $update && [[ -f "$stamp" && -f "$SRC/scripts/lean.mjs" ]]; then
  exec node "$SRC/scripts/lean.mjs" "$@"
fi

# Never replace a folder that is not a lean-agents install (the old git clone has scripts/lean.mjs and goes).
if [[ -e "$SRC" && ! -f "$SRC/scripts/lean.mjs" ]]; then
  die "$SRC exists and is not a lean-agents install. Move it away or set LEAN_AGENTS_SRC."
fi
# An old bootstrap clone is clean, on one branch and fully pushed, so it goes. Anything else (local changes,
# no upstream, unpushed commits, a stash, extra branches) or any clone the user pointed LEAN_AGENTS_SRC at stays.
if [[ -e "$SRC/.git" ]]; then
  keep=""
  if [[ -n "${LEAN_AGENTS_SRC:-}" ]]; then
    keep="LEAN_AGENTS_SRC points at a git clone"
  elif ! dirty="$(git -C "$SRC" status --porcelain 2>&1)" || [[ -n "$dirty" ]]; then
    keep="it has local changes (or git cannot read it)"
  elif ! unpushed="$(git -C "$SRC" log '@{u}..' --oneline 2>&1)"; then
    keep="it has no upstream branch"
  elif [[ -n "$unpushed" ]]; then
    keep="it has commits that are not pushed"
  elif [[ -n "$(git -C "$SRC" stash list 2>&1)" ]]; then
    keep="it has a stash"
  elif [[ "$(git -C "$SRC" for-each-ref refs/heads 2>&1 | wc -l)" -gt 1 ]]; then
    keep="it has more than one local branch"
  fi
  [[ -z "$keep" ]] || die "$SRC is a git clone and is left alone ($keep). Move it away, or set LEAN_AGENTS_SRC to another folder."
fi

if [[ -n "${LEAN_AGENTS_DIST:-}" ]]; then
  base="${LEAN_AGENTS_DIST%/}"
  [[ "$base" == https://* || -d "$base" ]] || die "LEAN_AGENTS_DIST must be an https URL or an existing folder."
  warn "warning: LEAN_AGENTS_DIST is set, so lean-agents comes from $base and not from GitHub releases."
elif [[ -n "${LEAN_AGENTS_VERSION:-}" ]]; then
  base="https://github.com/$REPO/releases/download/v${LEAN_AGENTS_VERSION#v}"
else
  base="https://github.com/$REPO/releases/latest/download"
fi

get() {
  if [[ "$base" == https://* ]]; then
    have curl || die "curl is required to download lean-agents."
    curl -fsSL "$base/$1" -o "$2" || die "could not download $base/$1"
  else
    cp "$base/$1" "$2" || die "could not read $base/$1"
  fi
}

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

get SHA256SUMS "$tmp/SHA256SUMS"
line="$(grep -E '^[0-9a-f]{64}  lean-agents-[0-9A-Za-z._-]+\.tgz$' "$tmp/SHA256SUMS" | head -n 1 || true)"
[[ -n "$line" ]] || die "SHA256SUMS has no lean-agents tarball."
want="${line%%  *}"
name="${line##*  }"
version="${name#lean-agents-}"
version="${version%.tgz}"

if [[ -f "$stamp" && -f "$SRC/scripts/lean.mjs" && "$(cat "$stamp")" == "$want" ]]; then
  say "lean-agents v$version already installed."
  code=0
  run_engine "$SRC" "$@" || code=$?
  exit "$code"
fi

get "$name" "$tmp/$name"
got="$(sha256_of "$tmp/$name")"
[[ "$got" == "$want" ]] || die "checksum mismatch for $name (expected $want, got $got). Nothing was installed."

# A dry run with nothing installed leaves HOME untouched: the engine runs from a temp folder.
if $dry_run && [[ ! -f "$stamp" ]]; then
  mkdir "$tmp/src"
  tar -xzf "$tmp/$name" -C "$tmp/src" --strip-components 1
  code=0
  run_engine "$tmp/src" "$@" || code=$?
  exit "$code"
fi

mkdir -p "$(dirname "$SRC")"
rm -rf "$SRC.new"
mkdir "$SRC.new"
tar -xzf "$tmp/$name" -C "$SRC.new" --strip-components 1
[[ -f "$SRC.new/scripts/lean.mjs" ]] || die "$name has no scripts/lean.mjs."
printf '%s\n' "$want" > "$SRC.new/.lean-agents-release"
rm -rf "$SRC"
mv "$SRC.new" "$SRC"
say "lean-agents v$version installed in $SRC"

code=0
run_engine "$SRC" "$@" || code=$?
exit "$code"
