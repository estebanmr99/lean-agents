// Parallel agent sessions: one git worktree per task, one worker agent in each, merged one at a time.
// Commands are argv arrays, never shell strings. State lives in <git common dir>/lean-agents/.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { loadProfile, modelFor } from './render.mjs';
import { which } from './system.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const LOG_TAIL_BYTES = 2000;

// User-facing tier names; profiles call the cheapest one "fast".
export const TIERS = { cheap: 'fast', balanced: 'balanced', strong: 'strong' };
const ROLE_TIER = { plan: 'strong', build: 'balanced', explore: 'cheap', research: 'cheap' };
const DEFAULT_PROFILE = { claude: 'claude-subscription', orca: 'claude-subscription' };

export function git(cwd, args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  return { ok: r.status === 0, out: (r.stdout ?? '').trim(), err: (r.stderr ?? '').trim() };
}

function gitOrThrow(cwd, args) {
  const r = git(cwd, args);
  if (!r.ok) throw new Error(`git ${args.join(' ')}: ${r.err || r.out}`);
  return r.out;
}

// Task file: optional `---` front matter (role, tier, agent, check), then the prompt body.
export function parseTask(file) {
  const text = fs.readFileSync(file, 'utf8');
  const name = path.basename(file).replace(/\.md$/, '');
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) throw new Error(`task file name "${name}" must be lowercase letters, digits and dashes`);
  const meta = {};
  let body = text;
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (m) {
    for (const line of m[1].split(/\r?\n/)) {
      const kv = line.match(/^(\w+):\s*(.*)$/);
      if (kv) meta[kv[1]] = kv[2].trim();
    }
    body = text.slice(m[0].length);
  }
  return { name, role: meta.role ?? 'build', tier: meta.tier, agent: meta.agent, check: meta.check, body };
}

export function tierOf(task, override) {
  const tier = override ?? task.tier ?? ROLE_TIER[task.role];
  if (!tier) throw new Error(`task ${task.name}: unknown role "${task.role}" (use plan, build, explore or research, or set tier)`);
  if (!TIERS[tier]) throw new Error(`task ${task.name}: unknown tier "${tier}" (use cheap, balanced or strong)`);
  return tier;
}

// Model for a tier through a profile; Claude aliases (haiku, sonnet, opus) come from claude-subscription.
export function tierModel(agent, tier, profileName) {
  const profile = loadProfile(ROOT, profileName ?? DEFAULT_PROFILE[agent]);
  return modelFor(profile, TIERS[tier])?.model ?? null;
}

// Only `Read <path> and follow it.` goes on the command line; the task text stays in the file.
export const instruction = (promptFile) => `Read ${promptFile} and follow it.`;

export function buildWorkerCommand({ agent, name, model, promptFile, dir, base }) {
  const instr = instruction(promptFile);
  if (agent === 'claude') {
    return ['claude', '--bg', '-n', name, '--permission-mode', 'plan', ...(model ? ['--model', model] : []), instr];
  }
  if (agent === 'opencode') {
    return ['opencode', 'run', '--title', name, '--agent', 'plan', ...(model ? ['-m', model] : []), '-f', promptFile, instr];
  }
  if (agent === 'orca') {
    return ['orca', 'worktree', 'create', '--name', name, '--agent', 'claude', ...(model ? ['--model', model] : []),
      '--prompt', instr, '--surface', 'terminal', '--base-branch', base, '--json'];
  }
  throw new Error(`no command for agent "${agent}"`);
}

export const orcaAvailable = () => Boolean(which('orca')) && spawnSync('orca', ['agent-context', '--json'], { stdio: 'ignore' }).status === 0;

export function pickAgent(requested) {
  if (requested && requested !== 'auto') return requested;
  if (orcaAvailable()) return 'orca';
  if (which('claude')) return 'claude';
  if (which('opencode')) return 'opencode';
  return 'print';
}

// Quoted for display only, so the user can paste it into a terminal.
export const display = (argv) => argv.map((a) => (/^[\w./:=@%+-]+$/.test(a) ? a : `'${a.replace(/'/g, "'\\''")}'`)).join(' ');

export function repoInfo(cwd) {
  const top = gitOrThrow(cwd, ['rev-parse', '--show-toplevel']);
  const common = path.resolve(top, gitOrThrow(top, ['rev-parse', '--git-common-dir']));
  return { top, stateDir: path.join(common, 'lean-agents') };
}

const workersFile = (stateDir) => path.join(stateDir, 'workers.json');

