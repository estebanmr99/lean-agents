// Warp and Orca: detect the app, then plan the agent integrations for a user who already has it.
// The terminal apps themselves are never installed.
import fs from 'node:fs';
import path from 'node:path';
import { which } from './system.mjs';

export const TERMINALS = ['warp', 'orca'];
export const WARP_OPENCODE_PLUGIN = '@warp-dot-dev/opencode-warp';
// OpenCode 1.x needs the pin (upstream README, checked 2026-11-03).
export const WARP_OPENCODE_V1_PLUGIN = `${WARP_OPENCODE_PLUGIN}@0.1.7`;
const ORCA_SKILL_AGENT = { claude: 'claude-code', 'opencode-v1': 'opencode', 'opencode-v2': 'opencode', 'copilot-cli': 'github-copilot', antigravity: 'antigravity-cli' };

// `platform` and `env` are parameters so tests can fake an OS without touching the machine.
export function detectTerminals(home, { platform = process.platform, env = process.env, system = true } = {}) {
  const has = (...paths) => paths.some((p) => p && fs.existsSync(p));
  const found = [];
  // `system` is false for a run with --home: it looks only inside it, so a throwaway HOME behaves the same on every machine.
  const apps = platform === 'darwin' ? [path.join(home, 'Applications'), ...(system ? ['/Applications'] : [])] : [];
  const local = platform === 'win32' && system ? env.LOCALAPPDATA : null;
  // PATH lookups are system-wide, so they follow `system` too. Linux `orca` is the GNOME screen reader: not a signal.
  // Windows install folders under Programs: VERIFY.
  const onPath = (bin) => system && which(bin);
  if (has(...apps.map((d) => path.join(d, 'Warp.app')), local && path.join(local, 'Programs', 'Warp')) || onPath('warp-terminal')) found.push('warp');
  if (has(...apps.map((d) => path.join(d, 'Orca.app')), local && path.join(local, 'Programs', 'Orca')) || (platform !== 'linux' && onPath('orca'))) found.push('orca');
  return found;
}

// --terminal value to a list; "both" and "none" are shorthands.
export function parseTerminal(v) {
  if (v === 'both') return [...TERMINALS];
  if (v === 'none') return [];
  if (TERMINALS.includes(v)) return [v];
  throw new Error('--terminal takes warp, orca, both or none');
}

// Commands only: OpenCode plugin entries go into the OpenCode adapter's own json edit, because two
// json actions on one file would each start from the unedited text.
export function terminalCommands({ terminals, agents }) {
  const commands = [];
  if (terminals.includes('warp') && agents.includes('claude')) {
    commands.push({
      tool: 'warp',
      desc: 'Warp plugin for Claude Code (needs jq)',
      run: [['claude', 'plugin', 'marketplace', 'add', 'warpdotdev/claude-code-warp'], ['claude', 'plugin', 'install', 'warp@claude-code-warp']],
      undo: [['claude', 'plugin', 'uninstall', 'warp@claude-code-warp']],
    });
  }
  if (terminals.includes('orca')) {
    const as = [...new Set(agents.map((a) => ORCA_SKILL_AGENT[a]).filter(Boolean))];
    if (as.length) {
      commands.push({
        tool: 'orca',
        desc: 'Orca skill orca-cli',
        run: [['npx', '-y', 'skills', 'add', 'https://github.com/stablyai/orca', '--skill', 'orca-cli', '-a', ...as, '-g', '-y']],
        undo: [['npx', '-y', 'skills', 'remove', 'orca-cli', '-g', '-y']],
      });
    }
  }
  return commands;
}

// Printed with the all-off network preset; app settings stay the user's.
export function terminalPrivacyNotes(terminals) {
  const notes = [];
  if (terminals.includes('warp')) notes.push('Warp telemetry: set `[privacy] telemetry_enabled = false` in its settings.toml (the free plan may need it on for AI)');
  if (terminals.includes('orca')) notes.push('Orca telemetry: set DO_NOT_TRACK=1 where Orca starts, or turn off Settings > Privacy > Share anonymous usage data');
  return notes;
}
