#!/usr/bin/env bash
# Installs OLD pins into a throwaway HOME with the real npm, runs --update with the current pins, and checks the
# old -> new line, the new versions on disk, `--doctor --json` (nothing behind) and a full --uninstall.
# Used by CI; safe locally because HOME and the npm prefix are temp directories.
set -euo pipefail

# `! cmd` never stops a set -e script, so negative checks go through this.
refute() { if "$@"; then echo "must not succeed: $*" >&2; exit 1; fi; }

work="$(mktemp -d)"
HOME="$(mktemp -d)"
export HOME
export XDG_CONFIG_HOME="$HOME/.config"
export NPM_CONFIG_PREFIX="$HOME/npm"
export PATH="$NPM_CONFIG_PREFIX/bin:$PATH"
unset XDG_CACHE_HOME XDG_DATA_HOME XDG_STATE_HOME
repo="$(cd "$(dirname "$0")/.." && pwd)"
# The pinned release tag of the lean-update skill does not exist before release; install it from this checkout.
export LEAN_AGENTS_SKILL_SOURCE="${LEAN_AGENTS_SKILL_SOURCE:-$repo}"
flags=(--yes --agents opencode-v1 --tools context-mode --privacy standard --lang en --profile none --ponytail-mode off --no-bun --no-gh --terminal none)
# What lean-agents leaves behind. Logs and caches that other CLIs write on their own, and the uninstall record and the Skills CLI lock file (checked below), do not count.
files() { find "$HOME" \( -path "$HOME/npm" -o -path "$HOME/.npm" -o -path "$HOME/.local" -o -path "$HOME/.cache" -o -path "$HOME/Library" \) -prune -o -type f ! -name 'state.uninstalled-*.json' ! -name '.skill-lock.json' -print | sort; }
files > "$work/before.txt"

# A copy of the repo whose core/pins.json lists the previous Context Mode release.
old="$work/old-src"
node -e "require('node:fs').cpSync(process.argv[1], process.argv[2], { recursive: true, filter: (p) => !/(^|[\\\\/])(node_modules|\.git)([\\\\/]|$)/.test(p) })" "$repo" "$old"
ln -s "$repo/node_modules" "$old/node_modules"
newv="$(node -p "require('$repo/core/pins.json').pins['context-mode'].version")"
cat > "$work/previous.cjs" <<'JS'
const { execFileSync } = require('node:child_process');
const [pin] = process.argv.slice(2);
const key = (v) => v.split('.').map(Number);
const lt = (a, b) => { const [x, y] = [key(a), key(b)]; for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i]; return false; };
const all = JSON.parse(execFileSync('npm', ['view', 'context-mode', 'versions', '--json'], { encoding: 'utf8' })).filter((v) => /^\d+\.\d+\.\d+$/.test(v));
console.log(all.filter((v) => lt(v, pin)).sort((a, b) => (lt(a, b) ? -1 : 1)).pop());
JS
oldv="$(node "$work/previous.cjs" "$newv")"
test -n "$oldv"
node -e "const fs=require('node:fs'),f=process.argv[1],j=JSON.parse(fs.readFileSync(f,'utf8'));j.pins['context-mode'].version=process.argv[2];fs.writeFileSync(f,JSON.stringify(j,null,2))" "$old/core/pins.json" "$oldv"

installed() { npm ls -g context-mode --depth=0 --json | node -p "JSON.parse(require('fs').readFileSync(0,'utf8')).dependencies['context-mode'].version"; }

node "$old/scripts/lean.mjs" --home "$HOME" "${flags[@]}" </dev/null 2>&1 | tee "$work/old-install.txt"
refute grep -qE '^ *! ' "$work/old-install.txt"
test "$(installed)" = "$oldv"
node "$repo/scripts/lean.mjs" --home "$HOME" --doctor --json --no-exec </dev/null > "$work/behind.json" 2>"$work/behind.err" || true
node -e "const d=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'));if(!d.behind.some(b=>b.tool==='context-mode'&&b.installed===process.argv[2]))throw new Error(JSON.stringify(d.behind))" "$work/behind.json" "$oldv"

node "$repo/scripts/lean.mjs" --home "$HOME" --update --yes </dev/null 2>&1 | tee "$work/update.txt"
refute grep -qE '^ *! ' "$work/update.txt"
grep -qF "context-mode: $oldv -> $newv" "$work/update.txt"
test "$(installed)" = "$newv"
test -f "$HOME/.agents/skills/lean-update/SKILL.md"
node "$repo/scripts/lean.mjs" --home "$HOME" --doctor --json --no-exec </dev/null > "$work/after.json" 2>"$work/after.err" || true
node -e "const d=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'));if(!d.ok||d.behind.length)throw new Error(JSON.stringify(d.behind))" "$work/after.json"

node "$repo/scripts/lean.mjs" --home "$HOME" --uninstall --yes </dev/null 2>&1 | tee "$work/uninstall.txt"
refute grep -qE '^ *! ' "$work/uninstall.txt"
files > "$work/after.txt"
diff "$work/before.txt" "$work/after.txt"
refute grep -qs lean-update "$HOME/.agents/.skill-lock.json"
refute test -e "$HOME/.agents/skills/lean-update"
echo "real-update: $oldv -> $newv OK"
