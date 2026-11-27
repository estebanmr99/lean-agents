#!/usr/bin/env bash
# CI proof for #546: a Claude plugin pin moves between two installs, --update moves lean-agents' own
# extraKnownMarketplaces ref in settings.json instead of failing, keeps the plugin data, and --uninstall leaves no
# entry at the moved ref. Real `claude`, throwaway HOME, old pins in a repo copy (the tests/real-update.sh pattern).
set -euo pipefail

refute() { if "$@"; then echo "must not succeed: $*" >&2; exit 1; fi; }

work="$(mktemp -d)"
HOME="$(mktemp -d)"
export HOME
repo="$(cd "$(dirname "$0")/.." && pwd)"
oldv=v2.1.4
oldsha=10a2e677f7605ef8f16dedb37648ead8889addee
newv="$(node -p "require('$repo/core/pins.json').pins['context-mode-plugin'].version")"
test "$oldv" != "$newv"

old="$work/old-src"
node -e "require('node:fs').cpSync(process.argv[1], process.argv[2], { recursive: true, filter: (p) => !/(^|[\\\\/])(node_modules|\.git)([\\\\/]|$)/.test(p) })" "$repo" "$old"
ln -s "$repo/node_modules" "$old/node_modules"
node -e "const fs=require('node:fs'),f=process.argv[1],j=JSON.parse(fs.readFileSync(f,'utf8')),p=j.pins['context-mode-plugin'];p.version=process.argv[2];p.sha=process.argv[3];fs.writeFileSync(f,JSON.stringify(j,null,2))" "$old/core/pins.json" "$oldv" "$oldsha"

flags=(--yes --agents claude --tools context-mode --privacy standard --lang en --profile none --ponytail-mode off --no-bun --no-gh --terminal none)
node "$old/scripts/lean.mjs" --home "$HOME" "${flags[@]}" </dev/null 2>&1 | tee "$work/old-install.txt"
refute grep -qE '^ *! ' "$work/old-install.txt"

ref() { node -p "JSON.parse(require('fs').readFileSync(process.env.HOME + '/.claude/settings.json', 'utf8')).extraKnownMarketplaces['context-mode'].source.ref"; }
version() { node -e "const j=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'));const p=j.find((x)=>x.id==='context-mode@context-mode');if(!p)throw new Error('no context-mode plugin');console.log(p.version.replace(/^v/,''))" "$1"; }
test "$(ref)" = "$oldv"
claude plugin list --json > "$work/list-old.json"
test "$(version "$work/list-old.json")" = "${oldv#v}"

# Data the plugin saved before the pin moved: an update must keep it (only `marketplace remove` deletes it).
data="$HOME/.claude/plugins/data/context-mode@context-mode"
mkdir -p "$data"
printf 'keep me\n' > "$data/sentinel"

node "$repo/scripts/lean.mjs" --home "$HOME" --update --yes </dev/null 2>&1 | tee "$work/update.txt"
refute grep -qE '^ *! ' "$work/update.txt"
grep -qF "context-mode marketplace ref $oldv -> $newv" "$work/update.txt"
refute grep -qF 'marketplace remove' "$work/update.txt"
test "$(ref)" = "$newv"
claude plugin list --json > "$work/list-new.json"
test "$(version "$work/list-new.json")" = "${newv#v}"
test -f "$data/sentinel"

node "$repo/scripts/lean.mjs" --home "$HOME" --uninstall --yes </dev/null 2>&1 | tee "$work/uninstall.txt"
refute grep -qE '^ *! ' "$work/uninstall.txt"
# The entry is back to the pre-update ref (or gone); never left at the moved pin.
node -e "const fs=require('node:fs'),f=process.env.HOME+'/.claude/settings.json';const s=JSON.parse(fs.readFileSync(f,'utf8'));const e=s.extraKnownMarketplaces&&s.extraKnownMarketplaces['context-mode'];if(e&&e.source&&e.source.ref===process.argv[1])throw new Error('left at the moved ref '+process.argv[1])" "$newv"
echo "real-claude-plugin-move: $oldv -> $newv OK"