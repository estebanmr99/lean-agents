// Detection of agents and prerequisites, and running external commands.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { npmSpec, bunPin, rtkPin } from './pins.mjs';
import { allowedEnv } from './network.mjs';
import { CURL_RETRY } from './retry.mjs';

const isWin = process.platform === 'win32';

// Every match, in PATH order. POSIX: `command -v` gets the name as "$1", never spliced into the script (#475); /bin/sh as shell: true used.
const whereAll = (bin, env) => {
  const r = isWin ? spawnSync('where', [bin], { encoding: 'utf8', ...(env && { env }) }) : spawnSync('/bin/sh', ['-c', 'command -v "$1"', 'sh', bin], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim().split(/\r?\n/).filter(Boolean) : [];
};
export const which = (bin) => whereAll(bin)[0] ?? null;

// Windows .cmd shims (npm, npx) run through cmd.exe /d /s /c with each argument quoted and every cmd metacharacter ^-escaped,
// the way cross-spawn (MIT) does it, so cmd never sees an open quote and `&`, `%` or `|` stay literal. Node 24 deprecates
// args with `shell: true` because it only concatenates them (DEP0190, #475). A batch file re-parses its %*,
// so every argument is escaped twice: once for this cmd.exe line, once for the shim's own line.
const META = /([()\][%!^"`<>&|;, *?])/g;
const cmdArg = (a) => `"${String(a).replace(/(\\*)"/g, '$1$1\\"').replace(/(\\*)$/, '$1$1')}"`.replace(META, '^$1').replace(META, '^$1');
export function spawnArgs(bin, args, platform = process.platform, resolve = whereAll) {
  const direct = { file: bin, args, opts: {} };
  if (platform !== 'win32' || /\.exe$/i.test(bin)) return direct;
  const full = /\.(cmd|bat)$/i.test(bin) && path.win32.isAbsolute(bin) ? bin : resolve(bin).find((f) => /\.(exe|cmd|bat)$/i.test(f));
  if (!full || /\.exe$/i.test(full)) return direct;
  // The file in plain quotes (a Windows path cannot hold `"`): a ^-escaped path breaks the shim's own %~dp0.
  const line = [`"${full}"`, ...args.map(cmdArg)].join(' ');
  return { file: process.env.ComSpec || 'cmd.exe', args: ['/d', '/s', '/c', `"${line}"`], opts: { windowsVerbatimArguments: true } };
}
// The shim is looked up on the child's PATH, as cmd.exe did when `shell: true` ran it.
export const spawnFor = (argv, opts = {}) => { const s = spawnArgs(argv[0], argv.slice(1), process.platform, (b) => whereAll(b, opts.env)); return spawnSync(s.file, s.args, { ...opts, ...s.opts }); };

// Windows .cmd/.bat files run through cmd.exe /d /s /c "<quoted file> <args>" (#475): no shell option, and a path with a cmd
// metacharacter is refused (null) instead of being quoted. Args are fixed words from callers, so they need no quoting.
const CMD_UNSAFE = /["&|<>^%]/;
export function cmdInvocation(file, args = [], comspec = process.env.ComSpec || 'cmd.exe') {
  if (CMD_UNSAFE.test(file) || args.some((a) => !/^[\w.=-]+$/.test(a))) return null;
  return { file: comspec, argv: ['/d', '/s', '/c', `"${[`"${file}"`, ...args].join(' ')}"`] };
}

// The version string as the binary prints it, pre-release tag included (2.0.1-beta): what an undo must reinstall.
export function versionFull(bin, args = ['--version'], env = {}, timeout = 20000) {
  if (!path.isAbsolute(bin) && !which(bin)) return null;
  const opts = { encoding: 'utf8', timeout, env: { ...allowedEnv(), ...env } };
  let r;
  if (isWin && path.isAbsolute(bin) && /\.(cmd|bat)$/i.test(bin)) {
    const inv = cmdInvocation(bin, args);
    if (!inv) return 'unknown';
    r = spawnSync(inv.file, inv.argv, { ...opts, windowsVerbatimArguments: true });
  } else r = spawnFor([bin, ...args], opts);
  const m = `${r.stdout}${r.stderr}`.match(/\d+\.\d+\.\d+(?:-[0-9A-Za-z][0-9A-Za-z.-]*)?/);
  return m ? m[0] : 'unknown';
}

export const version = (bin, args, env) => versionFull(bin, args, env)?.replace(/-.*/, '') ?? null;

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

// Where `agy` lives when it is not on PATH. install.sh: $HOME/.local/bin (--dir changes it, unknowable here);
// install.ps1: %LOCALAPPDATA%\agy\bin; ~/.gemini/bin/agy.exe was seen on Windows in #211 (who writes it: VERIFY).
export function agyCandidates(home, platform = process.platform, env = process.env) {
  if (platform !== 'win32') return [path.posix.join(home, '.local', 'bin', 'agy')];
  return [env.LOCALAPPDATA && path.win32.join(env.LOCALAPPDATA, 'agy', 'bin', 'agy.exe'), path.win32.join(home, '.gemini', 'bin', 'agy.exe')].filter(Boolean);
}

// PATH first, then the candidates above. Returns a command that can be spawned, or null.
export function findAgy(home, platform = process.platform, env = process.env) {
  return which('agy') ? 'agy' : agyCandidates(home, platform, env).find(exists) ?? null;
}

// Antigravity IDE folders and the VS Code extension, by existence only (#216): nothing is read or written.
// The extension folder name is lowercase on disk (`google.google-antigravity-<version>`); Windows and Linux paths are VERIFY.
export function antigravityFootprint(home, fsx = fs) {
  const found = [];
  for (const d of ['antigravity-ide', 'antigravity-cli', 'antigravity']) {
    const p = path.join(home, '.gemini', d);
    if (fsx.existsSync(p)) found.push({ name: d === 'antigravity' ? 'antigravity (legacy)' : d, file: p });
  }
  const ext = path.join(home, '.vscode', 'extensions');
  let names = [];
  try { names = fsx.readdirSync(ext); } catch { /* no VS Code extensions folder */ }
  for (const n of names.filter((x) => x.toLowerCase().startsWith('google.google-antigravity'))) found.push({ name: 'vscode extension Google.google-antigravity', file: path.join(ext, n) });
  return found;
}

export const agyVersion = (home) => { const a = findAgy(home); return a && version(a); };

export function detectAgents() {
  const found = {};
  const claude = version('claude');
  if (claude) found.claude = claude;
  const oc = version('opencode');
  if (oc) found[oc.startsWith('1.') ? 'opencode-v1' : 'opencode-v2'] = oc;
  const copilot = version('copilot');
  if (copilot) found['copilot-cli'] = copilot;
  const agy = agyVersion(os.homedir());
  if (agy) found.antigravity = agy;
  const code = version('code') || version('code-insiders');
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
// the rest print the vendor link. Windows CLI: --install-agent antigravity (pinned release zip, agent-lifecycle.mjs); `Google.AntigravityCLI` has no documented scope.
// #147: Homebrew installs whatever version the cask has today; it cannot install an older one or a cask from a URL.
export const BREW_AGY_LIMIT = 'Homebrew cannot pin or verify this cask: you get its current version, unpinned by lean-agents. VERIFY';

// winget list: exit 0 = installed; only APPINSTALLER_CLI_ERROR_NO_APPLICATIONS_FOUND (0x8A150014, signed or not) = not installed.
// Anything else (timeout, source error) is no answer: installing then could record an undo for the user's own app.
const WINGET_NONE = [0x8A150014, 0x8A150014 - 2 ** 32];
export const wingetAnswer = (r) => (r.ok ? 'present' : !r.failed && WINGET_NONE.includes(r.status) ? 'absent' : 'unknown');

export function antigravityPrereqs(pm, platform, home, app = true, q = quiet) {
  const out = [];
  const winApp = pm === 'winget' && platform === 'win32';
  if (!findAgy(home, platform)) {
    out.push(platform === 'darwin' && pm === 'brew'
      ? { desc: `install agy (${BREW_AGY_LIMIT})`, run: [['brew', 'install', '--cask', 'antigravity-cli']] }
      : { desc: `agy is missing: install it from https://antigravity.google/docs/getting-started`, run: [], manual: true });
  }
  if (!app) return out;
  const listed = winApp ? wingetAnswer(q(['winget', 'list', '--id', 'Google.Antigravity', '-e'])) : null;
  if (listed === 'unknown') { out.push({ desc: 'could not check for the Antigravity app (winget list gave no answer): install it from https://antigravity.google/download', note: true }); return out; }
  const appInstalled = platform === 'darwin'
    ? exists('/Applications/Antigravity.app') || exists(path.join(home, 'Applications', 'Antigravity.app'))
    : listed === 'present';
  if (!appInstalled) {
    if (platform === 'darwin' && pm === 'brew') out.push({ desc: 'install the Antigravity app', run: [['brew', 'install', '--cask', 'antigravity']] });
    else if (winApp) out.push({ desc: 'install the Antigravity app', run: [['winget', 'install', '--id', 'Google.Antigravity', '-e', '--scope', 'user', '--accept-source-agreements', '--accept-package-agreements']], undo: [['winget', 'uninstall', '--id', 'Google.Antigravity', '-e']] });
    else out.push({ desc: 'The Antigravity app is optional: download it from https://antigravity.google/download', note: true });
  }
  return out;
}

// The Cursor IDE app, only when the app is missing. Unpinned like the Antigravity app: the package manager's current version (#375).
// A winget list with no clear answer returns a note and no install, so no undo can remove the user's own app; brew checks its own
// cask list too (a custom --appdir). Linux: manual download only.
export function cursorAppPrereqs(pm, platform, home, q = quiet, ex = exists) {
  const winApp = pm === 'winget' && platform === 'win32';
  const listed = winApp ? wingetAnswer(q(['winget', 'list', '--id', 'Anysphere.Cursor', '-e'])) : null;
  if (listed === 'unknown') return [{ desc: 'could not check for the Cursor app (winget list gave no answer): install it from https://cursor.com/download', note: true }];
  const installed = platform === 'darwin'
    ? ex(['/Applications/Cursor.app', path.join(home, 'Applications', 'Cursor.app')]) || (pm === 'brew' && q(['brew', 'list', '--cask', 'cursor']).ok)
    : listed === 'present';
  if (installed) return [];
  if (platform === 'darwin' && pm === 'brew') return [{ desc: 'install the Cursor app', run: [['brew', 'install', '--cask', 'cursor']], undo: [['brew', 'uninstall', '--cask', 'cursor']] }];
  if (winApp) return [{ desc: 'install the Cursor app', run: [['winget', 'install', '--id', 'Anysphere.Cursor', '-e', '--scope', 'user', '--accept-source-agreements', '--accept-package-agreements']], undo: [['winget', 'uninstall', '--id', 'Anysphere.Cursor', '-e']] }];
  return [{ desc: 'Cursor app: no brew or winget here, download it from https://cursor.com/download', note: true }];
}

// Bun for Context Mode (JS/TS in ctx_execute). One route per OS; the undo is recorded only when this install ran.
// Linux and Windows: the pinned release zip is downloaded to a file, checked against the pinned SHA256 and only then extracted,
// so no upstream installer script runs. Linux: no shell profile edit (the engine finds ~/.bun/bin itself). Windows: ~\.bun\bin goes on the user PATH.
const VERIFY = fileURLToPath(new URL('./verify-sha256.mjs', import.meta.url));
const psQ = (s) => s.replace(/['‘’‚‛]/g, (c) => c + c); // PowerShell single-quote escape for O'Neil and typographic quotes
const psRun = (script) => ['powershell', '-NoProfile', '-NonInteractive', '-Command', script];
const psAddPath = (bin) => `$p = [string][Environment]::GetEnvironmentVariable('Path', 'User'); if (($p -split ';').TrimEnd('\\') -notcontains '${psQ(bin)}'.TrimEnd('\\')) { [Environment]::SetEnvironmentVariable('Path', ($p.TrimEnd(';') + ';${psQ(bin)}'), 'User') }`;
const psRemovePath = (bin) => `$p = [string][Environment]::GetEnvironmentVariable('Path', 'User'); [Environment]::SetEnvironmentVariable('Path', (($p -split ';' | Where-Object { $_ -and $_.TrimEnd('\\') -ne '${psQ(bin)}'.TrimEnd('\\') }) -join ';'), 'User')`;

export function bunPathCommand(home) {
  const bin = path.join(home, '.bun', 'bin');
  return {
    // tool bun-path, not bun: a moved Bun pin must not undo and re-record this PATH entry.
    tool: 'bun-path', desc: 'put ~\\.bun\\bin on your user PATH (open a new terminal)', optional: true,
    run: [psRun(psAddPath(bin))],
    undo: [psRun(psRemovePath(bin))],
    // Already in the saved user PATH (only this shell is stale): skip, so --uninstall never removes an entry the user made.
    skipIfOutput: { cmd: psRun(`if (([string][Environment]::GetEnvironmentVariable('Path', 'User') -split ';').TrimEnd('\\') -contains '${psQ(bin)}'.TrimEnd('\\')) { exit 0 } else { exit 1 }`) },
  };
}

export function bunInstall(home, dir, platform, pm, arch = process.arch) {
  const bunDir = path.join(home, '.bun');
  if (platform === 'darwin') {
    return pm === 'brew' ? { tool: 'bun', desc: 'install bun', run: [['brew', 'install', 'oven-sh/bun/bun']], undo: [['brew', 'uninstall', 'bun']], optional: true } : null;
  }
  const { version, sha256 } = bunPin();
  const name = `bun-${platform === 'win32' ? 'windows' : 'linux'}-${arch === 'arm64' ? 'aarch64' : 'x64'}`;
  if (!sha256[name.slice(4)]) return null;
  const zip = path.join(dir, `${name}-${version}.zip`);
  const download = [platform === 'win32' ? 'curl.exe' : 'curl', '-fsSL', '-o', zip, ...CURL_RETRY, `https://github.com/oven-sh/bun/releases/download/bun-v${version}/${name}.zip`];
  const verify = [process.execPath, VERIFY, zip, sha256[name.slice(4)]];
  // Undo removes only the binary this install put there, then the dirs it made if they are empty: ~/.bun may hold the user's cache or global packages.
  const exe = platform === 'win32' ? 'bun.exe' : 'bun';
  const rm = [process.execPath, '-e', `const fs = require("fs"), p = require("path"), d = p.join(require("os").homedir(), ".bun"), b = p.join(d, "bin"); if (p.resolve(process.argv[1]) !== d) { console.error("refusing to remove under " + process.argv[1] + ": not the Bun dir lean-agents installed"); process.exit(1); } try { fs.unlinkSync(p.join(b, "${exe}")); } catch {} for (const x of [b, d]) try { fs.rmdirSync(x); } catch {}`, bunDir];
  if (platform === 'win32') {
    const bin = path.join(bunDir, 'bin');
    const tmp = path.join(dir, `${name}-${version}`);
    // .NET ZipFile, not Expand-Archive: powershell 5.1 started from pwsh 7 loads the 7.x Archive module and fails. Stop: any error exits non-zero.
    const ps = `$ErrorActionPreference = 'Stop'; Add-Type -AssemblyName System.IO.Compression.FileSystem; if (Test-Path -LiteralPath '${psQ(tmp)}') { Remove-Item -Recurse -Force -LiteralPath '${psQ(tmp)}' }; [System.IO.Compression.ZipFile]::ExtractToDirectory('${psQ(zip)}', '${psQ(tmp)}'); New-Item -ItemType Directory -Force '${psQ(bin)}' | Out-Null; Move-Item -Force '${psQ(path.join(tmp, name, 'bun.exe'))}' '${psQ(path.join(bin, 'bun.exe'))}'; Remove-Item -Recurse -Force '${psQ(tmp)}'; ${psAddPath(bin)}`;
    return {
      tool: 'bun', desc: `install bun ${version}`, optional: true,
      run: [download, verify, psRun(ps)],
      undo: [rm, psRun(psRemovePath(bin))],
    };
  }
  return {
    tool: 'bun', desc: `install bun ${version}`, optional: true,
    run: [download, verify, ['mkdir', '-p', path.join(bunDir, 'bin')], ['unzip', '-q', '-j', '-o', zip, `${name}/bun`, '-d', path.join(bunDir, 'bin')]],
    undo: [rm],
  };
}

export function rtkInstall(home, dir, platform, arch = process.arch) {
  if (platform !== 'linux') return null;
  const P = path.posix; // Linux steps, even when planned (tests) on Windows
  const { version, sha256 } = rtkPin();
  const aarch = arch === 'arm64' || arch === 'aarch64' ? 'aarch64' : (arch === 'x64' || arch === 'x86_64' ? 'x64' : null);
  if (!aarch) return null;
  const hash = sha256?.[`linux-${aarch}`];
  if (!hash) return null;
  const triple = `${aarch === 'aarch64' ? 'aarch64' : 'x86_64'}-unknown-linux-musl`;
  const tarball = P.join(dir, `rtk-${triple}-${version}.tar.gz`);
  const download = ['curl', '-fsSL', '--create-dirs', '-o', tarball, ...CURL_RETRY, `https://github.com/rtk-ai/rtk/releases/download/${version}/rtk-${triple}.tar.gz`];
  const verify = [process.execPath, VERIFY, tarball, hash];
  const binDir = P.join(home, '.local', 'bin');
  const bin = P.join(binDir, 'rtk');
  const rm = [process.execPath, '-e', 'require("fs").rmSync(process.argv[1], { force: true })', bin]; // only the binary: ~/.local/bin holds other tools
  return {
    tool: 'rtk', desc: `install rtk ${version}`, optional: true,
    run: [download, verify, ['mkdir', '-p', binDir], ['tar', '-xzf', tarball, '-C', binDir, 'rtk']],
    undo: [rm],
  };
}

export const bunPresent = (home) => Boolean(which('bun')) || fs.existsSync(path.join(home, '.bun', 'bin', isWin ? 'bun.exe' : 'bun'));

// Node < 24.20 on Windows can abort on exit after the skills CLI finished (nodejs/node#56645); its "Done!" is the proof.
export const exitCrashAfterDone = (argv, status, out) => status !== 0 && argv.some((a) => /^skills@/.test(a)) && /Done!/.test(out) && /UV_HANDLE_CLOSING/.test(out);

// Quiet mode: the child writes straight to the log file (no buffer limit); the last lines of this command are read back for a failure report.
// Returns null when the log cannot be opened, so the caller falls back to the terminal.
function runLogged(argv, env, logFile, tail) {
  let fd;
  try { fd = fs.openSync(logFile, 'a+', 0o600); } catch { return null; }
  try {
    const start = fs.fstatSync(fd).size;
    fs.writeSync(fd, `$ ${argv.join(' ')}\n`);
    const r = spawnFor(argv, { stdio: ['ignore', fd, fd], env: { ...allowedEnv(), ...env } });
    const size = fs.fstatSync(fd).size;
    const buf = Buffer.alloc(Math.min(size - start, 65536));
    fs.readSync(fd, buf, 0, buf.length, size - buf.length);
    const out = buf.toString('utf8');
    let ok = r.status === 0;
    if (exitCrashAfterDone(argv, r.status, out)) { fs.writeSync(fd, '(the skills CLI finished, then Node crashed on exit: nodejs/node#56645, fixed in Node 24.20; counted as done)\n'); ok = true; }
    fs.writeSync(fd, `${r.error ? `${r.error.message}\n` : ''}[exit ${r.status ?? r.signal ?? -1}]\n`);
    tail?.push(...out.split(/\r?\n/).filter(Boolean).slice(-20));
    return { ok, status: r.status ?? -1 };
  } finally { fs.closeSync(fd); }
}

// `codes` collects the exit status; `json` sends the child's stdout to stderr so stdout stays one JSON object.
// `logFile` (quiet mode): stdout and stderr go to that file, never to the terminal; `tail` collects the last lines of this command for a failure report.
// stdin is closed so a child that asks a question takes its default instead of waiting for an answer nobody can see (rtk init: N, #489).
export function run(argv, { dryRun, log, env, json, codes, logFile, tail }) {
  if (logFile && !dryRun) {
    const q = runLogged(argv, env, logFile, tail);
    if (q) { codes?.push(q.status); return q.ok; }
  }
  log(`  $ ${argv.join(' ')}`);
  if (dryRun) return true;
  const isSkills = argv.some((a) => /^skills@/.test(a));
  const r = isSkills
    ? spawnFor(argv, { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', env: { ...allowedEnv(), ...env } })
    : spawnFor(argv, { stdio: ['ignore', json ? 2 : 'inherit', json ? 2 : 'inherit'], env: { ...allowedEnv(), ...env } });
  if (isSkills) {
    (json ? process.stderr : process.stdout).write(r.stdout ?? '');
    process.stderr.write(r.stderr ?? '');
  }
  codes?.push(r.status ?? -1);
  if (exitCrashAfterDone(argv, r.status, `${r.stdout ?? ''}${r.stderr ?? ''}`)) {
    log('  (the skills CLI finished, then Node crashed on exit: nodejs/node#56645, fixed in Node 24.20; counted as done)');
    return true;
  }
  return r.status === 0;
}

export function quiet(argv, timeout = 30000, env = {}) {
  const r = spawnFor(argv, { encoding: 'utf8', timeout, env: { ...allowedEnv(), ...env } });
  // `failed`: the command did not finish (timeout, signal, not runnable), so a non-zero status says nothing about its answer.
  return { ok: r.status === 0, failed: Boolean(r.error || r.signal), status: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

export const exists = (p) => Array.isArray(p) ? p.some(x => fs.existsSync(x)) : fs.existsSync(p);

