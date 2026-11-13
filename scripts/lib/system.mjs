// Detection of agents and prerequisites, and running external commands.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { npmSpec, bunPin } from './pins.mjs';
import { allowedEnv } from './network.mjs';

const isWin = process.platform === 'win32';

export function which(bin) {
  const r = spawnSync(isWin ? 'where' : 'command', isWin ? [bin] : ['-v', bin], { shell: !isWin, encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim().split(/\r?\n/)[0] : null;
}

// Windows .cmd shims (npm, npx) need a shell; real .exe files must not get one, or paths with spaces split.
const useShell = (bin) => isWin && !/\.exe$/i.test(bin) && !/\.exe$/i.test(which(bin) ?? '');

export function version(bin, args = ['--version'], env = {}) {
  if (!which(bin)) return null;
  const r = spawnSync(bin, args, { encoding: 'utf8', shell: useShell(bin), timeout: 20000, env: { ...allowedEnv(), ...env } });
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
    case 'git':
    case 'i-have-adhd':
      return { bin: 'git', install: brew('git') ?? winget('Git.Git'), manual: 'https://git-scm.com/downloads' };
    default:
      return null;
  }
}

// One line for a missing git (team mode and the plugin installs need it); null when it is there.
export function gitHint(pm, present = which('git')) {
  if (present) return null;
  const g = prereqFor('git', pm);
  return `! git not found. ${g.install ? `Install it: ${g.install.map((a) => a.join(' ')).join(' && ')}` : `Install it from ${g.manual}`}`;
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
// Linux and Windows: the pinned release zip is downloaded to a file, checked against the pinned SHA256 and only then extracted,
// so no upstream installer script runs. Linux: no shell profile edit (the engine finds ~/.bun/bin itself). Windows: ~\.bun\bin goes on the user PATH.
const VERIFY = fileURLToPath(new URL('./verify-sha256.mjs', import.meta.url));
export function bunInstall(home, dir, platform, pm, arch = process.arch) {
  const bunDir = path.join(home, '.bun');
  if (platform === 'darwin') {
    return pm === 'brew' ? { tool: 'bun', desc: 'install bun', run: [['brew', 'install', 'oven-sh/bun/bun']], undo: [['brew', 'uninstall', 'bun']], optional: true } : null;
  }
  const { version, sha256 } = bunPin();
  const name = `bun-${platform === 'win32' ? 'windows' : 'linux'}-${arch === 'arm64' ? 'aarch64' : 'x64'}`;
  if (!sha256[name.slice(4)]) return null;
  const zip = path.join(dir, `${name}-${version}.zip`);
  const download = [platform === 'win32' ? 'curl.exe' : 'curl', '-fsSL', '-o', zip, `https://github.com/oven-sh/bun/releases/download/bun-v${version}/${name}.zip`];
  const verify = [process.execPath, VERIFY, zip, sha256[name.slice(4)]];
  // Undo removes only the binary this install put there, then the dirs it made if they are empty: ~/.bun may hold the user's cache or global packages.
  const exe = platform === 'win32' ? 'bun.exe' : 'bun';
  const rm = [process.execPath, '-e', `const fs = require("fs"), p = require("path"), d = p.join(require("os").homedir(), ".bun"), b = p.join(d, "bin"); if (p.resolve(process.argv[1]) !== d) { console.error("refusing to remove under " + process.argv[1] + ": not the Bun dir lean-agents installed"); process.exit(1); } try { fs.unlinkSync(p.join(b, "${exe}")); } catch {} for (const x of [b, d]) try { fs.rmdirSync(x); } catch {}`, bunDir];
  if (platform === 'win32') {
    const bin = path.join(bunDir, 'bin');
    const tmp = path.join(dir, `${name}-${version}`);
    const q = (s) => s.replace(/'/g, "''"); // PowerShell single-quote escape for a profile path like O'Neil
    const ps = (script) => ['powershell', '-NoProfile', '-NonInteractive', '-Command', script];
    return {
      tool: 'bun', desc: `install bun ${version}`, optional: true,
      run: [download, verify, ps(`Expand-Archive -Force -LiteralPath '${q(zip)}' -DestinationPath '${q(tmp)}'; New-Item -ItemType Directory -Force '${q(bin)}' | Out-Null; Move-Item -Force '${q(path.join(tmp, name, 'bun.exe'))}' '${q(path.join(bin, 'bun.exe'))}'; Remove-Item -Recurse -Force '${q(tmp)}'; $p = [string][Environment]::GetEnvironmentVariable('Path', 'User'); if (($p -split ';') -notcontains '${q(bin)}') { [Environment]::SetEnvironmentVariable('Path', ($p.TrimEnd(';') + ';${q(bin)}'), 'User') }`)],
      undo: [rm, ps(`$p = [string][Environment]::GetEnvironmentVariable('Path', 'User'); [Environment]::SetEnvironmentVariable('Path', (($p -split ';' | Where-Object { $_ -and $_ -ne '${q(bin)}' }) -join ';'), 'User')`)],
    };
  }
  return {
    tool: 'bun', desc: `install bun ${version}`, optional: true,
    run: [download, verify, ['mkdir', '-p', path.join(bunDir, 'bin')], ['unzip', '-q', '-j', '-o', zip, `${name}/bun`, '-d', path.join(bunDir, 'bin')]],
    undo: [rm],
  };
}

export const bunPresent = (home) => Boolean(which('bun')) || fs.existsSync(path.join(home, '.bun', 'bin', isWin ? 'bun.exe' : 'bun'));

export function run(argv, { dryRun, log, env }) {
  log(`  $ ${argv.join(' ')}`);
  if (dryRun) return true;
  const r = spawnSync(argv[0], argv.slice(1), { stdio: 'inherit', shell: useShell(argv[0]), env: { ...allowedEnv(), ...env } });
  return r.status === 0;
}

export function quiet(argv, timeout = 30000, env = {}) {
  const r = spawnSync(argv[0], argv.slice(1), { encoding: 'utf8', shell: useShell(argv[0]), timeout, env: { ...allowedEnv(), ...env } });
  return { ok: r.status === 0, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

export const exists = (p) => fs.existsSync(p);

