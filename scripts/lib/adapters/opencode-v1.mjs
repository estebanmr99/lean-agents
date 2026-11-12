// OpenCode 1.x adapter (>=1.18.29). Keys checked against the 1.19.0 config schema; files
// and commands are shared with the 2.x adapter, only config keys differ.
import path from 'node:path';
import { configPath, localServer, opencodeShared, profileEdits, shellEdit } from './opencode-v2.mjs';
import { OWNED_MARK } from '../fsops.mjs';
import { configHome } from '../system.mjs';
import { npmSpec } from '../pins.mjs';

// OpenCode 1.19's TUI runs server plugins in a Bun worker and never calls the factory in Orca's managed
// plugins/orca-opencode-status.js, so Orca shows no status. Loading it from a file under another name
// fixes that (issue #78). Worker only: headless `opencode run` already loads the managed file.
const ORCA_SHIM = `// ${OWNED_MARK}
// Lets Orca's status plugin run in OpenCode 1.x's TUI worker (lean-agents#78).
export const LeanOrcaStatusShim = async (ctx) => {
  if (typeof Bun === 'undefined' || Bun.isMainThread) return {};
  try {
    const mod = await import('./orca-opencode-status.js');
    // Orca's default export is the factory (ORCA_OPENCODE_PLUGIN_API=v1) or an { id, server } object.
    const factory = typeof mod.default === 'function' ? mod.default : mod.default?.server ?? mod.OrcaOpenCodeStatusPlugin;
    return (await factory?.(ctx)) ?? {};
  } catch {
    return {};
  }
};
`;

export function opencodeV1Adapter({ home, core, profile, opts, rulesPath }) {
  const dir = path.join(configHome(home), 'opencode');
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
  const shell = shellEdit(opts);
  if (shell) edits.push(shell);

  for (const name of ['serena', 'playwright', 'playwright-extension']) {
    if (tools.includes(name)) edits.push({ path: ['mcp', name], value: localServer(core, name), mode: 'setIfAbsent' });
  }
  // Context Mode is plugin-only here: plugin plus MCP breaks OpenCode tool registration.
  if (tools.includes('context-mode')) {
    edits.push({ path: ['plugin'], value: npmSpec('context-mode'), mode: 'arrayAdd', legacy: ['context-mode'] });
    commands.push({
      tool: 'context-mode',
      desc: 'Context Mode package for OpenCode',
      run: [['npm', 'install', '-g', npmSpec('context-mode')]],
      undo: [['npm', 'uninstall', '-g', 'context-mode']],
      skipIfOutput: { cmd: ['npm', 'ls', '-g', 'context-mode'], ok: true },
    });
  }
  if (opts.terminals?.includes('warp')) edits.push({ path: ['plugin'], value: npmSpec('warp-opencode'), mode: 'arrayAdd', legacy: ['@warp-dot-dev/opencode-warp', '@warp-dot-dev/opencode-warp@0.1.7'] });
  if (opts.terminals?.includes('orca')) actions.push({ kind: 'file', path: path.join(dir, 'plugins', 'lean-orca-status-shim.js'), content: ORCA_SHIM });
  if (tools.includes('ponytail')) edits.push({ path: ['plugin'], value: npmSpec('ponytail'), mode: 'arrayAdd', legacy: ['@dietrichgebert/ponytail'] });
  if (tools.includes('dcp')) {
    edits.push({ path: ['plugin'], value: npmSpec('opencode-dcp'), mode: 'arrayAdd' });
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
  const net = opts.network;
  if (net.outbound === 'off') edits.push({ path: ['share'], value: 'disabled', mode: 'set' });
  if (net.autoUpdate === 'off') edits.push({ path: ['autoupdate'], value: false, mode: 'set' });
  if (net.telemetry === 'off') edits.push({ path: ['experimental', 'openTelemetry'], value: false, mode: 'set' });
  if (net.outbound === 'off' && profile?.provider !== 'opencode') edits.push({ path: ['disabled_providers'], value: 'opencode', mode: 'arrayAdd' });
  actions.push({ kind: 'json', path: configPath(dir), edits });
  return { actions, commands };
}
