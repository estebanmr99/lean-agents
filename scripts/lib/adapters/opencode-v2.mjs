// OpenCode 2.x adapter. Uses the native 2.x keys (agents, plugins, update, policies,
// mcp.servers), confirmed against `opencode debug config` on OpenCode 2.2 in CI.
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { OWNED_MARK } from '../fsops.mjs';
import { tierFor, modelFor } from '../render.mjs';
import { configHome } from '../system.mjs';

const PERMISSIONS = {
  'read-only': ['  edit: deny', '  bash: deny'],
  'git-read': ['  edit: deny', '  bash:', '    "*": deny', '    "git diff*": allow', '    "git log*": allow', '    "git show*": allow', '    "git status*": allow'],
  'read-write': [],
};

export function renderOpenCodeAgent(agent, profile) {
  const tier = tierFor(profile, agent.name, agent.tier);
  const m = modelFor(profile, tier);
  const lines = ['---', `# ${OWNED_MARK} (tier: ${tier})`, `description: ${agent.description}`, 'mode: subagent'];
  if (m?.model) lines.push(`model: ${m.model}`);
  for (const [k, v] of Object.entries(m?.options ?? {})) lines.push(`${k}: ${v}`);
  const perms = [...PERMISSIONS[agent.access]];
  if (agent.name === 'research') perms.push('  webfetch: allow');
  if (perms.length) lines.push('permission:', ...perms);
  lines.push('---', '', agent.body, '');
  return lines.join('\n');
}

export function configPath(dir) {
  for (const f of ['opencode.jsonc', 'opencode.json']) {
    if (fs.existsSync(path.join(dir, f))) return path.join(dir, f);
  }
  return path.join(dir, 'opencode.jsonc');
}

export function localServer(core, name) {
  const server = core.mcp[name];
  const command = [...server.command];
  if (name === 'serena') command.splice(command.indexOf('start-mcp-server') + 1, 0, '--context', server.context.default);
  return { type: 'local', command, enabled: true };
}

export function profileEdits(profile, agentsKey) {
  if (!profile) return [];
  const edits = [];
  if (profile.main_model) edits.push({ path: ['model'], value: profile.main_model, mode: 'setIfAbsent' });
  for (const [agent, tier] of Object.entries(profile.primary ?? {})) {
    const m = modelFor(profile, tier);
    if (!m) continue;
    edits.push({ path: [agentsKey, agent, 'model'], value: m.model, mode: 'setIfAbsent' });
    for (const [k, v] of Object.entries(m.options ?? {})) edits.push({ path: [agentsKey, agent, k], value: v, mode: 'setIfAbsent' });
  }
  return edits;
}

function ponytailConfig(home) {
  if (process.platform !== 'win32') return path.join(configHome(home), 'ponytail', 'config.json');
  // Only the real home may use %APPDATA%: --home must keep every write inside the temp dir.
  const appData = home === os.homedir() && process.env.APPDATA ? process.env.APPDATA : path.join(home, 'AppData', 'Roaming');
  return path.join(appData, 'ponytail', 'config.json');
}

// Everything that is the same on OpenCode 1.x and 2.x: files and commands, not config keys.
export function opencodeShared({ home, dir, core, profile, opts }) {
  const tools = opts.tools;
  const actions = [];
  const commands = [];
  if (tools.includes('ponytail')) {
    actions.push({ kind: 'json', path: ponytailConfig(home), edits: [{ path: ['defaultMode'], value: opts.ponytailMode, mode: 'setIfAbsent' }] });
  }
  for (const agent of core.agents) {
    actions.push({ kind: 'file', path: path.join(dir, 'agents', `${agent.name}.md`), content: renderOpenCodeAgent(agent, profile) });
  }
  if (tools.includes('rtk')) {
    commands.push({ tool: 'rtk', desc: 'RTK plugin for OpenCode', run: [['rtk', 'init', '-g', '--opencode']], undo: [['rtk', 'init', '-g', '--opencode', '--uninstall']] });
  }
  if (tools.includes('i-have-adhd')) {
    const vendor = path.join(dir, 'vendor', 'i-have-adhd');
    commands.push({
      tool: 'i-have-adhd',
      desc: 'i-have-adhd checkout for OpenCode',
      run: [['git', 'clone', '--depth', '1', 'https://github.com/ayghri/i-have-adhd', vendor]],
      undo: [['node', '-e', 'require("fs").rmSync(process.argv[1], { recursive: true, force: true })', vendor]],
      skipIfExists: vendor,
    });
    actions.push({
      kind: 'file',
      path: path.join(dir, 'plugins', 'i-have-adhd.ts'),
      content: `// ${OWNED_MARK}\nexport { default } from '../vendor/i-have-adhd/.opencode/plugins/i-have-adhd.mjs';\n`,
    });
    if (opts.adhdAlways) actions.push({ kind: 'file', path: path.join(dir, '.i-have-adhd-always'), content: '', force: true });
  }
  if (tools.includes('caveman')) {
    commands.push({
      tool: 'caveman',
      desc: 'Caveman skills for OpenCode',
      run: [['npx', '-y', 'skills', 'add', 'JuliusBrussee/caveman', '--skill', 'caveman', 'caveman-compress', 'caveman-stats', '-a', 'opencode', '-g', '-y']],
      undo: [['npx', '-y', 'skills', 'remove', 'caveman', 'caveman-compress', 'caveman-stats', '-a', 'opencode', '-g', '-y']],
    });
  }
  return { actions, commands };
}

export function opencodeV2Adapter({ home, core, profile, opts, rulesPath }) {
  const dir = path.join(configHome(home), 'opencode');
  const tools = opts.tools;
  const { actions, commands } = opencodeShared({ home, dir, core, profile, opts });
  const edits = [
    { path: ['$schema'], value: 'https://opencode.ai/config.json', mode: 'setIfAbsent' },
    { path: ['instructions'], value: rulesPath, mode: 'arrayAdd' },
    { path: ['default_agent'], value: 'plan', mode: 'setIfAbsent' },
    { path: ['compaction', 'auto'], value: true, mode: 'setIfAbsent' },
    { path: ['compaction', 'buffer'], value: 40000, mode: 'setIfAbsent' },
    ...profileEdits(profile, 'agents'),
  ];

  for (const name of ['context-mode', 'serena', 'playwright']) {
    if (tools.includes(name)) edits.push({ path: ['mcp', 'servers', name], value: localServer(core, name), mode: 'setIfAbsent' });
  }
  if (tools.includes('ponytail')) edits.push({ path: ['plugins'], value: '@dietrichgebert/ponytail', mode: 'arrayAdd' });
  if (opts.privacy === 'strict') {
    edits.push({ path: ['share'], value: 'disabled', mode: 'set' });
    edits.push({ path: ['update'], value: 'disable', mode: 'set' });
    if (profile?.provider !== 'opencode') {
      edits.push({ path: ['policies'], value: { effect: 'deny', action: 'provider.use', resource: 'opencode' }, mode: 'arrayAdd' });
    }
  }
  actions.push({ kind: 'json', path: configPath(dir), edits });
  return { actions, commands };
}
