#!/usr/bin/env bash
# Installs lean-agents into a throwaway HOME and asks the real OpenCode 1.x binary
# what it resolved, to prove every key lean-agents writes is accepted and loaded.
# Used by CI; safe to run locally because HOME is a temp directory.
set -euo pipefail

command -v opencode >/dev/null || { echo "opencode not on PATH" >&2; exit 1; }
opencode --version

HOME="$(mktemp -d)"
export HOME
export XDG_CONFIG_HOME="$HOME/.config"
repo="$(cd "$(dirname "$0")/.." && pwd)"

bash "$repo/install.sh" --yes --no-exec --agents opencode-v1 \
  --tools serena,playwright,ponytail,dcp --privacy strict --lang en --profile anthropic-api

opencode debug config > "$HOME/resolved.txt" 2>"$HOME/stderr.txt" || { cat "$HOME/resolved.txt" "$HOME/stderr.txt"; exit 1; }

opencode agent list > "$HOME/agents.txt" 2>&1 || true
node --input-type=module - "$HOME/resolved.txt" "$repo" "$HOME/agents.txt" <<'JS'
import fs from 'node:fs';
const out = fs.readFileSync(process.argv[2], 'utf8');
const agentsOut = fs.readFileSync(process.argv[4], 'utf8');
const { resolvedOpenCodeConfig } = await import(`${process.argv[3]}/scripts/lib/doctor.mjs`);
let cfg;
try { cfg = resolvedOpenCodeConfig(out); } catch (e) { console.log(out); throw e; }
const plugins = JSON.stringify(cfg.plugin ?? []);
const checks = {
  'rules in instructions': (cfg.instructions ?? []).some((i) => String(i).includes('lean-agents')),
  'mcp serena': !!cfg.mcp?.serena,
  'mcp playwright': !!cfg.mcp?.playwright,
  'no context-mode mcp': !cfg.mcp?.['context-mode'],
  'plan model': JSON.stringify(cfg.agent?.plan?.model ?? null).includes('claude-opus-5-5'),
  'subagents loaded': ['explore', 'research', 'review', 'debug', 'planner'].every((a) => agentsOut.includes(a)),
  'opencode provider disabled': (cfg.disabled_providers ?? []).includes('opencode'),
  'compaction reserved': cfg.compaction?.reserved === 40000,
  'context-mode plugin': plugins.includes('context-mode'),
  'ponytail plugin': plugins.includes('@dietrichgebert/ponytail'),
  'dcp plugin': plugins.includes('@tarquinen/opencode-dcp'),
  'default_agent plan': cfg.default_agent === 'plan',
  'share disabled': cfg.share === 'disabled',
  'autoupdate off': cfg.autoupdate === false,
  'openTelemetry off': cfg.experimental?.openTelemetry === false,
};
let failed = false;
for (const [name, ok] of Object.entries(checks)) {
  console.log(`${ok ? 'ok    ' : 'FAIL  '} ${name}`);
  if (!ok) failed = true;
}
console.log('top-level keys:', Object.keys(cfg).sort().join(', '));
if (failed) { console.log('--- config ---'); console.log(out.split('\n').slice(0, 150).join('\n')); console.log('--- agents ---'); console.log(agentsOut.slice(0, 4000)); process.exit(1); }
JS
