#!/usr/bin/env bash
# Orca status on OpenCode 1.x (issue #78), with the real OpenCode 1.19 TUI in a pseudo-terminal and a throwaway HOME.
# Orca itself is GUI-only and not installed: a fake plugin under Orca's managed name (same export shape) writes a
# marker line when OpenCode calls its factory, and a fake TUI plugin has Orca's id. Used by CI (Linux and Windows
# through Git Bash); safe locally (temp HOME). PY names the Python with a pty (pywinpty on Windows).
#   A: Orca's file alone            -> reported: does the TUI worker call it?
#   B: plus the installer's output  -> on Windows the shim must make the worker call it; elsewhere no shim is written
#   C: like A without the TUI entry -> reported, to show whether the id clash matters
set -euo pipefail

command -v opencode >/dev/null || { echo "opencode not on PATH" >&2; exit 1; }
HOME="$(mktemp -d)"
export HOME
repo="$(cd "$(dirname "$0")/.." && pwd)"
opencode --version

PY="${PY:-python3}"
case "$(uname -s)" in MINGW*|MSYS*|CYGWIN*) windows=yes ;; *) windows=no ;; esac
# Mixed form (C:/dir) for native programs on Windows; unchanged elsewhere.
native() { if [ "$windows" = yes ]; then cygpath -m "$1"; else printf '%s' "$1"; fi; }

# Fresh throwaway HOME for one case; OpenCode on Windows reads USERPROFILE, not HOME.
new_home() {
  HOME="$(mktemp -d)"
  export HOME
  if [ "$windows" = yes ]; then USERPROFILE="$(cygpath -w "$HOME")"; export USERPROFILE; fi
  XDG_CONFIG_HOME="$(native "$HOME")/.config"
  export XDG_CONFIG_HOME
  unset XDG_CACHE_HOME XDG_DATA_HOME XDG_STATE_HOME
}

install() {
  node "$repo/scripts/lean.mjs" --home "$(native "$HOME")" --yes --no-exec --no-tools --agents opencode-v1 --terminal orca \
    --privacy standard --lang en --profile anthropic-api </dev/null >"$HOME/install.txt" 2>&1 || { cat "$HOME/install.txt"; exit 1; }
}

# $1 = case name; $2 = yes to run the installer (Orca selected); $3 = yes to add Orca's TUI plugin entry. Prints the marker line count.
run_case() {
  local name="$1" inst="$2" tui="$3"
  new_home
  local dir="$XDG_CONFIG_HOME/opencode"
  mkdir -p "$dir/plugins" "$dir/orca-opencode-status-tui"
  # Orca's managed name, plus two probes with byte-identical content: one under another name (the issue's
  # finding: a copy loads) and one unrelated (does the worker load plugins from this dir at all?).
  cat > "$dir/plugins/orca-opencode-status.js" <<'JS'
import fs from 'node:fs';
// Same shape as Orca's generated file: a default export that is the factory itself when
// ORCA_OPENCODE_PLUGIN_API=v1 and an { id, server } object otherwise (Orca source, 2026-11).
const OrcaOpenCodeStatusPlugin = async () => {
  fs.appendFileSync(process.env.FAKE_ORCA_MARKER, `${import.meta.url.split('/').pop()} called main=${globalThis.Bun?.isMainThread} pid=${process.pid}\n`);
  return {};
};
export default process.env.ORCA_OPENCODE_PLUGIN_API === 'v1'
  ? OrcaOpenCodeStatusPlugin
  : { id: 'orca-opencode-status', server: OrcaOpenCodeStatusPlugin };
JS
  cp "$dir/plugins/orca-opencode-status.js" "$dir/plugins/copy-probe.js"
  cat > "$dir/plugins/control-probe.js" <<'JS'
import fs from 'node:fs';
export default async () => {
  fs.appendFileSync(process.env.FAKE_ORCA_MARKER, `control-probe.js called main=${globalThis.Bun?.isMainThread} pid=${process.pid}\n`);
  return {};
};
JS
  cat > "$dir/orca-opencode-status-tui/tui.js" <<'JS'
export default { id: 'orca-opencode-status', tui: async () => {} };
JS
  if [ "$tui" = yes ]; then
    local url="file://$dir/orca-opencode-status-tui/tui.js"
    case "$dir" in /*) ;; *) url="file:///$dir/orca-opencode-status-tui/tui.js" ;; esac
    printf '{ "plugin": ["%s"] }\n' "$url" > "$dir/tui.json"
  fi
  if [ "$inst" = yes ]; then install; fi
  FAKE_ORCA_MARKER="$(native "$HOME")/marker.txt"
  export FAKE_ORCA_MARKER
  : > "$HOME/marker.txt"
  if [ "$windows" = yes ]; then opencode debug paths >&2 || true; fi
  "$PY" "$repo/tests/real-opencode-tui.py" "$(native "$HOME")" >&2
  sed "s/^/  $name: /" "$HOME/marker.txt" >&2
  # Only Orca's managed name counts; the probes are diagnostics.
  { grep -c '^orca-opencode-status.js ' "$HOME/marker.txt" || true; } | tr -d ' '
}

a="$(run_case A no yes)"
b="$(run_case B yes yes)"
c="$(run_case C no no)"
echo "marker lines: A (no shim) = $a, B (installer) = $b, C (no TUI entry, no shim) = $c"

# Install and uninstall once more in a clean HOME for the file checks.
new_home
install
shim="$XDG_CONFIG_HOME/opencode/plugins/lean-orca-status-shim.js"
if [ "$windows" = yes ]; then
  test -f "$shim" || { echo "the installer did not write the shim on Windows" >&2; exit 1; }
  [ "$b" -ge 1 ] || { echo "B: the shim did not make the TUI call Orca's plugin" >&2; exit 1; }
else
  if test -e "$shim"; then echo "the shim must be Windows-only" >&2; exit 1; fi
  [ "$b" -le 1 ] || { echo "B: Orca's plugin ran twice without a shim" >&2; exit 1; }
fi
node "$repo/scripts/lean.mjs" --home "$(native "$HOME")" --uninstall --yes --no-exec </dev/null >/dev/null 2>&1
if test -e "$shim"; then echo "uninstall left the shim" >&2; exit 1; fi
echo "real-orca-opencode-v1: OK"
