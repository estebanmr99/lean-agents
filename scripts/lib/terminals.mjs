// Warp and Orca: detect the app, then plan the agent integrations for a user who already has it.
// The terminal apps themselves are never installed.
import fs from 'node:fs';
import path from 'node:path';
import { which, quiet } from './system.mjs';
import { hasProxy } from './network.mjs';
import { skillSource, skillsCli } from './pins.mjs';

export const TERMINALS = ['warp', 'orca'];
// Skills CLI agent ids; VS Code Copilot reads ~/.copilot/skills like Copilot CLI.
const ORCA_SKILL_AGENT = { claude: 'claude-code', 'opencode-v1': 'opencode', 'opencode-v2': 'opencode', 'copilot-cli': 'github-copilot', 'vscode-copilot': 'github-copilot', cursor: 'cursor', antigravity: 'antigravity-cli' };
// Orca's hooks POST status to 127.0.0.1; Windows curl sends loopback to the proxy unless NO_PROXY lists it.
const LOOPBACK = ['localhost', '127.0.0.1', '::1'];
const ORCA_TELEMETRY_ENV = ['DO_NOT_TRACK', 'ORCA_TELEMETRY_DISABLED'];
const ps = (script) => ['powershell', '-NoProfile', '-NonInteractive', '-Command', script];

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
// `system` is false for --home runs: Windows user env changes are real-machine only.
export function terminalCommands({ terminals, agents, network = {}, platform = process.platform, env = process.env, system = true, readEnv = readWindowsEnv }) {
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
        run: [['npx', '-y', skillsCli(), 'add', skillSource('orca-cli'), '--skill', 'orca-cli', '-a', ...as, '-g', '-y']],
        undo: [['npx', '-y', skillsCli(), 'remove', 'orca-cli', '-g', '-y']],
      });
    }
    if (platform === 'win32' && system) commands.push(...orcaWindowsCommands({ network, env, readEnv }));
  }
  return commands;
}

// One Windows env value from the User or Machine scope (null when unset); plan time only, read-only.
function readWindowsEnv(scope, name) {
  const r = quiet(ps(`[Console]::Out.Write([Environment]::GetEnvironmentVariable('${name}','${scope}'))`));
  return r.ok && r.out.trim() ? r.out.trim() : null;
}

function orcaWindowsCommands({ network, env, readEnv }) {
  const commands = [];
  if (network.telemetry === 'off') {
    for (const name of ORCA_TELEMETRY_ENV) {
      commands.push({
        tool: 'orca',
        desc: `Orca telemetry off: ${name}=1 in your Windows user env (restart Orca)`,
        run: [ps(`[Environment]::SetEnvironmentVariable('${name}','1','User')`)],
        undo: [ps(`[Environment]::SetEnvironmentVariable('${name}',$null,'User')`)],
        // A value you already set is yours: never overwritten, never undone.
        skipIfOutput: { cmd: ps(`if (-not ([Environment]::GetEnvironmentVariable('${name}','User') -or [Environment]::GetEnvironmentVariable('${name}','Machine'))) { exit 1 }`) },
      });
    }
  }
  if (hasProxy(env)) {
    // Scopes decide, not this shell: a value set only in the current session is not persisted anywhere.
    const user = readEnv('User', 'NO_PROXY');
    const machine = readEnv('Machine', 'NO_PROXY');
    const have = (user ?? machine ?? '').split(',').map((x) => x.trim());
    const missing = LOOPBACK.filter((h) => !have.includes(h));
    if (missing.length) {
      const list = missing.map((h) => `'${h}'`).join(',');
      const get = (scope) => `[Environment]::GetEnvironmentVariable('NO_PROXY','${scope}')`;
      commands.push({
        tool: 'orca',
        desc: `NO_PROXY: add ${missing.join(', ')} to your Windows user env so Orca status hooks skip the proxy (restart Orca)`,
        // A user value shadows the machine one, so without a user value the machine value is the starting point.
        run: [ps(`$v=${get('User')}; if (-not $v) { $v=${get('Machine')} }; $l=@($v -split ',' | Where-Object { $_ }); foreach ($h in @(${list})) { if ($l -notcontains $h) { $l += $h } }; [Environment]::SetEnvironmentVariable('NO_PROXY', ($l -join ','), 'User')`)],
        // Drops only our entries. With no user value before, the var was ours: remove it once nothing but the machine value is left.
        undo: [ps(`$l=@(${get('User')} -split ',' | Where-Object { $_ -and @(${list}) -notcontains $_ }); ${user ? '' : `$l=@($l | Where-Object { @(${get('Machine')} -split ',') -notcontains $_ }); `}[Environment]::SetEnvironmentVariable('NO_PROXY', $(if ($l.Count) { $l -join ',' } else { $null }), 'User')`)],
      });
    }
  }
  return commands;
}

// Git Bash on Windows: a shell started from it, or the standard install folders.
function gitBashPresent({ platform, env }) {
  if (platform !== 'win32') return false;
  if (env.MSYSTEM) return true;
  const roots = [env.ProgramFiles, env['ProgramFiles(x86)'], env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'Programs')];
  return roots.some((d) => d && fs.existsSync(path.join(d, 'Git', 'bin', 'bash.exe')));
}

