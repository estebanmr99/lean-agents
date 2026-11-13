#!/usr/bin/env bash
# Installs lean-agents into a throwaway HOME and asks the real OpenCode 2 binary
# what it resolved, to prove every key lean-agents writes is accepted and loaded.
# Used by CI; safe to run locally because HOME is a temp directory.
set -euo pipefail

command -v opencode >/dev/null || { echo "opencode not on PATH" >&2; exit 1; }

HOME="$(mktemp -d)"
export HOME
export XDG_CONFIG_HOME="$HOME/.config"
unset XDG_CACHE_HOME XDG_DATA_HOME XDG_STATE_HOME
opencode --version
repo="$(cd "$(dirname "$0")/.." && pwd)"

bash "$repo/install.sh" --yes --no-exec --agents opencode-v2 \
  --tools serena,playwright,playwright-extension,ponytail --privacy strict --profile anthropic-api

# Proves the file name the migration guide gives for the old tui.json.
LC_ALL=C grep -aq 'opencode/cli.json' "$(command -v opencode)"

opencode debug config > "$HOME/resolved.txt" 2>"$HOME/stderr.txt" || { cat "$HOME/resolved.txt" "$HOME/stderr.txt"; exit 1; }

opencode debug agents > "$HOME/agents.txt" 2>&1 || true
node --input-type=module - "$HOME/resolved.txt" "$repo" "$HOME/agents.txt" <<'JS'
import fs from 'node:fs';
const out = fs.readFileSync(process.argv[2], 'utf8');
const agentsOut = fs.readFileSync(process.argv[4], 'utf8');
const { resolvedOpenCodeConfig } = await import(`${process.argv[3]}/scripts/lib/doctor.mjs`);
const { satisfies } = await import(`${process.argv[3]}/scripts/lib/node-runtime.mjs`);
const { npmSpec, nodeRange } = await import(`${process.argv[3]}/scripts/lib/pins.mjs`);
let cfg;
try { cfg = resolvedOpenCodeConfig(out); } catch (e) { console.log(out); throw e; }
const servers = cfg.mcp?.servers ?? cfg.mcp ?? {};
const checks = {
  'rules in instructions': (cfg.instructions ?? []).some((i) => String(i).includes('lean-agents')),
  'mcp serena': !!servers.serena,
  'mcp playwright': !!servers.playwright,
  'mcp playwright-extension': (servers['playwright-extension']?.command ?? []).includes('--extension'),
  'mcp context-mode': !!servers['context-mode'] || !satisfies(process.versions.node, nodeRange('context-mode')), // skipped on a Node below the pin's range
  'plan model': JSON.stringify(cfg.agents?.plan?.model ?? null).includes('claude-opus-5-5'),
  'subagents loaded': ['explore', 'research', 'review', 'debug', 'planner'].every((a) => agentsOut.includes(a)),
  'deny opencode provider': (cfg.policies ?? []).some((p) => p.resource === 'opencode' && p.effect === 'deny'),
  'compaction buffer': cfg.compaction?.buffer === 40000,
  'ponytail plugin': (cfg.plugins ?? []).includes(npmSpec('ponytail')),
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
if (failed) { console.log('--- config ---'); console.log(out.split('\n').slice(0, 150).join('\n')); console.log('--- agents ---'); console.log(agentsOut.slice(0, 4000)); process.exit(1); }
JS

# The registered Context Mode command must start an MCP server (#107): run it as written and send `initialize`.
node --input-type=module - "$HOME/resolved.txt" "$repo" <<'JS'
import fs from 'node:fs';
const { resolvedOpenCodeConfig } = await import(`${process.argv[3]}/scripts/lib/doctor.mjs`);
const { probeInitialize } = await import(`${process.argv[3]}/scripts/lib/inventory.mjs`);
const { satisfies } = await import(`${process.argv[3]}/scripts/lib/node-runtime.mjs`);
const { nodeRange } = await import(`${process.argv[3]}/scripts/lib/pins.mjs`);
if (!satisfies(process.versions.node, nodeRange('context-mode'))) { console.log('skip  context-mode initialize (Node below the pin range)'); process.exit(0); }
const cfg = resolvedOpenCodeConfig(fs.readFileSync(process.argv[2], 'utf8'));
const entry = (cfg.mcp?.servers ?? cfg.mcp)?.['context-mode'];
if (!entry) { console.log('FAIL  context-mode is not registered'); process.exit(1); }
const r = await probeInitialize(entry.command, { expect: 'context-mode' });
console.log(`${r.ok ? 'ok    ' : 'FAIL  '} context-mode initialize serverInfo.name = ${r.name}${r.error ? ` (${r.error})` : ''}`);
process.exit(r.ok ? 0 : 1);
JS

# copilot-usage (fresh HOME, network on: strict skips it). Proves the plugin file lands and no tui.json entry is written
# (2.x discovers plugins/<dir>/tui.js itself). The TUI rendering is proven by real-usage-v2 (tests/real-usage-v2.py).
HOME="$(mktemp -d)"
export HOME
export XDG_CONFIG_HOME="$HOME/.config"
bash "$repo/install.sh" --yes --no-exec --agents opencode-v2 --tools copilot-usage --network on --lang en --profile anthropic-api
node --input-type=module - "$HOME/.config/opencode" <<'JS'
import fs from 'node:fs';
import path from 'node:path';
const dir = process.argv[2];
const file = path.join(dir, 'plugins', 'lean-copilot-usage', 'tui.js');
if (!fs.existsSync(file) || fs.existsSync(path.join(dir, 'tui.json'))) { console.log('FAIL  copilot-usage plugin file missing, or a tui.json was written on 2.x'); process.exit(1); }
console.log('ok    copilot-usage plugin file (no tui.json entry on 2.x)');
JS
# No second `opencode debug config` here: the first HOME's managed OpenCode service still holds its fixed port, so a new HOME cannot start one.
