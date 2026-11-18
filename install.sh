#!/usr/bin/env bash
# lean-agents bootstrap for macOS, Linux and Git Bash on Windows.
# Makes sure Node.js 22.20+ exists (Homebrew, or a checksum-verified Node.js download kept in its own folder), downloads the latest release (npm tarball), checks it against
# the release's SHA256SUMS, then hands over to the Node engine (scripts/lean.mjs), which shows the full
# plan before changing anything. Node users can skip this: npx lean-agents@latest
#
#   curl -fsSL https://github.com/estebanmr99/lean-agents/releases/latest/download/install.sh | bash -s -- --dry-run
#
# Env: LEAN_AGENTS_VERSION=0.7.0 pins a release; LEAN_AGENTS_DIST=<dir or https url> reads the release
# files from there instead (CI and mirrors; prints a warning); LEAN_AGENTS_SRC moves the install folder.
# Without Node.js: LEAN_AGENTS_NODE_DIR moves the private Node folder; LEAN_AGENTS_NODE_DIST=<dir or https url> replaces
# https://nodejs.org/dist (CI and mirrors; prints a warning). Downloads read HTTPS_PROXY/https_proxy and NO_PROXY through
# curl, and curl trusts the CA file named by NODE_EXTRA_CA_CERTS (a path only; nothing is written to disk).
set -euo pipefail

REPO="estebanmr99/lean-agents"
SRC="${LEAN_AGENTS_SRC:-$HOME/.config/lean-agents/src}"

say() { printf '%s\n' "$*"; }
warn() { printf 'lean-agents: %s\n' "$*" >&2; }
die() { warn "$*"; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }
# node is not there yet when the private Node.js tarball is checked, so prefer the system tools.
sha256_of() {
  if have sha256sum; then sha256sum "$1" | cut -d' ' -f1
  elif have shasum; then shasum -a 256 "$1" | cut -d' ' -f1
  else node -e 'const h=process.getBuiltinModule("node:crypto").createHash("sha256");h.update(process.getBuiltinModule("node:fs").readFileSync(process.argv[1]));process.stdout.write(h.digest("hex"))' "$1"
  fi
}

ask() {
  # Read from the terminal even when this script is piped into bash.
  local answer=""
  if [[ -r /dev/tty ]]; then read -r -p "$1 [y/N] " answer </dev/tty || true; fi
  [[ "$answer" =~ ^([yY]|[yY]es|[sS]i|[sS]í)$ ]]
}

dry_run=false
offline=false
update=false
yes=false
for arg in "$@"; do
  case "$arg" in
    --yes) yes=true ;;
    --dry-run) dry_run=true; offline=true ;;
    --doctor|--uninstall) offline=true ;;
    --update) update=true ;;
  esac
done

NODE_MAJOR=24
NODE_DIR="${LEAN_AGENTS_NODE_DIR:-$HOME/.config/lean-agents/node}"

node_ok() {
  have node || return 1
  local v major rest minor
  v="$(node -p 'process.versions.node' 2>/dev/null)" || return 1
  major="${v%%.*}"
  rest="${v#*.}"
  minor="${rest%%.*}"
  (( major > 22 || (major == 22 && minor >= 20) ))
}

# curl reads the proxy variables itself. A TLS-inspecting company CA is passed by path, and only when a proxy is set
# (--cacert replaces curl's own roots, which is right when the proxy re-signs every site, wrong for a direct connection);
# CURL_CA_BUNDLE or SSL_CERT_FILE, if set, win.
fetch() {
  have curl || die "curl is required to download lean-agents."
  local ca=()
  if [[ -n "${HTTPS_PROXY:-}${https_proxy:-}" && -n "${NODE_EXTRA_CA_CERTS:-}" && -z "${CURL_CA_BUNDLE:-}" && -z "${SSL_CERT_FILE:-}" && -r "$NODE_EXTRA_CA_CERTS" ]]; then
    ca=(--cacert "$NODE_EXTRA_CA_CERTS")
  fi
  curl -fsSL "${ca[@]+"${ca[@]}"}" "$@"
}

redact_url() { printf '%s' "$1" | sed 's|//[^/@]*@|//|'; }

