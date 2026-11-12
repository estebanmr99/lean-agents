#!/usr/bin/env node
// Session 130: compares codebase-memory-mcp (cbm) with Serena over MCP stdio, no model involved.
// Tokens are a proxy: bytes of each tool result / 4. Quality = the known right answer appears in the result.
// Usage: node tests/bench-code-nav.mjs --home <throwaway dir> [--repo medium|large|all] [--server cbm|serena|all] [--out <dir>]
//   CBM_BIN=<path to codebase-memory-mcp> (default: `codebase-memory-mcp` on PATH)
// Never touches the real HOME: --home is required and is what every child process sees as HOME / USERPROFILE.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { gitSpec } from '../scripts/lib/pins.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name, dflt) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : dflt; };
const HOME = arg('home');
if (!HOME || path.resolve(HOME) === path.resolve(os.homedir())) { console.error('--home <throwaway dir> is required and must not be the real HOME'); process.exit(2); }
fs.mkdirSync(HOME, { recursive: true });
const OUT = arg('out', path.join(HOME, 'bench-out'));
fs.mkdirSync(OUT, { recursive: true });
const CALL_TIMEOUT = 600000;
const env = { ...process.env, HOME, USERPROFILE: HOME, UV_CACHE_DIR: path.join(HOME, 'uvcache'), CBM_CACHE_DIR: path.join(HOME, 'cbm-cache') };

// Fixed targets. Expected strings are file stems or symbol names; each must appear in the tool result.
const REPOS = {
  medium: { // this repository at a fixed commit
    sha: 'e96c67b74c17df47a77aeb62d72ef0d656a9025b', glob: ['*.mjs'], grepRoots: ['scripts', 'tests', 'core'],
    find: { symbol: 'applyJsonEdits', expect: ['fsops'] },
    callers: { symbol: 'applyJsonEdits', file: 'scripts/lib/fsops.mjs', expect: ['plan', 'engine.test'] },
    rename: { symbol: 'OWNED_MARK', file: 'scripts/lib/fsops.mjs' },
    module: { file: 'scripts/lib/fsops.mjs', expect: ['applyJsonEdits', 'setBlock', 'removeBlock', 'revertJsonEdits', 'undo'] },
    config: { pattern: 'start-mcp-server', expect: ['mcp.json'] },
  },
  large: { // Django, shallow clone of an annotated tag
    url: 'https://github.com/django/django', tag: '5.2.9', sha: 'c14b756185c88f7f2eb745ff061f3c221fea9de7', glob: ['*.py'], grepRoots: ['django'],
    find: { symbol: 'resolve_url', expect: ['shortcuts'] },
    callers: { symbol: 'resolve_url', file: 'django/shortcuts.py', expect: ['redirect', 'mixins', 'middleware', 'views'] },
    rename: { symbol: 'FieldDoesNotExist', file: 'django/core/exceptions.py' },
    module: { file: 'django/shortcuts.py', expect: ['render', 'redirect', 'get_object_or_404', 'get_list_or_404', 'resolve_url'] },
    config: { pattern: 'DEFAULT_AUTO_FIELD = ', expect: ['global_settings'] },
  },
};

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', env, maxBuffer: 64 << 20, ...opts });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed: ${r.stderr || r.error}`);
  return r.stdout;
}

function prepare(name) {
  const spec = REPOS[name];
  const dir = path.join(HOME, 'bench-src', name);
  if (fs.existsSync(dir)) return dir;
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  if (spec.url) {
    run('git', ['clone', '-q', '--depth', '1', '--branch', spec.tag, spec.url, dir]);
  } else {
    run('git', ['clone', '-q', '--no-hardlinks', ROOT, dir]); // needs the pinned commit in local history (CI: fetch-depth 0)
    run('git', ['-C', dir, 'checkout', '-q', spec.sha]);
  }
  const head = run('git', ['-C', dir, 'rev-parse', 'HEAD']).trim();
  if (head !== spec.sha) throw new Error(`${name}: expected ${spec.sha}, got ${head}`);
  return dir;
}

// Files that really mention the symbol (word match): ground truth for rename impact.
const groundTruth = (dir, spec, symbol) =>
  run('git', ['-C', dir, 'grep', '-lw', symbol, '--', ...spec.grepRoots.flatMap((r) => spec.glob.map((g) => `${r}/**/${g}`))]).split('\n').filter(Boolean)
    .map((f) => path.basename(f).replace(/\.(mjs|py)$/, ''));

