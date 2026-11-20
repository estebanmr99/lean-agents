// Prerequisite planner for a fresh machine (#179, PR1). Pure: from an injected probe it returns the ordered steps a fresh
// Mac, Windows or Linux needs (Xcode CLT, Homebrew, git, nvm, Node 24, uv, rtk, bun). It never runs a command, never reads
// the real env or disk; the caller (the engine, later PRs) probes, shows the plan, asks once and runs `commands`.
// Every URL, flag and version without a pin in core/pins.json is marked VERIFY and listed in docs/compatibility.md.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PINS } from './pins.mjs';
import { bunInstall } from './system.mjs';
import { satisfies, compare, minVersion, nvmInstallArgv } from './node-runtime.mjs';

const VERIFY_SHA = fileURLToPath(new URL('./verify-sha256.mjs', import.meta.url));

// nvm-sh install script and nvm-windows setup: versions and the setup hash come from tests/ci-downloads.json (checked 2026-11-11).
// The install.sh hash is not pinned anywhere yet. VERIFY
const NVM_VERSION = 'v0.41.0';
const NVM_INSTALL_URL = `https://raw.githubusercontent.com/nvm-sh/nvm/${NVM_VERSION}/install.sh`;
const NVM_WIN = {
  url: 'https://github.com/coreybutler/nvm-windows/releases/download/v2.0.1/nvm-2.0.1-x64-setup.exe',
  sha256: '2ba6ab6290fdc7d1e608e76c97577ca6e1df772b2d59ab8ebc01e10788de8e57',
};
// The setup just ran, so this process has no nvm on PATH: read NVM_HOME and NVM_SYMLINK from the saved user or machine environment. VERIFY
const NVM_WIN_INSTALL_24 = ['powershell', '-NoProfile', '-NonInteractive', '-Command',
  "foreach ($n in 'NVM_HOME', 'NVM_SYMLINK') { $v = [Environment]::GetEnvironmentVariable($n, 'User'); if (-not $v) { $v = [Environment]::GetEnvironmentVariable($n, 'Machine') }; if ($v) { Set-Item \"env:$n\" $v } }; " +
  "if (-not $env:NVM_HOME) { Write-Error 'NVM_HOME is not set: nvm-windows did not install'; exit 1 }; & (Join-Path $env:NVM_HOME 'nvm.exe') install 24; exit $LASTEXITCODE"];
// Homebrew installer: commit and sha256 pinned in core/pins.json. VERIFY (unattended behaviour).
// The uv installer is unpinned (current script). VERIFY
const BREW = PINS['homebrew-installer'];
const UV_INSTALL_URL = 'https://astral.sh/uv/install.sh';

// Newest `engines.node` floor among the pinned tools; Node 24 is installed under nvm only when nothing meets it.
const toolFloor = () => ['context-mode', 'gsd-core'].map((k) => PINS[k]?.node).filter(Boolean)
  .reduce((a, b) => (compare(minVersion(b), minVersion(a)) > 0 ? b : a));
const floorText = (range) => minVersion(range).join('.');

// nvm's undo is planned only when ~/.nvm did not exist before this run (`nvmDirExisted`), and runs later: it removes exactly the ~/.nvm
// of the home the state recorded, and only when every Node under it is one lean-agents installs (the floor's major, v24) and none
// holds a global package beyond npm, corepack and the npm tools lean-agents installs; otherwise it stays and says why. The Node is a
// placeholder the engine swaps for the Node running it at undo time (`undoArgv`): no bare `node` on PATH, no path stored.
export const UNDO_NODE = '<lean-node>';
export const undoArgv = (argv, execPath = process.execPath) => (argv[0] === UNDO_NODE ? [execPath, ...argv.slice(1)] : argv);
// Did ~/.nvm exist before this run? A resumed run still owns a ~/.nvm that an earlier, unfinished nvm step created (its recorded
// undo is not empty); one an earlier run recorded with an empty undo existed before lean-agents and stays the user's.
export const nvmDirExistedBefore = (savedCommands, dirExists) => !(savedCommands ?? []).some((c) => c.resumeKey === 'prereq:nvm' && c.undo?.length) && dirExists;
// Runs under `node -e`: argv is [dir, home, major, recorded packages as JSON].
const NVM_UNDO = [
  "const fs=require('fs'),p=require('path'),[d,h,m,a]=process.argv.slice(1),ok=new Set(['npm','corepack',...JSON.parse(a)]);",
  "const keep=w=>{console.log('kept '+d+': '+w);process.exit()};",
  "if(p.resolve(d)!==p.resolve(h,'.nvm'))keep('it is not the .nvm of the home this install recorded');",
  "let s;try{s=fs.lstatSync(d)}catch{process.exit()}",
  "if(!s.isDirectory())keep('it is not a plain directory');",
  "const ls=x=>{try{return fs.readdirSync(x,{withFileTypes:true})}catch{return[]}},v=p.join(d,'versions','node'),vs=ls(v).filter(e=>e.isDirectory()).map(e=>e.name);",
  "const o=vs.filter(n=>!new RegExp('^v'+m+'[.]').test(n));",
  "if(o.length)keep('it holds Node versions lean-agents did not install ('+o.join(', ')+')');",
  "const g=[];for(const n of vs){const nm=p.join(v,n,'lib','node_modules');for(const e of ls(nm).filter(e=>e.name[0]!=='.')){const q=e.name.startsWith('@')?ls(p.join(nm,e.name)).map(c=>e.name+'/'+c.name):[e.name];for(const x of q)if(!ok.has(x))g.push(x+' ('+n+')')}}",
  "if(g.length)keep('a Node under it has global packages lean-agents did not install ('+g.join(', ')+')');",
  'fs.rmSync(d,{recursive:true,force:true})',
].join('');
// The npm tools lean-agents may install globally under that Node (CI-only agent pins excluded).
const recordedPackages = () => Object.values(PINS).filter((p) => p.kind === 'npm' && !p.ciOnly).map((p) => p.source);
const nvmUndo = (dir, home, major) => [[UNDO_NODE, '-e', NVM_UNDO, dir, home, String(major), JSON.stringify(recordedPackages())]];