export function loadWorkers(stateDir) {
  try { return JSON.parse(fs.readFileSync(workersFile(stateDir), 'utf8')); } catch { return { base: null, workers: [] }; }
}

function saveWorkers(stateDir, data) {
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(workersFile(stateDir), `${JSON.stringify(data, null, 2)}\n`);
}

export const statusOf = (stateDir, name) => {
  try { return fs.readFileSync(path.join(stateDir, name, 'status'), 'utf8').trim() || 'running'; } catch { return 'running'; }
};

function logTail(stateDir, name) {
  const file = path.join(stateDir, name, 'log');
  if (!fs.existsSync(file)) return '';
  const buf = fs.readFileSync(file);
  return buf.subarray(Math.max(0, buf.length - LOG_TAIL_BYTES)).toString('utf8').trim().split('\n').slice(-5).join('\n');
}

function writePrompt(stateDir, task, statusFile) {
  const dir = path.join(stateDir, task.name);
  fs.mkdirSync(dir, { recursive: true });
  const promptFile = path.join(dir, 'task.md');
  fs.writeFileSync(promptFile, [
    task.body.trim(),
    '',
    '## Rules from the coordinator',
    '- Work only in this worktree. Do not push. Commit your work on this branch.',
    `- Report by writing one line to ${statusFile}: \`running\`, \`blocked: <question>\` or \`done\`.`,
    '',
  ].join('\n'));
  fs.writeFileSync(statusFile, 'running\n');
  return promptFile;
}

// Orca prefixes the branch with the user's handle; find it by suffix and rename it to lean/<name>.
function adoptOrcaBranch(top, name, branch) {
  const list = gitOrThrow(top, ['worktree', 'list', '--porcelain']).split('\n\n').map((b) => ({
    dir: (b.match(/^worktree (.*)$/m) ?? [])[1], branch: ((b.match(/^branch refs\/heads\/(.*)$/m) ?? [])[1]),
  }));
  const hit = list.find((w) => w.branch && (w.branch === name || w.branch.endsWith(`/${name}`)));
  if (!hit) throw new Error(`Orca created no worktree for "${name}" (VERIFY the Orca output)`);
  if (hit.branch !== branch) gitOrThrow(hit.dir, ['branch', '-m', hit.branch, branch]);
  return hit.dir;
}

export function start(cwd, files, opts = {}) {
  const { top, stateDir } = repoInfo(cwd);
  const data = loadWorkers(stateDir);
  const base = opts.base ?? data.base ?? gitOrThrow(top, ['rev-parse', '--abbrev-ref', 'HEAD']);
  data.base = base;
  const out = [];
  for (const file of files) {
    const task = parseTask(file);
    if (data.workers.some((w) => w.name === task.name)) throw new Error(`worker "${task.name}" already exists; run clean first`);
    const agent = pickAgent(task.agent ?? opts.agent);
    const tier = tierOf(task, opts.tier);
    const modelAgent = agent === 'print' ? 'claude' : agent;
    const model = opts.model ?? tierModel(modelAgent, tier, opts.profile);
    const branch = `lean/${task.name}`;
    const promptFile = writePrompt(stateDir, task, path.join(stateDir, task.name, 'status'));
    const logFile = path.join(stateDir, task.name, 'log');
    const worker = { name: task.name, branch, base, agent, tier, model, check: task.check ?? null, dir: null };
    let argv;
    if (agent === 'orca') {
      argv = buildWorkerCommand({ agent, name: task.name, model, promptFile, base });
      const r = spawnSync(argv[0], argv.slice(1), { cwd: top, encoding: 'utf8' });
      fs.writeFileSync(logFile, `${r.stdout ?? ''}${r.stderr ?? ''}`);
      if (r.status !== 0) throw new Error(`orca worktree create failed: ${(r.stderr ?? '').trim()}`);
      worker.dir = adoptOrcaBranch(top, task.name, branch);
    } else {
      worker.dir = path.join(`${top}.lean`, task.name);
      if (agent === 'custom' && !opts.cmd) throw new Error('--agent custom needs --cmd <program>');
      gitOrThrow(top, ['worktree', 'add', '-b', branch, worker.dir, base]);
      data.workers.push(worker);
      saveWorkers(stateDir, data);
      if (agent === 'custom') {
        argv = [opts.cmd, promptFile];
      } else if (agent !== 'print') {
        argv = buildWorkerCommand({ agent, name: task.name, model, promptFile, dir: worker.dir });
      }
      if (agent === 'print' || (agent !== 'custom' && !which(argv[0]))) {
        argv = buildWorkerCommand({ agent: 'claude', name: task.name, model, promptFile, dir: worker.dir });
        worker.agent = 'print';
        worker.command = `cd ${display([worker.dir])} && ${display(argv)}`;
      } else {
        const fd = fs.openSync(logFile, 'a');
        // OpenCode has no --dir flag in 2.1.4, so the worker's working directory is the worktree.
        spawn(argv[0], argv.slice(1), { cwd: worker.dir, detached: true, stdio: ['ignore', fd, fd] }).unref();
      }
    }
    if (!data.workers.includes(worker)) data.workers.push(worker);
    saveWorkers(stateDir, data);
    out.push(worker);
  }
  return out;
}

