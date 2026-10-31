// OpenCode 1.x adapter (>=1.18.29). Keys checked against the 1.19.0 config schema; files
// and commands are shared with the 2.x adapter, only config keys differ.
import path from 'node:path';
import { configPath, localServer, opencodeShared, profileEdits } from './opencode-v2.mjs';

export function opencodeV1Adapter({ home, core, profile, opts, rulesPath }) {
  const dir = path.join(home, '.config', 'opencode');
  const tools = opts.tools;
  const { actions, commands } = opencodeShared({ home, dir, core, profile, opts });
  const edits = [
    { path: ['$schema'], value: 'https://opencode.ai/config.json', mode: 'setIfAbsent' },
    { path: ['instructions'], value: rulesPath, mode: 'arrayAdd' },
    { path: ['default_agent'], value: 'plan', mode: 'setIfAbsent' },
    { path: ['compaction', 'auto'], value: true, mode: 'setIfAbsent' },
    { path: ['compaction', 'reserved'], value: 40000, mode: 'setIfAbsent' },
    ...profileEdits(profile, 'agent'),
  ];

  for (const name of ['serena', 'playwright']) {
    if (tools.includes(name)) edits.push({ path: ['mcp', name], value: localServer(core, name), mode: 'setIfAbsent' });
  }
  // Context Mode is plugin-only here: plugin plus MCP breaks OpenCode tool registration.
  if (tools.includes('context-mode')) edits.push({ path: ['plugin'], value: 'context-mode', mode: 'arrayAdd' });
  if (tools.includes('ponytail')) edits.push({ path: ['plugin'], value: '@dietrichgebert/ponytail', mode: 'arrayAdd' });
  if (tools.includes('dcp')) {
    edits.push({ path: ['plugin'], value: '@tarquinen/opencode-dcp@latest', mode: 'arrayAdd' });
    const contextWindow = profile?.context_window ?? 200000;
    actions.push({
      kind: 'json',
      path: path.join(dir, 'dcp.jsonc'),
      edits: [
        { path: ['$schema'], value: 'https://raw.githubusercontent.com/Opencode-DCP/opencode-dynamic-context-pruning/master/dcp.schema.json', mode: 'setIfAbsent' },
        { path: ['compress', 'minContextLimit'], value: Math.round(contextWindow * 0.5), mode: 'setIfAbsent' },
        { path: ['compress', 'maxContextLimit'], value: Math.round(contextWindow * 0.8), mode: 'setIfAbsent' },
      ],
    });
  }
  if (opts.privacy === 'strict') {
    edits.push({ path: ['share'], value: 'disabled', mode: 'set' });
    edits.push({ path: ['autoupdate'], value: false, mode: 'set' });
    edits.push({ path: ['experimental', 'openTelemetry'], value: false, mode: 'set' });
    if (profile?.provider !== 'opencode') edits.push({ path: ['disabled_providers'], value: 'opencode', mode: 'arrayAdd' });
  }
  actions.push({ kind: 'json', path: configPath(dir), edits });
  return { actions, commands };
}