// The agents --everything configures: Claude Code and OpenCode 2 everywhere; on Windows the team preset adds the ones found
// (Copilot CLI, VS Code Copilot, Antigravity) and lists the missing ones so the plan says what it skipped.
export const TEAM_AGENTS = ['copilot-cli', 'vscode-copilot', 'antigravity'];
export function everythingAgents({ platform, detected = {}, project = false }) {
  const base = ['claude', 'opencode-v2'];
  if (platform !== 'win32') return { agents: base, skipped: [] };
  const team = TEAM_AGENTS.filter((a) => !(project && a === 'antigravity')); // Antigravity has no project scope
  return { agents: [...base, ...team.filter((a) => detected[a])], skipped: team.filter((a) => !detected[a]) };
}

// winget ids, brew formulas `rtk` and `uv`, and `--scope user` for Git.Git are unverified on a fresh machine. VERIFY
const WINGET = (id) => ['winget', 'install', '--id', id, '-e', '--scope', 'user', '--accept-source-agreements', '--accept-package-agreements'];

// probe: { platform, arch, home, tmp, execPath, has: { brew, winget, uv, rtk, bun, git, clt, nvm, jq }, nodeActive: '22.20.0' | null,
//   nvmNodes: ['24.15.0'], nvmDirExisted: true (~/.nvm was there before this run, so its undo is empty), proxyEnv: ['HTTPS_PROXY'] (names only), needsGit: false, done: ['prereq:nvm'] (resume stamps), bunInstall: stub for tests }
export function planPrereqs(probe) {
  const { platform, arch = 'x64', home, has = {}, nodeActive = null, nvmNodes = [], nvmDirExisted = false, proxyEnv = [], needsGit = false, done = [], terminals = [], agents = [] } = probe;
  const win = platform === 'win32', mac = platform === 'darwin';
  const P = win ? path.win32 : path.posix;
  const tmp = probe.tmp ?? P.join(home, '.cache', 'lean-agents');
  const node = probe.execPath ?? 'node';
  const nvmDir = P.join(home, '.nvm');
  const floor = toolFloor();
  const fetch = (url, file) => [win ? 'curl.exe' : 'curl', '-fsSL', '--create-dirs', '-o', file, url];
  const steps = [];
  const add = (s) => steps.push({ needsConsent: true, undo: null, skipIf: null, ...s, resumeKey: `prereq:${s.id}` });

  if (mac) {
    add({
      id: 'xcode-clt', label: 'Xcode Command Line Tools', why: 'Provides git and the compilers Homebrew needs on a fresh Mac.',
      commands: [['xcode-select', '--install']], // opens a system dialog; headless route via softwareupdate VERIFY
      skipIf: has.clt ? 'Command Line Tools are installed' : null,
    });
    add({
      id: 'homebrew', label: 'Homebrew', why: 'Package manager lean-agents uses for rtk, uv and bun on macOS.',
      commands: [fetch(BREW.url, P.join(tmp, 'brew-install.sh')), [node, VERIFY_SHA, P.join(tmp, 'brew-install.sh'), BREW.sha256], ['env', 'NONINTERACTIVE=1', '/bin/bash', P.join(tmp, 'brew-install.sh')]],
      skipIf: has.brew ? 'brew is on PATH' : null, // undo: Homebrew's uninstaller is interactive, so none
    });
  }

  if (win && needsGit) {
    add({
      id: 'git', label: 'Git', why: 'A selected tool needs git (the release itself does not).',
      commands: has.winget ? [WINGET('Git.Git')] : [], manual: has.winget ? undefined : 'https://git-scm.com/downloads',
      skipIf: has.git ? 'git is on PATH' : null,
    });
  }

  // The brew-based steps below run after the Homebrew step, so a planned brew counts.
  const pm = mac && (has.brew || steps.some((s) => s.id === 'homebrew')) ? 'brew' : win && has.winget ? 'winget' : null;

  if (win) {
    const setup = P.join(tmp, 'nvm-setup.exe');
    add({
      id: 'nvm', label: 'nvm-windows', why: 'Node manager: lets the tools get Node 24 without touching your Node.',
      commands: [fetch(NVM_WIN.url, setup), [node, VERIFY_SHA, setup, NVM_WIN.sha256], [setup, '/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART']], // admin-free path VERIFY
      skipIf: has.nvm ? 'nvm is installed' : null,
    });
  } else {
    const script = P.join(tmp, 'nvm-install.sh');
    add({
      id: 'nvm', label: 'nvm', why: 'Node manager: lets the tools get Node 24 without touching your Node.',
      // PROFILE=/dev/null keeps the installer away from the shell profile; the engine finds $NVM_DIR itself. Script hash VERIFY.
      commands: [fetch(NVM_INSTALL_URL, script), ['env', `NVM_DIR=${nvmDir}`, 'PROFILE=/dev/null', 'bash', script]],
      undo: nvmDirExisted ? [] : nvmUndo(nvmDir, home, minVersion(floor)[0]),
      skipIf: has.nvm ? 'nvm is installed' : null,
    });
  }

  const haveFloor = (nodeActive && satisfies(nodeActive, floor)) || nvmNodes.some((v) => satisfies(v, floor));
  add({
    id: 'node-24', label: 'Node 24 (under nvm)', why: `Context Mode and GSD need Node ${floorText(floor)}+; your own Node stays the default.`,
    commands: [win ? NVM_WIN_INSTALL_24 : ['env', `NVM_DIR=${nvmDir}`, ...nvmInstallArgv(24)]], // nvm-windows `install 24` accepts a major: VERIFY
    skipIf: haveFloor ? `Node ${floorText(floor)}+ is already available` : null,
  });

  const route = (brew, wingetId, manual) => (pm === 'brew' && brew ? [brew] : pm === 'winget' && wingetId ? [WINGET(wingetId)] : null) ?? { manual };
  const tool = (id, label, why, has_, r, extra = {}) => add({
    id, label, why, skipIf: has_ ? `${id} is on PATH` : null, ...extra,
    ...(Array.isArray(r) ? { commands: r } : { commands: [], manual: r.manual }),
  });

  const uvScript = P.join(tmp, 'uv-install.sh');
  tool('uv', 'uv', 'Runs Serena (uvx).', has.uv,
    !win && !pm ? [fetch(UV_INSTALL_URL, uvScript), ['sh', uvScript]] : route(['brew', 'install', 'uv'], 'astral-sh.uv', 'https://docs.astral.sh/uv/getting-started/installation/'), // direct script unpinned: VERIFY
    pm === 'brew' ? { undo: [['brew', 'uninstall', 'uv']] } : pm === 'winget' ? { undo: [['winget', 'uninstall', '--id', 'astral-sh.uv', '-e']] } : {});
  tool('rtk', 'RTK', 'Compresses command output for the agents.', has.rtk,
    route(['brew', 'install', 'rtk'], 'rtk-ai.rtk', 'https://github.com/rtk-ai/rtk#installation'),
    pm === 'brew' ? { undo: [['brew', 'uninstall', 'rtk']] } : pm === 'winget' ? { undo: [['winget', 'uninstall', '--id', 'rtk-ai.rtk', '-e']] } : {});

  if (terminals.includes('warp') && agents.includes('claude')) {
    tool('jq', 'jq', 'The Warp plugin for Claude Code reads hook JSON with jq.', has.jq,
      route(['brew', 'install', 'jq'], 'jqlang.jq', 'https://jqlang.org/download/'),
      pm === 'brew' ? { undo: [['brew', 'uninstall', 'jq']] } : pm === 'winget' ? { undo: [['winget', 'uninstall', '--id', 'jqlang.jq', '-e']] } : {});
  }

  const bun = (probe.bunInstall ?? bunInstall)(home, tmp, platform, pm, arch); // probe.bunInstall: tests only
  add({
    id: 'bun', label: 'Bun', why: 'Lets Context Mode run JS and TS.', skipIf: has.bun ? 'bun is installed' : null,
    // the zip lands in tmp
    commands: bun ? [...(mac ? [] : [[node, '-e', 'require("fs").mkdirSync(process.argv[1], { recursive: true })', tmp]]), ...bun.run] : [],
    undo: bun?.undo ?? null,
    ...(bun ? {} : { manual: 'https://bun.sh/docs/installation' }),
  });

  return steps.map((s) => {
    const out = { ...s, skipIf: s.skipIf ?? (done.includes(s.resumeKey) ? 'finished in an earlier run' : null) };
    if (proxyEnv.length && out.commands.length) out.proxyEnv = proxyEnv;
    return out;
  });
}

// What is left to run: steps with no skipIf.
export const pendingPrereqs = (steps) => steps.filter((s) => !s.skipIf);
