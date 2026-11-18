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
// Official Homebrew and uv installers: unpinned, current script. VERIFY (unattended behaviour, no published hash)
const BREW_INSTALL_URL = 'https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh';
const UV_INSTALL_URL = 'https://astral.sh/uv/install.sh';

// Newest `engines.node` floor among the pinned tools; Node 24 is installed under nvm only when nothing meets it.
const toolFloor = () => ['context-mode', 'gsd-core'].map((k) => PINS[k]?.node).filter(Boolean)
  .reduce((a, b) => (compare(minVersion(b), minVersion(a)) > 0 ? b : a));
const floorText = (range) => minVersion(range).join('.');

// winget ids, brew formulas `rtk` and `uv`, and `--scope user` for Git.Git are unverified on a fresh machine. VERIFY
const WINGET = (id) => ['winget', 'install', '--id', id, '-e', '--scope', 'user', '--accept-source-agreements', '--accept-package-agreements'];

// probe: { platform, arch, home, tmp, execPath, has: { brew, winget, uv, rtk, bun, git, clt, nvm }, nodeActive: '22.20.0' | null,
//   nvmNodes: ['24.15.0'], proxyEnv: ['HTTPS_PROXY'] (names only), needsGit: false, done: ['prereq:nvm'] (resume stamps), bunInstall: stub for tests }
export function planPrereqs(probe) {
  const { platform, arch = 'x64', home, has = {}, nodeActive = null, nvmNodes = [], proxyEnv = [], needsGit = false, done = [] } = probe;
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
      commands: [fetch(BREW_INSTALL_URL, P.join(tmp, 'brew-install.sh')), ['env', 'NONINTERACTIVE=1', '/bin/bash', P.join(tmp, 'brew-install.sh')]],
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
      undo: [['rm', '-rf', nvmDir]], // only runs when this step ran: skipIf covers an existing nvm
      skipIf: has.nvm ? 'nvm is installed' : null,
    });
  }

  const haveFloor = (nodeActive && satisfies(nodeActive, floor)) || nvmNodes.some((v) => satisfies(v, floor));
  add({
    id: 'node-24', label: 'Node 24 (under nvm)', why: `Context Mode and GSD need Node ${floorText(floor)}+; your own Node stays the default.`,
    commands: [win ? ['nvm', 'install', '24'] : ['env', `NVM_DIR=${nvmDir}`, ...nvmInstallArgv(24)]], // nvm-windows `install 24` accepts a major: VERIFY
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

  const bun = (probe.bunInstall ?? bunInstall)(home, tmp, platform, pm, arch); // probe.bunInstall: tests only
  add({
    id: 'bun', label: 'Bun', why: 'Lets Context Mode run JS and TS.', skipIf: has.bun ? 'bun is on PATH' : null,
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
