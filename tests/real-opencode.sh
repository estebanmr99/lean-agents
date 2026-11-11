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
const { contextModeNodeNote } = await import(`${process.argv[3]}/scripts/lib/system.mjs`);
const { npmSpec } = await import(`${process.argv[3]}/scripts/lib/pins.mjs`);
let cfg;
try { cfg = resolvedOpenCodeConfig(out); } catch (e) { console.log(out); throw e; }
const servers = cfg.mcp?.servers ?? cfg.mcp ?? {};
const checks = {
  'rules in instructions': (cfg.instructions ?? []).some((i) => String(i).includes('lean-agents')),
  'mcp serena': !!servers.serena,
  'mcp playwright': !!servers.playwright,
  'mcp playwright-extension': (servers['playwright-extension']?.command ?? []).includes('--extension'),
  'mcp context-mode': !!servers['context-mode'] || contextModeNodeNote(process.versions.node) !== '', // skipped on Node < 24.15
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
import { spawn } from 'node:child_process';
const { resolvedOpenCodeConfig } = await import(`${process.argv[3]}/scripts/lib/doctor.mjs`);
const { contextModeNodeNote } = await import(`${process.argv[3]}/scripts/lib/system.mjs`);
if (contextModeNodeNote(process.versions.node)) { console.log('skip  context-mode initialize (Node < 24.15)'); process.exit(0); }
const cfg = resolvedOpenCodeConfig(fs.readFileSync(process.argv[2], 'utf8'));
const entry = (cfg.mcp?.servers ?? cfg.mcp)?.['context-mode'];
if (!entry) { console.log('FAIL  context-mode is not registered'); process.exit(1); }
const [cmd, ...args] = entry.command;
const child = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'inherit'] });
const timer = setTimeout(() => { console.log('FAIL  context-mode: no initialize reply in 120s'); child.kill(); process.exit(1); }, 120000);
let buf = '';
child.on('exit', (code) => { console.log(`FAIL  context-mode exited (${code}) before replying to initialize`); process.exit(1); });
child.stdout.on('data', (d) => {
  buf += d;
  for (const line of buf.split('\n')) {
    let msg; try { msg = JSON.parse(line); } catch { continue; }
    if (msg?.id !== 1) continue;
    console.log(`initialize reply: ${line}`);
    const name = msg.result?.serverInfo?.name;
    console.log(`${name === 'context-mode' ? 'ok    ' : 'FAIL  '} context-mode initialize serverInfo.name = ${name}`);
    clearTimeout(timer); child.removeAllListeners('exit'); child.kill();
    process.exit(name === 'context-mode' ? 0 : 1);
  }
});
child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'lean-agents-ci', version: '0' } } }) + '\n');
JS
