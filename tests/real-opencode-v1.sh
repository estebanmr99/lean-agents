#!/usr/bin/env bash
# Installs lean-agents into a throwaway HOME and asks the real OpenCode 1.x binary
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

bash "$repo/install.sh" --yes --no-exec --agents opencode-v1 \
  --tools serena,playwright,playwright-extension,ponytail,dcp --privacy strict --lang en --profile anthropic-api

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
  'mcp playwright-extension': (cfg.mcp?.['playwright-extension']?.command ?? []).includes('--extension'),
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

# --doctor names the 1.x guard (fatal if missing).
node "$repo/scripts/lean.mjs" --home "$HOME" --doctor > "$HOME/doctor.txt" 2>&1 || true
grep -F 'OpenCode 1.x: supported; lean-agents will not upgrade it' "$HOME/doctor.txt"

# Informational, never fatal: where this OpenCode keeps its data (older 1.x may lack `debug paths`). Feeds "Staying on OpenCode 1.x" in docs/compatibility.md.
echo '--- opencode debug paths ---'
opencode debug paths || echo '(opencode debug paths is not available on this version)'
echo '--- data dir ---'
ls -la "$HOME/.local/share/opencode" 2>&1 || true

# copilot-usage (fresh HOME, network on: strict skips it). Proves the plugin file and its tui.json entry land and
# OpenCode still loads its config without error. TUI rendering needs a real terminal and a login: still VERIFY.
HOME="$(mktemp -d)"
export HOME
export XDG_CONFIG_HOME="$HOME/.config"
bash "$repo/install.sh" --yes --no-exec --agents opencode-v1 --tools copilot-usage --network on --lang en --profile anthropic-api
node --input-type=module - "$HOME/.config/opencode" <<'JS'
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const dir = process.argv[2];
const file = path.join(dir, 'plugins', 'lean-copilot-usage', 'tui.js');
const tui = JSON.parse(fs.readFileSync(path.join(dir, 'tui.json'), 'utf8'));
if (!fs.existsSync(file) || !tui.plugin.includes(pathToFileURL(file).href)) { console.log('FAIL  copilot-usage plugin or tui.json entry missing'); process.exit(1); }
console.log('ok    copilot-usage plugin file and tui.json entry');
JS
opencode debug config > "$HOME/resolved2.txt" 2>"$HOME/stderr2.txt" || { cat "$HOME/resolved2.txt" "$HOME/stderr2.txt"; exit 1; }
if grep -i -E 'tui\.json|copilot-usage|plugin.*(error|fail)' "$HOME/stderr2.txt"; then echo 'FAIL  OpenCode reported a tui.json or plugin error'; exit 1; fi
echo 'ok    opencode debug config loads with the copilot-usage plugin installed'
