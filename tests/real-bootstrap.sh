#!/usr/bin/env bash
# Runs install.sh piped into bash (the way `curl | bash` does) against a packed release folder (dist/,
# built by scripts/release.mjs) in throwaway HOME folders, with no external commands (--no-exec).
# Used by CI; safe locally. Usage: bash tests/real-bootstrap.sh [dist-dir]
set -euo pipefail

HOME="$(mktemp -d)"
export HOME

# `! cmd` never stops a set -e script, so negative checks go through this.
refute() { if "$@"; then echo "must not succeed: $*" >&2; exit 1; fi; }
fail() { echo "FAIL: $*" >&2; exit 1; }

repo="$(cd "$(dirname "$0")/.." && pwd)"
dist="$(cd "${1:-$repo/dist}" && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
boot="$dist/install.sh"
unset XDG_CONFIG_HOME LEAN_AGENTS_SRC LEAN_AGENTS_VERSION
flags=(--yes --agents claude --no-tools --privacy standard --lang en --no-exec)

new_home() { HOME="$(mktemp -d "$work/home.XXXXXX")"; export HOME; }
# boot_run <dist> <args...>: output in $out, exit code in $rc. Runs from $work/cwd, which holds no lean-agents.
boot_run() {
  local d="$1"; shift
  mkdir -p "$work/cwd"
  rc=0
  out="$(cd "$work/cwd" && cat "$boot" | LEAN_AGENTS_DIST="$d" bash -s -- "$@" 2>&1)" || rc=$?
}
sha() { node -e 'const h=process.getBuiltinModule("node:crypto").createHash("sha256");h.update(process.getBuiltinModule("node:fs").readFileSync(process.argv[1]));console.log(h.digest("hex"))' "$1"; }
tgz="$(cd "$dist" && ls lean-agents-*.tgz | head -n 1)"
src_stamp() { cat "$HOME/.config/lean-agents/src/.lean-agents-release"; }

echo "--- (a) a scripts/lean.mjs in the current directory never runs"
new_home
mkdir -p "$work/cwd/scripts"
echo "require('node:fs').writeFileSync(process.env.HOME + '/planted-ran', '1')" > "$work/cwd/scripts/lean.mjs"
boot_run "$dist" --dry-run "${flags[@]}"
[[ "$rc" == 0 ]] || fail "dry run exited $rc: $out"
[[ ! -e "$HOME/planted-ran" ]] || fail "the planted scripts/lean.mjs ran"
rm -rf "$work/cwd"

echo "--- (b) a dry run without an install leaves HOME empty"
new_home
boot_run "$dist" --dry-run "${flags[@]}"
[[ "$rc" == 0 ]] || fail "dry run exited $rc: $out"
[[ -z "$(ls -A "$HOME")" ]] || fail "dry run wrote to HOME: $(ls -A "$HOME")"

echo "--- (c) install writes the stamp; the rerun says already installed"
new_home
boot_run "$dist" "${flags[@]}"
[[ "$rc" == 0 ]] || fail "install exited $rc: $out"
[[ "$(src_stamp)" == "$(sha "$dist/$tgz")" ]] || fail "stamp is not the tarball sha256"
[[ -f "$HOME/.config/lean-agents/src/scripts/lean.mjs" ]] || fail "engine not extracted"
boot_run "$dist" "${flags[@]}"
[[ "$rc" == 0 && "$out" == *"already installed"* ]] || fail "rerun did not say already installed: $out"

echo "--- (d) installed: --dry-run, --doctor and --uninstall need no network"
boot_run "$work/missing" --dry-run "${flags[@]}"
[[ "$rc" == 0 && "$out" != *"LEAN_AGENTS_DIST is set"* ]] || fail "offline dry run: $rc $out"
boot_run "$work/missing" --doctor --no-exec
[[ "$rc" == 0 ]] || fail "offline doctor exited $rc: $out"
boot_run "$work/missing" --uninstall --yes --no-exec
[[ "$rc" == 0 ]] || fail "offline uninstall exited $rc: $out"

echo "--- (e) a repacked tarball with new SHA256SUMS reinstalls"
new_home
boot_run "$dist" "${flags[@]}"
[[ "$rc" == 0 ]] || fail "install exited $rc: $out"
old="$(src_stamp)"
re="$work/repack"
mkdir -p "$re"
cp "$dist"/* "$re/"
gunzip -c "$dist/$tgz" | gzip -1 > "$re/$tgz"
newsum="$(sha "$re/$tgz")"
[[ "$newsum" != "$old" ]] || fail "repack produced the same tarball"
sed "s/^$old/$newsum/" "$dist/SHA256SUMS" > "$re/SHA256SUMS"
boot_run "$re" "${flags[@]}"
[[ "$rc" == 0 && "$out" != *"already installed"* ]] || fail "repack was not reinstalled: $rc $out"
[[ "$(src_stamp)" == "$newsum" ]] || fail "stamp was not updated"

echo "--- (f) a bad checksum exits 1 and leaves src untouched"
bad="$work/bad"
mkdir -p "$bad"
cp "$dist"/* "$bad/"
sed "s/^[0-9a-f]\{64\}  lean-agents-/$(printf '0%.0s' $(seq 64))  lean-agents-/" "$dist/SHA256SUMS" > "$bad/SHA256SUMS"
before="$(src_stamp)"
boot_run "$bad" "${flags[@]}"
[[ "$rc" == 1 && "$out" == *"checksum mismatch"* ]] || fail "bad sum: $rc $out"
[[ "$(src_stamp)" == "$before" && ! -e "$HOME/.config/lean-agents/src.new" ]] || fail "src changed after a bad checksum"

echo "--- (g) LEAN_AGENTS_DIST prints a warning"
new_home
boot_run "$dist" --dry-run "${flags[@]}"
[[ "$out" == *"LEAN_AGENTS_DIST is set"* ]] || fail "no override warning: $out"

echo "--- (h) a foreign src folder is refused"
new_home
mkdir -p "$HOME/.config/lean-agents/src"
echo keep > "$HOME/.config/lean-agents/src/keep"
boot_run "$dist" "${flags[@]}"
[[ "$rc" == 1 && "$out" == *"not a lean-agents install"* ]] || fail "foreign src: $rc $out"
[[ "$(cat "$HOME/.config/lean-agents/src/keep")" == keep ]] || fail "foreign src was modified"

echo "real-bootstrap: all cases passed"
