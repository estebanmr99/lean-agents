#!/usr/bin/env bash
# Installs lean-agents into a throwaway HOME and asks the real OpenCode 2 binary
# what it resolved, to prove every key lean-agents writes is accepted and loaded.
# Used by CI; safe to run locally because HOME is a temp directory.
set -euo pipefail

command -v opencode >/dev/null || { echo "opencode not on PATH" >&2; exit 1; }
opencode --version

HOME="$(mktemp -d)"
export HOME
export XDG_CONFIG_HOME="$HOME/.config"
repo="$(cd "$(dirname "$0")/.." && pwd)"

bash "$repo/install.sh" --yes --no-exec --agents opencode-v2 \
  --tools serena,playwright,ponytail --privacy strict --profile anthropic-api

opencode debug config > "$HOME/resolved.txt" 2>&1 || { cat "$HOME/resolved.txt"; exit 1; }

node --input-type=module - "$HOME/resolved.txt" "$repo" <<'JS'
import fs from 'node:fs';
const out = fs.readFileSync(process.argv[2], 'utf8');
const { firstJsonObject } = await import(`${process.argv[3]}/scripts/lib/doctor.mjs`);
let cfg;
try { cfg = firstJsonObject(out); } catch (e) { console.log(out); throw e; }
const servers = cfg.mcp?.servers ?? cfg.mcp ?? {};
const checks = {
  'rules in instructions': (cfg.instructions ?? []).some((i) => String(i).includes('lean-agents')),
  'mcp serena': !!servers.serena,
  'mcp playwright': !!servers.playwright,
  'mcp context-mode': !!servers['context-mode'],
  'plan model': cfg.agent?.plan?.model === 'anthropic/claude-opus-5-5',
  'subagent explore': !!cfg.agent?.explore,
  'default_agent plan': cfg.default_agent === 'plan',
  'share disabled': cfg.share === 'disabled',
};
let failed = false;
for (const [name, ok] of Object.entries(checks)) {
  console.log(`${ok ? 'ok    ' : 'FAIL  '} ${name}`);
  if (!ok) failed = true;
}
console.log('compaction:', JSON.stringify(cfg.compaction ?? null));
console.log('top-level keys:', Object.keys(cfg).sort().join(', '));
if (failed) process.exit(1);
JS
