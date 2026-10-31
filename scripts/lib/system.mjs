// Detection of agents and prerequisites, and running external commands.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

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

export function detectAgents() {
  const found = {};
  const claude = version('claude');
  if (claude) found.claude = claude;
  const oc = version('opencode');
  if (oc) found[oc.startsWith('1.') ? 'opencode-v1' : 'opencode-v2'] = oc;
  return found;
}

export function packageManager() {
  if (isWin) return which('winget') ? 'winget' : which('scoop') ? 'scoop' : null;
  return which('brew') ? 'brew' : null;
}

// What each tool needs on PATH, and how to get it. Agent CLIs are never installed here.
export function prereqFor(tool, pm) {
  const brew = (f) => (pm === 'brew' ? [['brew', 'install', f]] : null);
  const winget = (id) => (pm === 'winget' ? [['winget', 'install', '--id', id, '-e', '--scope', 'user']] : null);
  switch (tool) {
    case 'rtk':
      return { bin: 'rtk', install: brew('rtk') ?? winget('rtk-ai.rtk'), manual: 'https://github.com/rtk-ai/rtk#installation' };
    case 'context-mode':
      return { bin: 'context-mode', install: [['npm', 'install', '-g', 'context-mode']] };
    case 'serena':
      return { bin: 'uvx', install: brew('uv') ?? winget('astral-sh.uv'), manual: 'https://docs.astral.sh/uv/getting-started/installation/' };
    case 'playwright':
    case 'caveman':
      return { bin: 'npx', install: null, manual: 'https://nodejs.org/' };
    case 'i-have-adhd':
      return { bin: 'git', install: brew('git') ?? winget('Git.Git'), manual: 'https://git-scm.com/downloads' };
    default:
      return null;
  }
}

export function run(argv, { dryRun, log }) {
  log(`  $ ${argv.join(' ')}`);
  if (dryRun) return true;
  const r = spawnSync(argv[0], argv.slice(1), { stdio: 'inherit', shell: useShell(argv[0]) });
  return r.status === 0;
}

export function quiet(argv) {
  const r = spawnSync(argv[0], argv.slice(1), { encoding: 'utf8', shell: useShell(argv[0]), timeout: 30000 });
  return { ok: r.status === 0, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

export const exists = (p) => fs.existsSync(p);
