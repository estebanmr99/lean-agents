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
  out="$(cd "$work/cwd" && LEAN_AGENTS_DIST="$d" bash -s -- "$@" < "$boot" 2>&1)" || rc=$?
}
sha() { node -e 'const h=process.getBuiltinModule("node:crypto").createHash("sha256");h.update(process.getBuiltinModule("node:fs").readFileSync(process.argv[1]));console.log(h.digest("hex"))' "$1"; }
tgz="$(basename "$(find "$dist" -maxdepth 1 -name 'lean-agents-*.tgz' | head -n 1)")"
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

echo "--- (i) a git clone in src is replaced only when clean"
new_home
srcdir="$HOME/.config/lean-agents/src"
mkdir -p "$srcdir/scripts"
echo "// old" > "$srcdir/scripts/lean.mjs"
git -C "$srcdir" init -q
boot_run "$dist" "${flags[@]}"
[[ "$rc" == 1 && "$out" == *"local changes"* ]] || fail "dirty clone: $rc $out"
[[ -d "$srcdir/.git" && "$(cat "$srcdir/scripts/lean.mjs")" == "// old" ]] || fail "dirty clone was modified"
git -C "$srcdir" add -A
git -C "$srcdir" -c user.name=t -c user.email=t@t commit -q -m old
boot_run "$dist" "${flags[@]}"
[[ "$rc" == 1 && "$out" == *"no upstream"* && -d "$srcdir/.git" ]] || fail "clone without upstream: $rc $out"
git init -q --bare "$work/remote-i.git"
git -C "$srcdir" remote add origin "$work/remote-i.git"
git -C "$srcdir" push -q -u origin HEAD 2>/dev/null
boot_run "$dist" "${flags[@]}"
[[ "$rc" == 0 && ! -e "$srcdir/.git" && -f "$srcdir/.lean-agents-release" ]] || fail "clean clone was not replaced: $rc $out"

echo "--- (i2) a clone with unpushed work, or at LEAN_AGENTS_SRC, is never deleted"
gitc() { git -c user.name=t -c user.email=t@t "$@"; }
# make_clone <dir>: a pushed, clean clone of a local bare remote with an old scripts/lean.mjs.
make_clone() {
  local r="$work/remote.git"
  rm -rf "$r"
  git init -q --bare "$r"
  git clone -q "$r" "$1" 2>/dev/null
  mkdir -p "$1/scripts"
  echo "// old" > "$1/scripts/lean.mjs"
  git -C "$1" checkout -q -b main
  git -C "$1" add -A
  gitc -C "$1" commit -q -m old
  git -C "$1" push -q -u origin main
}
# expect_kept <label> <reason>: the install stopped, said why, and left the clone and its commit.
expect_kept() {
  [[ "$rc" == 1 && "$out" == *"left alone ($2)"* && "$out" == *"Move it away"* ]] || fail "$1: $rc $out"
  [[ "$(git -C "$srcdir" rev-parse HEAD)" == "$head" && "$(cat "$srcdir/scripts/lean.mjs")" == "// old" ]] || fail "$1: the clone changed"
}
for c in unpushed noupstream stash branch env; do
  new_home
  srcdir="$HOME/.config/lean-agents/src"
  make_clone "$srcdir"
  case "$c" in
    unpushed) echo new > "$srcdir/new"; git -C "$srcdir" add -A; gitc -C "$srcdir" commit -q -m unpushed
      head="$(git -C "$srcdir" rev-parse HEAD)"; boot_run "$dist" "${flags[@]}"; expect_kept "$c" "it has commits that are not pushed" ;;
    noupstream) git -C "$srcdir" branch -q --unset-upstream
      head="$(git -C "$srcdir" rev-parse HEAD)"; boot_run "$dist" "${flags[@]}"; expect_kept "$c" "it has no upstream branch" ;;
    stash) echo "// changed" > "$srcdir/scripts/lean.mjs"; gitc -C "$srcdir" stash -q
      head="$(git -C "$srcdir" rev-parse HEAD)"; boot_run "$dist" "${flags[@]}"; expect_kept "$c" "it has a stash" ;;
    branch) git -C "$srcdir" branch -q extra
      head="$(git -C "$srcdir" rev-parse HEAD)"; boot_run "$dist" "${flags[@]}"; expect_kept "$c" "it has more than one local branch" ;;
    env) head="$(git -C "$srcdir" rev-parse HEAD)"; LEAN_AGENTS_SRC="$srcdir" boot_run "$dist" "${flags[@]}"
      expect_kept "$c" "LEAN_AGENTS_SRC points at a git clone" ;;
  esac
done
new_home
srcdir="$HOME/.config/lean-agents/src"
make_clone "$srcdir"
boot_run "$dist" "${flags[@]}"
[[ "$rc" == 0 && ! -e "$srcdir/.git" && -f "$srcdir/.lean-agents-release" ]] || fail "clean pushed clone was not replaced: $rc $out"
boot_run "$dist" "${flags[@]}"
[[ "$rc" == 0 && "$out" == *"already installed"* ]] || fail "reinstall over an installer-made src: $rc $out"

echo "--- (j) a checkout reinstalls its dependencies when package-lock.json changes"
new_home
co="$work/checkout"
mkdir -p "$co"
cp -R "$repo/scripts" "$repo/core" "$repo/profiles" "$repo/package.json" "$repo/package-lock.json" "$repo/install.sh" "$co/"
run_co() { rc=0; out="$(cd "$co" && bash "$co/install.sh" --dry-run "${flags[@]}" 2>&1)" || rc=$?; }
run_co
[[ "$rc" == 0 ]] || fail "checkout run exited $rc: $out"
[[ "$(cat "$co/node_modules/.lean-agents-lock")" == "$(sha "$co/package-lock.json")" ]] || fail "lock stamp missing or wrong"
touch "$co/node_modules/marker"
run_co
[[ "$rc" == 0 && -e "$co/node_modules/marker" ]] || fail "unchanged lockfile reinstalled: $rc $out"
echo >> "$co/package-lock.json"
run_co
[[ "$rc" == 0 && ! -e "$co/node_modules/marker" ]] || fail "changed lockfile did not reinstall: $rc $out"
[[ "$(cat "$co/node_modules/.lean-agents-lock")" == "$(sha "$co/package-lock.json")" ]] || fail "lock stamp not updated"

echo "real-bootstrap: all cases passed"