export function status(cwd) {
  const { stateDir } = repoInfo(cwd);
  return loadWorkers(stateDir).workers.map((w) => ({
    ...w,
    status: statusOf(stateDir, w.name),
    tail: logTail(stateDir, w.name),
  }));
}

// Merges one finished worker, in start order, then rebases the others onto the new base.
export function merge(cwd, name) {
  const { top, stateDir } = repoInfo(cwd);
  const data = loadWorkers(stateDir);
  const w = data.workers.find((x) => x.name === name);
  if (!w) throw new Error(`no worker "${name}"`);
  if (w.merged) throw new Error(`worker "${name}" is already merged`);
  const next = data.workers.find((x) => !x.merged);
  if (next.name !== name) throw new Error(`merge "${next.name}" first (start order)`);
  const st = statusOf(stateDir, name);
  if (st !== 'done') throw new Error(`worker "${name}" is "${st}", not done`);
  if (git(w.dir, ['status', '--porcelain']).out) throw new Error(`worker "${name}" has uncommitted changes in ${w.dir}`);
  if (git(top, ['rev-parse', '--abbrev-ref', 'HEAD']).out !== data.base) throw new Error(`check out ${data.base} in ${top} first`);
  if (git(top, ['status', '--porcelain', '--untracked-files=no']).out) throw new Error(`${top} has uncommitted changes`);
  if (w.check) {
    const [bin, ...args] = w.check.split(/\s+/);
    const r = spawnSync(bin, args, { cwd: w.dir, encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`check "${w.check}" failed:\n${(r.stdout ?? '').slice(-LOG_TAIL_BYTES)}${(r.stderr ?? '').slice(-LOG_TAIL_BYTES)}`);
  }
  const m = git(top, ['merge', '--no-ff', '--no-edit', w.branch]);
  if (!m.ok) { git(top, ['merge', '--abort']); throw new Error(`merge of "${name}" failed: ${m.err || m.out}\nIf it conflicts, rebase it on ${data.base} in ${w.dir} and retry`); }
  w.merged = true;
  saveWorkers(stateDir, data);
  const rebased = [];
  const skipped = [];
  for (const o of data.workers) {
    if (o.merged) continue;
    // A running worker has a dirty tree and would be disturbed; it rebases itself or at its own merge.
    if (statusOf(stateDir, o.name) !== 'done' || git(o.dir, ['status', '--porcelain']).out) { skipped.push(o.name); continue; }
    if (git(o.dir, ['rebase', data.base]).ok) rebased.push(o.name);
    else { git(o.dir, ['rebase', '--abort']); skipped.push(o.name); }
  }
  if (skipped.length) console.error(`not rebased (running, dirty or conflicting): ${skipped.join(', ')}; rebase them in their worktree before their merge`);
  return rebased;
}

// Removes only workers this helper created, only when merged; never --force.
export function clean(cwd) {
  const { top, stateDir } = repoInfo(cwd);
  const data = loadWorkers(stateDir);
  const kept = [];
  const removed = [];
  for (const w of data.workers) {
    if (!w.merged) { kept.push(w); continue; }
    if (fs.existsSync(w.dir)) gitOrThrow(top, ['worktree', 'remove', w.dir]);
    if (git(top, ['rev-parse', '--verify', '-q', w.branch]).ok) gitOrThrow(top, ['branch', '-d', w.branch]);
    fs.rmSync(path.join(stateDir, w.name), { recursive: true, force: true });
    removed.push(w.name);
  }
  if (kept.length) saveWorkers(stateDir, { ...data, workers: kept });
  else fs.rmSync(workersFile(stateDir), { force: true });
  try { fs.rmdirSync(`${top}.lean`); } catch { /* not empty or absent */ }
  return { removed, kept: kept.map((w) => w.name) };
}

// For --doctor: workers left in the repo at `cwd`, if it is one.
export function leftovers(cwd) {
  try { return loadWorkers(repoInfo(cwd).stateDir).workers.map((w) => w.name); } catch { return []; }
}