// Marked ~/.bashrc block for Git Bash. Entries are appended at run time, so the user's own NO_PROXY is kept.
export function gitBashActions({ home, terminals, agents, platform = process.platform, env = process.env }) {
  if (!gitBashPresent({ platform, env })) return [];
  const lines = [];
  if (agents.includes('cursor')) {
    lines.push(
      '# Cursor CLI hooks are denied under Git Bash unless MSYSTEM and SHELL are empty.',
      "alias agent='MSYSTEM= SHELL= agent.cmd'",
      "alias cursor-agent='MSYSTEM= SHELL= cursor-agent.cmd'",
    );
  }
  if (terminals.includes('orca') && hasProxy(env)) {
    lines.push(
      '# Orca status hooks call 127.0.0.1 with curl: keep loopback off the proxy.',
      `for h in ${LOOPBACK.join(' ')}; do`,
      '  case ",$NO_PROXY," in *",$h,"*) ;; *) NO_PROXY="${NO_PROXY:+$NO_PROXY,}$h" ;; esac',
      '  case ",$no_proxy," in *",$h,"*) ;; *) no_proxy="${no_proxy:+$no_proxy,}$h" ;; esac',
      'done',
      'export NO_PROXY no_proxy',
    );
  }
  return lines.length ? [{ kind: 'block', toml: true, path: path.join(home, '.bashrc'), body: lines.join('\n') }] : [];
}

// Manual steps lean-agents cannot script: printed after install and by --doctor.
// `check` (when present) says whether a step is already done.
export function stillNeeded({ home, terminals, agents, platform = process.platform, env = process.env, exec = false }) {
  const out = [];
  if (agents.includes('cursor')) {
    out.push({ text: 'Cursor: run `agent login` once (CLI) and sign in to the Cursor app; `agent mcp login <server>` for any MCP server that needs OAuth.' });
    out.push({ text: 'Cursor: paste your global rules into Cursor Settings > Rules > User Rules (there is no file for them); --project writes team rules instead.' });
    if (hasProxy(env)) out.push({ text: 'Cursor behind a proxy: export HTTP_PROXY, HTTPS_PROXY and NODE_USE_ENV_PROXY=1 in your shell profile (lean-agents never writes proxy values).' });
  }
  if (terminals.includes('orca')) {
    if (platform === 'win32') {
      out.push({ text: 'Orca: click "Install CLI & Skills" in Orca to put `orca` on PATH (%LOCALAPPDATA%\\Programs\\Orca\\resources\\bin).', check: exec ? () => Boolean(which('orca')) : undefined });
    }
    out.push(
      { text: 'Orca: the first launch turns on agent status hooks, which write into ~/.claude/settings.json and ~/.cursor/hooks.json (Settings > Agents > Agent status hooks). --uninstall leaves them alone.', check: () => orcaHooksFound(home).length > 0 },
      { text: 'Orca: Settings > Agents > Agent permissions may start agents in Yolo mode; pick Manual if you expect approval prompts.' },
      { text: 'Orca: Settings > Session History > "Search inside sessions" indexes the full text of every agent chat on this machine; it is on by default.' },
      { text: 'Orca: restart Orca after env changes, then start a fresh agent tab (restored tabs keep the old env).' },
    );
  }
  return out;
}

// Orca hook entries found in other agents' configs, for --doctor.
const ORCA_HOOK = /[\\/]\.orca[\\/]agent-hooks|orca-agent-hook|ORCA_AGENT_HOOK/i;
export function orcaHooksFound(home) {
  return [path.join(home, '.claude', 'settings.json'), path.join(home, '.cursor', 'hooks.json')].filter((f) => {
    if (!fs.existsSync(f)) return false;
    let text;
    try { text = fs.readFileSync(f, 'utf8'); } catch { return false; }
    // On Windows Orca writes the Cursor hook as a PowerShell -EncodedCommand (UTF-16LE base64).
    const decoded = [...text.matchAll(/-EncodedCommand\s+([A-Za-z0-9+/=]+)/gi)].map((m) => Buffer.from(m[1], 'base64').toString('utf16le'));
    return [text, ...decoded].some((t) => ORCA_HOOK.test(t));
  });
}

// True when an Orca opt-out is already set (Windows real home only). Reads process.env only: on Windows
// it carries the User and Machine vars from login, and spawning PowerShell here would touch USERPROFILE on a dry run.
export function orcaEnvSet({ platform = process.platform, system = true, env = process.env } = {}) {
  if (platform !== 'win32' || !system) return false;
  return ORCA_TELEMETRY_ENV.some((name) => Boolean(env[name]));
}

// Printed with the all-off network preset; app settings stay the user's.
export function terminalPrivacyNotes(terminals, { orcaEnvSet = false } = {}) {
  const notes = [];
  if (terminals.includes('warp')) notes.push('Warp telemetry: set `[privacy] telemetry_enabled = false` in its settings.toml (the free plan may need it on for AI)');
  if (terminals.includes('orca') && !orcaEnvSet) notes.push('Orca telemetry: set DO_NOT_TRACK=1 where Orca starts, or turn off Settings > Privacy > Share anonymous usage data');
  return notes;
}
