#!/usr/bin/env bash
# #106: --adopt on a hand-built HOME with real nvm (Node 22.20 first on PATH and default, Node 24 installed), real npm, real Context Mode.
# Dry run changes nothing -> --adopt --yes --confirm-removals -> doctor ok, initialize ok with Node 22 first on PATH, sessions and user files equal
# -> --adopt --undo restores every file byte for byte. Throwaway HOME and NVM_DIR; never run it on a machine that has its own nvm.
# CI: ubuntu (nvm.sh from tests/ci-downloads.json, NVM_SH points at it) and windows (real-tool-node.ps1 with TOOL_NODE_TEST=real-adopt.sh sets NVM_HOME).
# OpenCode itself is not started: the session count comes from a seeded 1.x-shaped database (the fixture), read through a copy.
set -euo pipefail

repo="$(cd "$(dirname "$0")/.." && pwd)"
case "$(uname -s)" in Linux|Darwin) os=linux ;; *) os=windows ;; esac
HOME="$(mktemp -d)"
export HOME
T="$HOME"
unset XDG_CACHE_HOME XDG_DATA_HOME XDG_STATE_HOME
export XDG_CONFIG_HOME="$HOME/.config"
fail() { echo "FAIL: $*" >&2; exit 1; }
native() { if [ "$os" = windows ]; then cygpath -w "$1"; else printf '%s\n' "$1"; fi; }

home="$HOME"
if [ "$os" = windows ]; then
  home="$(cygpath -w "$HOME")"
  win_t="$(cygpath -w "$T")"
  export USERPROFILE="$home" npm_config_prefix="$win_t\\npm" npm_config_cache="$win_t\\cache"
  export PATH="$T/npm:$PATH"
else
  export npm_config_prefix="$T/npm" npm_config_cache="$T/cache"
  export PATH="$T/npm/bin:$PATH"
fi

if [ "$os" = linux ]; then
  [ -n "${NVM_SH:-}" ] || fail "NVM_SH (the pinned nvm.sh) is not set"
  export NVM_DIR="$T/nvm"
  mkdir -p "$NVM_DIR"
  cp "$NVM_SH" "$NVM_DIR/nvm.sh"
  (
    unset npm_config_prefix NPM_CONFIG_PREFIX
    set +eu
    # shellcheck source=/dev/null
    . "$NVM_DIR/nvm.sh" --no-use
    nvm install 22.20.0
    nvm install 24.22.2
  )
  export PATH="$NVM_DIR/versions/node/v22.20.0/bin:$PATH"
  versions="$NVM_DIR/versions/node"
  link="$NVM_DIR/current"
else
  [ -n "${NVM_HOME:-}" ] || fail "NVM_HOME (set by real-tool-node.ps1) is not set"
  versions="$(cygpath -u "$NVM_HOME")"
  link="$T/node-current"
  NVM_SYMLINK="$(native "$link")"; export NVM_SYMLINK
fi
case "$(node -p process.version)" in v22.*) ;; *) fail "the old Node is not first on PATH: $(node -p process.version)" ;; esac
n24="$(for d in "$versions"/v24.*; do if [ -e "$d" ]; then echo "$d"; break; fi; done)"
[ -n "$n24" ] || fail "no Node 24 under $versions"

lean() { node "$repo/scripts/lean.mjs" --home "$home" --no-gh --no-bun "$@"; }
fixture="$repo/tests/fixtures/handbuilt.mjs"
seed_win=posix
if [ "$os" = windows ]; then seed_win=win; fi
seed_json="$(node "$fixture" "$home" "$(native "$versions/v22.20.0")" 22.20.0 "$(native "$n24")" "$(basename "$n24" | cut -c2-)" "$(native "$link")" "$seed_win")"
echo "seeded: $seed_json"
out="$(mktemp -d)" # outside HOME

# What the user owns and lean-agents may never change: every config folder and file except nvm and npm's own trees.
user_hash() {
  node --input-type=module - "$home" "$(native "$repo")" <<'JS'
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
const [home, repo] = process.argv.slice(2);
const { treeHash } = await import(pathToFileURL(path.join(repo, 'tests', 'fixtures', 'handbuilt.mjs')).href);
const h = createHash('sha256');
for (const d of ['.claude', '.agents', '.config/opencode', '.local']) { const p = path.join(home, d); if (fs.existsSync(p)) h.update(`${d}\0${treeHash(p)}`); }
h.update(fs.readFileSync(path.join(home, '.claude.json')));
console.log(h.digest('hex'));
JS
}

echo "--- dry run changes nothing"
before="$(user_hash)"
lean --adopt --no-exec > "$out/dry.txt" || fail "--adopt dry run failed"
lean --adopt --yes --dry-run --no-exec > /dev/null || fail "--adopt --yes --dry-run failed"
[ "$(user_hash)" = "$before" ] || fail "the dry run changed the HOME"
[ ! -e "$HOME/.config/lean-agents" ] || fail "the dry run created the state folder"

