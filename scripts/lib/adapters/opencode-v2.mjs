// OpenCode 2.x adapter. Uses the native 2.x keys (agents, plugins, update, policies,
// mcp.servers), confirmed against `opencode debug config` on OpenCode 2.2 in CI.
import path from 'node:path';
import fs from 'node:fs';
import { OWNED_MARK } from '../fsops.mjs';
import { tierFor, modelFor } from '../render.mjs';

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

export function opencodeV2Adapter({ home, core, profile, opts, rulesPath }) {
  const dir = path.join(home, '.config', 'opencode');
  const tools = opts.tools;
  const actions = [];
  const commands = [];
  const edits = [
    { path: ['$schema'], value: 'https://opencode.ai/config.json', mode: 'setIfAbsent' },
    { path: ['instructions'], value: rulesPath, mode: 'arrayAdd' },
    { path: ['default_agent'], value: 'plan', mode: 'setIfAbsent' },
    { path: ['compaction', 'auto'], value: true, mode: 'setIfAbsent' },
    { path: ['compaction', 'buffer'], value: 40000, mode: 'setIfAbsent' },
  ];

  if (profile) {
    if (profile.main_model) edits.push({ path: ['model'], value: profile.main_model, mode: 'setIfAbsent' });
    for (const [agent, tier] of Object.entries(profile.primary ?? {})) {
      const m = modelFor(profile, tier);
      if (!m) continue;
      edits.push({ path: ['agents', agent, 'model'], value: m.model, mode: 'setIfAbsent' });
      for (const [k, v] of Object.entries(m.options ?? {})) edits.push({ path: ['agents', agent, k], value: v, mode: 'setIfAbsent' });
    }
  }

  for (const name of ['context-mode', 'serena', 'playwright']) {
    if (!tools.includes(name)) continue;
    const server = core.mcp[name];
    const cmd = [...server.command];
    if (name === 'serena') cmd.splice(cmd.indexOf('start-mcp-server') + 1, 0, '--context', server.context.default);
    edits.push({ path: ['mcp', 'servers', name], value: { type: 'local', command: cmd, enabled: true }, mode: 'setIfAbsent' });
  }
  if (tools.includes('ponytail')) {
    edits.push({ path: ['plugins'], value: '@dietrichgebert/ponytail', mode: 'arrayAdd' });
    actions.push({
      kind: 'json',
      path: process.platform === 'win32' && process.env.APPDATA
        ? path.join(process.env.APPDATA, 'ponytail', 'config.json')
        : path.join(home, '.config', 'ponytail', 'config.json'),
      edits: [{ path: ['defaultMode'], value: opts.ponytailMode, mode: 'setIfAbsent' }],
    });
  }
  if (opts.privacy === 'strict') {
    edits.push({ path: ['share'], value: 'disabled', mode: 'set' });
    edits.push({ path: ['update'], value: 'disable', mode: 'set' });
    if (profile?.provider !== 'opencode') {
      edits.push({ path: ['policies'], value: { effect: 'deny', action: 'provider.use', resource: 'opencode' }, mode: 'arrayAdd' });
    }
  }
  actions.push({ kind: 'json', path: configPath(dir), edits });

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
      undo: [],
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
      run: [['npx', '-y', 'skills', 'add', 'JuliusBrussee/caveman', '-a', 'opencode', '-g']],
      undo: [['npx', '-y', 'skills', 'remove', 'JuliusBrussee/caveman', '-a', 'opencode', '-g']],
    });
  }
  return { actions, commands };
}