class Mcp {
  constructor(cmd, args, opts) {
    this.stderr = '';
    this.pending = new Map();
    this.buf = '';
    this.id = 0;
    // Own process group on POSIX so close() can take down every helper the server starts (Serena's dashboard tray, language servers).
    this.child = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'], env, detached: process.platform !== 'win32', ...opts });
    live.add(this);
    this.child.stderr.on('data', (d) => { this.stderr = (this.stderr + d).slice(-4000); });
    this.child.stdout.on('data', (d) => {
      this.buf += d;
      let i;
      while ((i = this.buf.indexOf('\n')) >= 0) {
        const line = this.buf.slice(0, i).trim();
        this.buf = this.buf.slice(i + 1);
        try { const m = JSON.parse(line); this.pending.get(m.id)?.(m); this.pending.delete(m.id); } catch { /* not JSON-RPC */ }
      }
    });
    const fail = (why) => { for (const done of this.pending.values()) done({ error: { message: `${why}\n${this.stderr}` } }); this.pending.clear(); };
    this.child.on('error', (e) => fail(e.message));
    this.child.on('exit', (c) => fail(`server exited with ${c}`));
  }
  request(method, params) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${method} timed out\n${this.stderr}`)), CALL_TIMEOUT);
      this.pending.set(id, (m) => { clearTimeout(timer); m.error ? reject(new Error(m.error.message ?? JSON.stringify(m.error))) : resolve(m.result); });
      this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  }
  async init() {
    const init = await this.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'lean-agents-bench', version: '0' } });
    this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
    const tools = (await this.request('tools/list', {})).tools;
    return { instructionsBytes: Buffer.byteLength(init.instructions ?? ''), toolCount: tools.length, schemaBytes: Buffer.byteLength(JSON.stringify(tools)) };
  }
  async call(name, args) {
    const t0 = performance.now();
    const r = await this.request('tools/call', { name, arguments: args });
    const text = (r.content ?? []).map((c) => c.text ?? '').join('\n');
    if (r.isError) throw new Error(`${name} returned an error: ${text.slice(0, 300)}`);
    return { text, ms: performance.now() - t0 };
  }
  // kill() stops only the launcher (uvx); take the whole tree down.
  close() {
    live.delete(this);
    if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(this.child.pid), '/T', '/F']);
    else { try { process.kill(-this.child.pid, 'SIGKILL'); } catch { /* already gone */ } }
  }
}
const live = new Set();
process.on('exit', () => { for (const m of [...live]) m.close(); });
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => process.exit(130));

const dirSize = (dir) => {
  if (!fs.existsSync(dir)) return 0;
  let n = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true, recursive: true })) if (e.isFile()) { try { n += fs.statSync(path.join(e.parentPath, e.name)).size; } catch { /* vanished */ } }
  return n;
};

// Each server adapter: start(dir) -> { overhead, indexMs, diskBytes, ask(kind, spec) -> text, stop() }.
const servers = {
  cbm: {
    label: 'codebase-memory-mcp 0.12.1',
    async start(dir) {
      fs.rmSync(env.CBM_CACHE_DIR, { recursive: true, force: true });
      const mcp = new Mcp(process.env.CBM_BIN ?? 'codebase-memory-mcp', []);
      const overhead = await mcp.init();
      const idx = await mcp.call('index_repository', { repo_path: dir });
      const project = JSON.parse(idx.text).project;
      return {
        overhead, indexMs: idx.ms, project,
        diskBytes: () => dirSize(env.CBM_CACHE_DIR),
        stop: () => mcp.close(),
        ask: async (kind, s) => (await mcp.call(...{
          find: ['search_graph', { project, name_pattern: s.symbol }],
          callers: ['trace_path', { project, function_name: s.symbol, direction: 'inbound', include_tests: true }],
          rename: ['search_code', { project, pattern: s.symbol, limit: 500, result_limit: 500 }],
          module: ['get_file_outline', { project, file_path: s.file }],
          config: ['search_code', { project, pattern: s.pattern, limit: 500, result_limit: 500 }],
        }[kind])).text,
      };
    },
  },
};
// Serena as lean-agents launches it (core/mcp.json), in its two agent interfaces: `repl` is the v2 default, `tools` the classic one.
for (const mode of ['repl', 'tools']) {
  servers[`serena-${mode}`] = {
    label: `Serena 2.1.0 (${mode})`,
    async start(dir, spec) {
      const cfgDir = path.join(HOME, '.serena');
      fs.rmSync(path.join(dir, '.serena'), { recursive: true, force: true });
      const t0 = performance.now();
      const mcp = new Mcp('uvx', ['-p', '3.13', '--from', gitSpec('serena'), 'serena', 'start-mcp-server', '--project-from-cwd', '--agent-interface', mode,
        // No dashboard, no browser tab, no GUI log window: the bench must never open anything on a desktop.
        '--enable-web-dashboard', 'false', '--open-web-dashboard', 'false', '--enable-gui-log-window', 'false'], { cwd: dir });
      const overhead = await mcp.init();
      const instr = await mcp.call('initial_instructions', {});
      overhead.instructionsBytes += Buffer.byteLength(instr.text);
      const session = /session id is `([0-9a-f]+)`/.exec(instr.text)?.[1];
      const py = (code) => ['serena_repl', { session, code }];
      const q = (s) => JSON.stringify(s);
      const calls = {
        find: (s) => (mode === 'repl' ? py(`s.lsp.find_symbol(${q(s.symbol)})`) : ['find_symbol', { name_path_pattern: s.symbol }]),
        callers: (s) => (mode === 'repl' ? py(`s.lsp.find_referencing_symbols(${q(s.symbol)}, ${q(s.file)})`) : ['find_referencing_symbols', { name_path: s.symbol, relative_path: s.file }]),
        rename: (s) => (mode === 'repl' ? py(`s.lsp.find_referencing_symbols(${q(s.symbol)}, ${q(s.file)})`) : ['find_referencing_symbols', { name_path: s.symbol, relative_path: s.file }]),
        module: (s) => (mode === 'repl' ? py(`s.lsp.get_symbols_overview(${q(s.file)})`) : ['get_symbols_overview', { relative_path: s.file }]),
        config: (s) => (mode === 'repl' ? py(`s.fs.search_for_pattern(${q(s.pattern)})`) : ['search_for_pattern', { substring_pattern: s.pattern }]),
      };
      // Serena has no index step: the language server starts on the first symbol query. That is its "index time".
      await mcp.call(...calls.module(spec.module));
      const indexMs = performance.now() - t0;
      return {
        overhead, indexMs,
        diskBytes: () => dirSize(path.join(dir, '.serena')),
        extraBytes: () => dirSize(cfgDir),
        stop: () => mcp.close(),
        ask: async (kind, s) => (await mcp.call(...calls[kind](s))).text,
      };
    },
  };
}

const tokens = (b) => Math.ceil(b / 4);
const has = (text, needle) => text.includes(needle);

async function benchOne(serverName, repoName, dir) {
  const spec = REPOS[repoName];
  const expectRename = groundTruth(dir, spec, spec.rename.symbol);
  const tasks = [
    ['find symbol', 'find', spec.find, spec.find.expect],
    ['find callers', 'callers', spec.callers, spec.callers.expect],
    ['rename impact', 'rename', spec.rename, expectRename],
    ['explain module', 'module', spec.module, spec.module.expect],
    ['locate config', 'config', spec.config, spec.config.expect],
  ];
  const result = { server: serverName, label: servers[serverName].label, repo: repoName, sha: spec.sha };
  const s = await servers[serverName].start(dir, spec);
  try {
    result.overhead = { ...s.overhead, overheadTokens: tokens(s.overhead.schemaBytes + s.overhead.instructionsBytes) };
    result.indexMs = Math.round(s.indexMs);
    result.tasks = [];
    for (const [title, kind, tspec, expect] of tasks) {
      let r;
      try {
        const t0 = performance.now();
        const text = await s.ask(kind, tspec);
        const hits = expect.filter((e) => has(text, e));
        r = { task: title, bytes: Buffer.byteLength(text), tokens: tokens(Buffer.byteLength(text)), ms: Math.round(performance.now() - t0), hits: hits.length, total: expect.length, missing: expect.filter((e) => !hits.includes(e)), pass: hits.length === expect.length };
      } catch (e) {
        r = { task: title, error: e.message.split('\n')[0].slice(0, 200), pass: false, hits: 0, total: expect.length, bytes: 0, tokens: 0, ms: 0 };
      }
      result.tasks.push(r);
      console.log(`${serverName} ${repoName} ${title}: ${r.error ?? `${r.tokens} tok, ${r.ms} ms, ${r.hits}/${r.total}`}`);
    }
    result.diskBytes = s.diskBytes();
    result.homeStateBytes = s.extraBytes?.() ?? 0;
  } finally {
    s.stop();
  }
  return result;
}

function markdown(results) {
  const lines = [`### Code navigation bench, ${process.platform} (tokens = bytes/4; hits = expected answers found / expected)`, ''];
  for (const repo of [...new Set(results.map((r) => r.repo))]) {
    lines.push(`**${repo}** (${REPOS[repo].url ?? 'this repo'} @ ${REPOS[repo].sha.slice(0, 8)})`, '', '| Server | Fixed tokens (schemas + instructions) | Index/start ms | On-disk | find symbol | find callers | rename impact | explain module | locate config | Task tokens | Answers found |', '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
    for (const r of results.filter((x) => x.repo === repo)) {
      const cell = (t) => (t.error ? `error` : `${t.tokens} tok, ${t.ms} ms, ${t.hits}/${t.total}`);
      const sum = r.tasks.reduce((a, t) => a + t.tokens, 0);
      const found = r.tasks.reduce((a, t) => a + t.hits, 0);
      const total = r.tasks.reduce((a, t) => a + t.total, 0);
      lines.push(`| ${r.label} | ${r.overhead.overheadTokens} | ${r.indexMs} | ${(r.diskBytes / 1048576).toFixed(1)} MB | ${r.tasks.map(cell).join(' | ')} | ${sum} | ${found}/${total} |`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

// Gate "clean undo": what is left in a throwaway HOME after cbm's own `uninstall -y --delete-indexes`.
// binary-only = how lean-agents would use it (binary + MCP entry); upstream-install = after its default `install -y`, which also writes hooks.
async function uninstallCheck(dir) {
  const bin = process.env.CBM_BIN ?? 'codebase-memory-mcp';
  const out = [];
  for (const scenario of ['binary-only', 'upstream-install']) {
    const home = path.join(HOME, 'uninstall-check', scenario);
    fs.rmSync(home, { recursive: true, force: true });
    for (const d of ['.local/bin', '.claude', '.config/opencode']) fs.mkdirSync(path.join(home, d), { recursive: true });
    const exe = path.join(home, '.local', 'bin', path.basename(bin));
    fs.copyFileSync(bin, exe);
    fs.chmodSync(exe, 0o755);
    const e = { ...env, HOME: home, USERPROFILE: home, CBM_CACHE_DIR: path.join(home, 'cbm-cache') };
    if (scenario === 'upstream-install') run(exe, ['install', '-y'], { env: e });
    const mcp = new Mcp(exe, [], { env: e });
    await mcp.init();
    await mcp.call('index_repository', { repo_path: dir });
    mcp.close();
    await new Promise((r) => setTimeout(r, 1000)); // let the server release its files (Windows)
    const written = fs.readdirSync(home, { recursive: true }).length;
    const log = run(exe, ['uninstall', '-y', '--delete-indexes'], { env: e });
    const left = fs.readdirSync(home, { withFileTypes: true, recursive: true }).filter((x) => x.isFile()).map((x) => path.relative(home, path.join(x.parentPath, x.name)).split(path.sep).join('/'));
    out.push({ scenario, entriesBeforeUninstall: written, leftoverFiles: left, uninstallLog: log.split('\n').length });
    console.log(`uninstall check ${scenario}: ${left.length} file(s) left: ${left.join(', ') || 'none'}`);
  }
  return out;
}

const repoNames = arg('repo', 'all') === 'all' ? Object.keys(REPOS) : [arg('repo')];
const serverNames = arg('server', 'all') === 'all' ? Object.keys(servers) : arg('server').split(',').filter((s) => s !== 'none');
const results = [];
for (const repo of repoNames) {
  const dir = prepare(repo);
  for (const name of serverNames) {
    try { results.push(await benchOne(name, repo, dir)); } catch (e) { console.error(`${name} ${repo} failed: ${e.message}`); process.exitCode = 1; }
  }
}
const uninstall = process.argv.includes('--check-uninstall') ? await uninstallCheck(prepare('medium')) : null;
const md = markdown(results) + (uninstall ? `\n### codebase-memory-mcp undo, ${process.platform}\n\n${uninstall.map((u) => `- ${u.scenario}: ${u.leftoverFiles.length} file(s) left after \`uninstall -y --delete-indexes\`${u.leftoverFiles.length ? `: ${u.leftoverFiles.join(', ')}` : ''}`).join('\n')}\n` : '');
fs.writeFileSync(path.join(OUT, `bench-${process.platform}.json`), JSON.stringify({ os: process.platform, results, uninstall }, null, 2));
fs.writeFileSync(path.join(OUT, `bench-${process.platform}.md`), md);
console.log(md);
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + '\n');
process.exit(process.exitCode ?? 0); // Serena helpers may keep the pipes open