# get_from <dir or https url> <name> <dest>
get_from() {
  if [[ "$1" == https://* ]]; then
    fetch "$1/$2" -o "$3" || die "could not download $(redact_url "$1/$2")"
  else
    cp "$1/$2" "$3" || die "could not read $1/$2"
  fi
}

# Pinned by commit and sha256 (core/pins.json "homebrew-installer" must match; tests/install-sh-pins.test.mjs checks it).
BREW_INSTALL_URL="https://raw.githubusercontent.com/Homebrew/install/e5b3c5834e3932c8aaa42deef4794076c9b0cbf0/install.sh"
BREW_INSTALL_SHA256="5f333bbe53bc490e51e7ccb1df8779b3dd6ee73a1a7379efda216edb08ccb148"

# The official Homebrew installer needs a terminal (it asks for your password), so stdin comes from /dev/tty.
install_homebrew() {
  local t p
  t="$(mktemp -d)"
  fetch "$BREW_INSTALL_URL" -o "$t/brew-install.sh" || { rm -rf "$t"; die "could not download the Homebrew installer."; }
  [[ "$(sha256_of "$t/brew-install.sh")" == "$BREW_INSTALL_SHA256" ]] || { rm -rf "$t"; die "checksum mismatch for the Homebrew installer. Nothing was run."; }
  /bin/bash "$t/brew-install.sh" </dev/tty || { rm -rf "$t"; die "the Homebrew installer failed."; }
  rm -rf "$t"
  for p in /opt/homebrew/bin/brew /usr/local/bin/brew; do
    if [[ -x "$p" ]]; then eval "$("$p" shellenv)"; fi
  done
  have brew
}

# Official Node.js tarball for the latest Node $NODE_MAJOR, checked against the SHASUMS256.txt of the same folder, kept in its
# own folder. Only this script's engine run puts it on PATH; the user's shell and own Node stay as they are.
install_node_tarball() {
  local os arch base t line want file got
  case "$(uname -s)" in
    Darwin) os=darwin ;;
    Linux) os=linux ;;
    *) die "No Node.js download for $(uname -s). Install Node.js 22.20+ from https://nodejs.org/ (on Windows use install.ps1) and run this again." ;;
  esac
  case "$(uname -m)" in
    arm64|aarch64) arch=arm64 ;;
    x86_64|amd64) arch=x64 ;;
    *) die "No Node.js download for $(uname -m). Install Node.js 22.20+ from https://nodejs.org/ and run this again." ;;
  esac
  base="${LEAN_AGENTS_NODE_DIST:-https://nodejs.org/dist}"
  base="${base%/}/latest-v$NODE_MAJOR.x"
  [[ -z "${LEAN_AGENTS_NODE_DIST:-}" ]] || warn "warning: LEAN_AGENTS_NODE_DIST is set, so Node.js does not come from nodejs.org."
  [[ ! -e "$NODE_DIR" ]] || die "$NODE_DIR exists and has no usable Node.js. Move it away or set LEAN_AGENTS_NODE_DIR."
  t="$(mktemp -d)"
  trap 'rm -rf "$t"' EXIT
  get_from "$base" SHASUMS256.txt "$t/SHASUMS256.txt"
  line="$(grep -E "^[0-9a-f]{64}  node-v[0-9.]+-$os-$arch\.tar\.gz\$" "$t/SHASUMS256.txt" | head -n 1 || true)"
  [[ -n "$line" ]] || { rm -rf "$t"; die "SHASUMS256.txt has no node-$os-$arch tarball."; }
  want="${line%%  *}"
  file="${line##*  }"
  get_from "$base" "$file" "$t/$file"
  got="$(sha256_of "$t/$file")"
  [[ "$got" == "$want" ]] || { rm -rf "$t"; die "checksum mismatch for $file (expected $want, got $got). Nothing was installed."; }
  mkdir "$t/node"
  tar -xzf "$t/$file" -C "$t/node" --strip-components 1
  mkdir -p "$(dirname "$NODE_DIR")"
  mv "$t/node" "$NODE_DIR"
  rm -rf "$t"
  trap - EXIT
  say "Node.js installed in $NODE_DIR (remove that folder to undo)."
}

# Hands the engine a Node.js it may use but must not count as the user's own: the tools still get Node 24 under nvm.
use_private_node() {
  export PATH="$NODE_DIR/bin:$PATH"
  export LEAN_AGENTS_BOOTSTRAP_NODE="$NODE_DIR"
  # Global npm installs (agent CLIs, tools) must not land in the private folder, which `remove it to undo` deletes.
  [[ -n "${NPM_CONFIG_PREFIX:-}${npm_config_prefix:-}" ]] || export NPM_CONFIG_PREFIX="$HOME/.local"
}

# Never replaces a Node.js the user has: an old one is left alone and the private one is used for the engine.
ensure_node() {
  node_ok && return 0
  local p
  for p in /opt/homebrew/bin/brew /usr/local/bin/brew; do
    if ! have brew && [[ -x "$p" ]]; then eval "$("$p" shellenv)"; fi
  done
  if [[ -x "$NODE_DIR/bin/node" ]] && (PATH="$NODE_DIR/bin:$PATH"; node_ok); then use_private_node; return 0; fi
  local found="" mac=false
  have node && found="$(node --version 2>/dev/null || true)"
  [[ "$(uname -s)" == Darwin ]] && mac=true
  say "Node.js 22.20 or newer is needed to run the installer engine${found:+ (found $found, which stays as it is)}."
  if $mac && [[ -z "$found" ]]; then
    if have brew; then say "  - brew install node"
    else say "  - Install Homebrew with its official installer (https://brew.sh; it asks for your password and installs the Xcode Command Line Tools), then brew install node"; fi
  fi
  say "  - Download Node.js $NODE_MAJOR from nodejs.org into $NODE_DIR (SHASUMS256 checked, no admin; lean-agents uses it only to run itself)"
  if $dry_run; then
    say "Dry run: nothing was installed. Run again without --dry-run to choose; the installer then shows the full plan before changing anything."
    exit 0
  fi
  if $mac && [[ -z "$found" ]]; then
    if have brew; then
      if ask "Install Node.js with 'brew install node'?"; then brew install node && node_ok && return 0; fi
    elif [[ -r /dev/tty ]] && ask "Install Homebrew, then Node.js?"; then
      install_homebrew && brew install node && node_ok && return 0
    fi
  fi
  if $yes || ask "Download Node.js $NODE_MAJOR from nodejs.org into $NODE_DIR?"; then
    install_node_tarball
    use_private_node
    return 0
  fi
  die "Node.js 22.20+ is required for the engine. Install it from https://nodejs.org/ and run this again."
}

ensure_node
node_ok || die "Node.js 22.20 or newer is required (found $(node --version 2>/dev/null || echo none)). Update from https://nodejs.org/"

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

get() { get_from "$base" "$1" "$2"; }

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