echo "--- --upgrade-agent opencode --dry-run --json: classifies the 1.x keys, changes nothing, prints no values"
lean --upgrade-agent opencode --dry-run --json --no-exec > "$out/upgrade.json" || fail "--upgrade-agent opencode --dry-run --json failed"
node --input-type=module - "$out/upgrade.json" <<'JS' || fail "the upgrade dry run misclassified the fixture"
import fs from 'node:fs';
const r = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const cls = (name) => r.items.find((i) => i.upgrade && i.name === name)?.upgrade.class;
const want = [['agent.reviewer', 'user-translatable'], ['compaction.reserved', 'user-translatable'], ['autoupdate', 'user-translatable'], ['keybinds', 'user-manual'], ['plugins/rtk.ts', 'user-manual'], ['agent/lean.md', 'managed']];
const bad = want.filter(([n, c]) => cls(n) !== c);
for (const [n, c] of bad) console.log(`FAIL  ${n}: ${cls(n)} (want ${c})`);
if (r.upgrade.from !== 'opencode-v1' || !r.upgrade.counts.managed) bad.push(['counts']);
process.exit(bad.length ? 1 : 0);
JS
! grep -qE 'relay-(env|header)-secret|hook-arg-secret' "$out/upgrade.json" || fail "the upgrade dry run printed a secret"
[ "$(user_hash)" = "$before" ] || fail "the upgrade dry run changed the HOME"
[ ! -e "$HOME/.config/lean-agents" ] || fail "the upgrade dry run created the state folder"
settings_before="$(cat "$HOME/.claude/settings.json")"
rtk_before="$(cat "$HOME/.config/opencode/plugins/rtk.ts")"

echo "--- --adopt --yes --confirm-removals: backup, edits, verify (initialize, user files, sessions), doctor"
lean --adopt --yes --confirm-removals --keep-backup | tee "$out/apply.txt" || fail "--adopt --yes failed (see above)"
grep -q 'initialize claude context-mode' "$out/apply.txt" || fail "no initialize check ran"
node --input-type=module - "$home/.claude.json" "$(native "$repo")" "$seed_json" "$home" <<'JS'
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const [file, repo, seedJson, home] = process.argv.slice(2);
const lib = (f) => import(pathToFileURL(path.join(repo, 'scripts', 'lib', f)).href);
const { probeInitialize } = await lib('inventory.mjs');
const { opencodeInfo } = await lib('adopt.mjs');
const servers = JSON.parse(fs.readFileSync(file, 'utf8')).mcpServers;
let bad = 0;
for (const name of ['context-mode', 'ctx-link']) {
  const e = servers[name];
  const argv = [e.command, ...(e.args ?? [])];
  if (!/v24\./.test(e.command)) { console.log(`FAIL  ${name} is not on Node 24: ${e.command}`); bad++; continue; }
  const r = await probeInitialize(argv, { expect: 'context-mode' }); // Node 22.20 leads PATH here
  console.log(`${r.ok ? 'ok    ' : 'FAIL  '} ${name} initialize ${r.name ?? r.error}`);
  if (!r.ok) bad++;
}
if (servers.relay.command !== 'node') { console.log('FAIL  the user relay MCP changed'); bad++; }
const seed = JSON.parse(seedJson);
const oc = await opencodeInfo(home, process.env);
console.log(`sessions ${oc.sessions} (seeded ${seed.sessions})`);
if (seed.sessions === null || oc.sessions !== seed.sessions) { console.log('FAIL  sessions not seeded or changed'); bad++; }
process.exit(bad ? 1 : 0);
JS
lean --doctor --no-exec > "$out/doctor.txt" || { cat "$out/doctor.txt"; fail "--doctor reports problems after --adopt"; }
[ "$(cat "$HOME/.claude/settings.json")" = "$settings_before" ] || fail "settings.json (the user's hooks and keys) changed"
[ "$(cat "$HOME/.config/opencode/plugins/rtk.ts")" = "$rtk_before" ] || fail "the user plugin rtk.ts changed"
[ ! -e "$HOME/.agents/skills/dup-demo" ] || fail "the duplicate skill was not removed"
[ -e "$HOME/.claude/skills/dup-demo/SKILL.md" ] || fail "the kept skill copy is gone"
[ -e "$HOME/.local/bin/copilot-usage" ] || fail "the stopgap was removed although its replacement is not installed"
[ -e "$n24/lib/node_modules/context-mode/cli.mjs" ] || [ -e "$n24/node_modules/context-mode/cli.mjs" ] || fail "context-mode is not in Node 24's prefix"

echo "--- --adopt --undo restores every byte"
lean --adopt --undo | tee "$out/undo.txt" || fail "--adopt --undo failed"
[ "$(user_hash)" = "$before" ] || fail "--adopt --undo did not restore the HOME byte for byte"
[ ! -e "$HOME/.config/lean-agents" ] || fail "undo left the state folder"
echo "real-adopt: ok"
