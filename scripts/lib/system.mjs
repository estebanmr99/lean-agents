// Detection of agents and prerequisites, and running external commands.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { npmSpec } from './pins.mjs';

const isWin = process.platform === 'win32';

export function which(bin) {
  const r = spawnSync(isWin ? 'where' : 'command', isWin ? [bin] : ['-v', bin], { shell: !isWin, encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim().split(/\r?\n/)[0] : null;
}

// Windows .cmd shims (npm, npx) need a shell; real .exe files must not get one, or paths with spaces split.
const useShell = (bin) => isWin && !/\.exe$/i.test(which(bin) ?? '');

export function version(bin, args = ['--version']) {
  if (!which(bin)) return null;
  const r = spawnSync(bin, args, { encoding: 'utf8', shell: useShell(bin), timeout: 20000 });
  const m = `${r.stdout}${r.stderr}`.match(/(\d+)\.(\d+)\.(\d+)/);
  return m ? m[0] : 'unknown';
}

// A config dir from the environment counts only for the real home or inside --home:
// a run with --home must never write outside it, even when the variable is set.
export function envDir(home, name, fallback) {
  const value = process.env[name];
  if (!value || !path.isAbsolute(value)) return fallback;
  const rel = path.relative(home, value);
  const inside = !rel.startsWith('..') && !path.isAbsolute(rel);
  return home === os.homedir() || inside ? value : fallback;
}

export const configHome = (home) => envDir(home, 'XDG_CONFIG_HOME', path.join(home, '.config'));

// External tools read HOME, not --home, so a run with --home hands it down to every child.
export function isolate(home) {
  if (home === os.homedir()) return;
  const env = { XDG_CONFIG_HOME: configHome(home), COPILOT_HOME: envDir(home, 'COPILOT_HOME', path.join(home, '.copilot')) };
  for (const name of ['XDG_CACHE_HOME', 'XDG_DATA_HOME', 'XDG_STATE_HOME']) {
    if (!envDir(home, name, null)) delete process.env[name];
  }
  Object.assign(process.env, env, { HOME: home, USERPROFILE: home });
}

export function detectAgents() {
  const found = {};
  const claude = version('claude');
  if (claude) found.claude = claude;
  const oc = version('opencode');
  if (oc) found[oc.startsWith('1.') ? 'opencode-v1' : 'opencode-v2'] = oc;
  const copilot = version('copilot');
  if (copilot) found['copilot-cli'] = copilot;
  const agy = version('agy');
  if (agy) found.antigravity = agy;
  const code = version('code');
  if (code) found['vscode-copilot'] = code;
  // The Cursor installer links both `agent` and `cursor-agent`; the second name is unambiguous.
  const cursor = version('cursor-agent');
  if (cursor) found.cursor = cursor;
  return found;
}

export function packageManager() {
  if (isWin) return which('winget') ? 'winget' : which('scoop') ? 'scoop' : null;
  return which('brew') ? 'brew' : null;
}

// What each tool needs on PATH, and how to get it. Agent CLIs are never installed here.
export function prereqFor(tool, pm) {
  const brew = (f) => (pm === 'brew' ? [['brew', 'install', f]] : null);
  const winget = (id) => (pm === 'winget' ? [['winget', 'install', '--id', id, '-e', '--scope', 'user', '--accept-source-agreements', '--accept-package-agreements']] : null);
  switch (tool) {
    case 'rtk':
      return { bin: 'rtk', install: brew('rtk') ?? winget('rtk-ai.rtk'), manual: 'https://github.com/rtk-ai/rtk#installation' };
    case 'context-mode':
      return { bin: 'context-mode', install: [['npm', 'install', '-g', npmSpec('context-mode')]] };
    case 'serena':
      return { bin: 'uvx', install: brew('uv') ?? winget('astral-sh.uv'), manual: 'https://docs.astral.sh/uv/getting-started/installation/' };
    case 'playwright':
    case 'playwright-extension':
    case 'caveman':
    case 'codeburn':
    case 'autoskills':
    case 'gsd':
      return { bin: 'npx', install: null, manual: 'https://nodejs.org/' };
    case 'gh':
      return { bin: 'gh', install: brew('gh') ?? winget('GitHub.cli'), manual: 'https://cli.github.com/' };
    case 'i-have-adhd':
      return { bin: 'git', install: brew('git') ?? winget('Git.Git'), manual: 'https://git-scm.com/downloads' };
    default:
      return null;
  }
}

// Antigravity CLI and app, only when the user picked Antigravity. Only ids checked upstream (2026-11-03) run;
// the rest print the vendor link. Windows CLI: `Google.AntigravityCLI` has no documented scope, so install.ps1 stays manual.
export function antigravityPrereqs(pm, platform, home, app = true) {
  const out = [];
  const winApp = pm === 'winget' && platform === 'win32';
  if (!which('agy')) {
    out.push(platform === 'darwin' && pm === 'brew'
      ? { desc: 'install agy', run: [['brew', 'install', '--cask', 'antigravity-cli']] }
      : { desc: `agy is missing: install it from https://antigravity.google/docs/getting-started`, run: [], manual: true });
  }
  if (!app) return out;
  const appInstalled = platform === 'darwin'
    ? exists('/Applications/Antigravity.app') || exists(path.join(home, 'Applications', 'Antigravity.app'))
    : winApp && quiet(['winget', 'list', '--id', 'Google.Antigravity', '-e']).ok;
  if (!appInstalled) {
    if (platform === 'darwin' && pm === 'brew') out.push({ desc: 'install the Antigravity app', run: [['brew', 'install', '--cask', 'antigravity']] });
    else if (winApp) out.push({ desc: 'install the Antigravity app', run: [['winget', 'install', '--id', 'Google.Antigravity', '-e', '--scope', 'user', '--accept-source-agreements', '--accept-package-agreements']] });
    else out.push({ desc: 'The Antigravity app is optional: download it from https://antigravity.google/download', note: true });
  }
  return out;
}

// Bun for Context Mode (JS/TS in ctx_execute). One route per OS; the undo is recorded only when this install ran.
// Linux: an unknown SHELL makes the upstream script skip the shell profile edit. Windows: the script adds ~\.bun\bin to the user PATH.
export function bunInstall(home, dir, platform, pm) {
  const bunDir = path.join(home, '.bun');
  if (platform === 'darwin') {
    return pm === 'brew' ? { tool: 'bun', desc: 'install bun', run: [['brew', 'install', 'oven-sh/bun/bun']], undo: [['brew', 'uninstall', 'bun']], optional: true } : null;
  }
  if (platform === 'win32') {
    const file = path.join(dir, 'bun-install.ps1');
    const ps = ['powershell', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File'];
    return { tool: 'bun', desc: 'install bun', run: [['curl.exe', '-fsSL', '-o', file, 'https://bun.com/install.ps1'], [...ps, file]], env: { BUN_INSTALL: bunDir }, undo: [[...ps, path.join(bunDir, 'uninstall.ps1')]], optional: true };
  }
  const file = path.join(dir, 'bun-install.sh');
  return {
    tool: 'bun', desc: 'install bun', optional: true,
    run: [['curl', '-fsSL', '-o', file, 'https://bun.com/install'], ['env', 'SHELL=/bin/sh', `BUN_INSTALL=${bunDir}`, 'bash', file]],
    undo: [[process.execPath, '-e', 'require("fs").rmSync(process.argv[1], { recursive: true, force: true })', bunDir]],
  };
}

export const bunPresent = (home) => Boolean(which('bun')) || fs.existsSync(path.join(home, '.bun', 'bin', isWin ? 'bun.exe' : 'bun'));

export function run(argv, { dryRun, log, env }) {
  log(`  $ ${argv.join(' ')}`);
  if (dryRun) return true;
  const r = spawnSync(argv[0], argv.slice(1), { stdio: 'inherit', shell: useShell(argv[0]), env: env && { ...process.env, ...env } });
  return r.status === 0;
}

export function quiet(argv, timeout = 30000) {
  const r = spawnSync(argv[0], argv.slice(1), { encoding: 'utf8', shell: useShell(argv[0]), timeout });
  return { ok: r.status === 0, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

export const exists = (p) => fs.existsSync(p);

// Context Mode 2.1.4 declares engines.node >=24.15.0; on older Node npm installs 1.x, or 2.x without its tools.
const CONTEXT_MODE_NODE = [24, 15, 0];
export function contextModeNodeNote(nodeVersion) {
  const have = nodeVersion.split('.').map(Number);
  const ok = CONTEXT_MODE_NODE.reduce((state, min, i) => (state !== 0 ? state : Math.sign((have[i] ?? 0) - min)), 0) >= 0;
  return ok ? '' : `Context Mode 2 needs Node ${CONTEXT_MODE_NODE.slice(0, 2).join('.')}+, found ${nodeVersion}: skipped. Upgrade Node (or nvm install 24) and run --update.`;
}
