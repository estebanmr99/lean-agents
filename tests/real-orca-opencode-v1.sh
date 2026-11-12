#!/usr/bin/env bash
# Orca status on OpenCode 1.x (issue #78), with the real OpenCode 1.19 TUI in a pseudo-terminal and a throwaway HOME.
# Orca itself is GUI-only and not installed: a fake plugin under Orca's managed name (same export) writes a marker
# line when OpenCode calls its factory, and a fake TUI plugin has Orca's id. Used by CI; safe locally (temp HOME).
#   A: Orca's file alone            -> the TUI worker must NOT call it (the bug)
#   B: plus the installer's shim    -> it must be called
#   C: like A without the TUI entry -> recorded only, to show whether the id clash matters
set -euo pipefail

command -v opencode >/dev/null || { echo "opencode not on PATH" >&2; exit 1; }
HOME="$(mktemp -d)"
export HOME
repo="$(cd "$(dirname "$0")/.." && pwd)"
opencode --version

# $1 = case name; $2 = yes to add the installer's shim; $3 = yes to add Orca's TUI plugin entry. Prints the marker line count.
run_case() {
  local name="$1" shim="$2" tui="$3"
  HOME="$(mktemp -d)"
  export HOME
  export XDG_CONFIG_HOME="$HOME/.config"
  unset XDG_CACHE_HOME XDG_DATA_HOME XDG_STATE_HOME
  local dir="$XDG_CONFIG_HOME/opencode"
  mkdir -p "$dir/plugins" "$dir/orca-opencode-status-tui"
  cat > "$dir/plugins/orca-opencode-status.js" <<'JS'
import fs from 'node:fs';
// Same shape as Orca's generated file: a named factory, and a default export that is the factory itself
// when ORCA_OPENCODE_PLUGIN_API=v1 and an { id, server } object otherwise (Orca source, 2026-11).
const OrcaOpenCodeStatusPlugin = async () => {
  fs.appendFileSync(process.env.FAKE_ORCA_MARKER, `factory called main=${globalThis.Bun?.isMainThread} pid=${process.pid}\n`);
  return {};
};
export default process.env.ORCA_OPENCODE_PLUGIN_API === 'v1'
  ? OrcaOpenCodeStatusPlugin
  : { id: 'orca-opencode-status', server: OrcaOpenCodeStatusPlugin };
JS
  cat > "$dir/orca-opencode-status-tui/tui.js" <<'JS'
export default { id: 'orca-opencode-status', tui: async () => {} };
JS
  if [ "$tui" = yes ]; then
    printf '{ "plugin": ["file://%s/orca-opencode-status-tui/tui.js"] }\n' "$dir" > "$dir/tui.json"
  fi
  if [ "$shim" = yes ]; then
    # The shim comes from the installer, so a change to it is what this case tests.
    node "$repo/scripts/lean.mjs" --home "$HOME" --yes --no-exec --no-tools --agents opencode-v1 --terminal orca \
      --privacy standard --lang en --profile anthropic-api </dev/null >"$HOME/install.txt" 2>&1 || { cat "$HOME/install.txt"; exit 1; }
    test -f "$dir/plugins/lean-orca-status-shim.js"
  fi
  export FAKE_ORCA_MARKER="$HOME/marker.txt"
  : > "$FAKE_ORCA_MARKER"
  python3 "$repo/tests/real-opencode-tui.py" "$HOME" >&2
  sed "s/^/  $name: /" "$FAKE_ORCA_MARKER" >&2
  wc -l < "$FAKE_ORCA_MARKER" | tr -d ' '
}

a="$(run_case A no yes)"
b="$(run_case B yes yes)"
c="$(run_case C no no)"
echo "marker lines: A (no shim) = $a, B (shim) = $b, C (no TUI entry, no shim) = $c"
[ "$a" -eq 0 ] || { echo "A: the TUI called Orca's plugin without the shim; the bug did not reproduce" >&2; exit 1; }
[ "$b" -ge 1 ] || { echo "B: the shim did not make the TUI call Orca's plugin" >&2; exit 1; }

# Uninstall removes the shim (B's HOME is the last one with a shim, so redo it quickly).
HOME="$(mktemp -d)"; export HOME XDG_CONFIG_HOME="$HOME/.config"
node "$repo/scripts/lean.mjs" --home "$HOME" --yes --no-exec --no-tools --agents opencode-v1 --terminal orca --privacy standard --lang en --profile anthropic-api </dev/null >/dev/null 2>&1
test -f "$XDG_CONFIG_HOME/opencode/plugins/lean-orca-status-shim.js"
node "$repo/scripts/lean.mjs" --home "$HOME" --uninstall --yes --no-exec </dev/null >/dev/null 2>&1
if test -e "$XDG_CONFIG_HOME/opencode/plugins/lean-orca-status-shim.js"; then echo "uninstall left the shim" >&2; exit 1; fi
echo "real-orca-opencode-v1: OK"
