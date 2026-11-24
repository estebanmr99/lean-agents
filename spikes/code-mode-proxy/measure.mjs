// Spike (#304): fake MCP server direct vs through @utcp/code-mode-mcp. Plain JSON-RPC over stdio, no SDK.
// Proxy config per the package README (UTCP_CONFIG_FILE, manual_call_templates); the `mcp` template shape is VERIFY.
import { spawn, execSync } from 'node:child_process';
import { writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FAKE = path.join(HERE, 'fake-mcp.mjs');
const PROXY = path.join(HERE, 'node_modules', '@utcp', 'code-mode-mcp', 'dist', 'index.js');
const TIMEOUT = 30000;

function connect(args, env) {
  const child = spawn(process.execPath, args, { env, stdio: ['pipe', 'pipe', 'pipe'] });
  let buf = ''; let next = 1; const waiting = new Map(); let stderr = '';
  child.stderr.on('data', (d) => { stderr += d; });
  child.stdout.on('data', (d) => {
    buf += d; const lines = buf.split('\n'); buf = lines.pop();
    for (const line of lines) {
      let msg; try { msg = JSON.parse(line); } catch { continue; } // the proxy may log to stdout
      const w = waiting.get(msg.id); if (w) { waiting.delete(msg.id); w(msg); }
    }
  });
  const request = (method, params = {}) => new Promise((resolve, reject) => {
    const id = next++;
    const t = setTimeout(() => { waiting.delete(id); reject(new Error(`${method} timed out; stderr: ${stderr.slice(-400)}`)); }, TIMEOUT);
    waiting.set(id, (m) => { clearTimeout(t); m.error ? reject(new Error(`${method}: ${JSON.stringify(m.error)}`)) : resolve(m.result); });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
  const notify = (method) => child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method }) + '\n');
  return { child, request, notify, stderr: () => stderr };
}

async function start(args, env) {
  const t0 = performance.now();
  const c = connect(args, env);
  await c.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'spike-measure', version: '0.1.0' } });
  c.notify('notifications/initialized');
  const coldStart = performance.now() - t0;
  const list = await c.request('tools/list');
  return { ...c, coldStart, list, listBytes: JSON.stringify(list).length };
}

function rssMb(pid) {
  try {
    if (process.platform === 'win32') {
      const cols = execSync(`tasklist /FI "PID eq ${pid}" /FO CSV /NH`).toString().split('","');
      return parseInt(cols[4].replace(/[^0-9]/g, ''), 10) / 1024;
    }
    return parseInt(execSync(`ps -o rss= -p ${pid}`).toString().trim(), 10) / 1024;
  } catch { return null; }
}

const text = (r) => (r?.content || []).map((c) => c.text || '').join('\n');
const out = { platform: process.platform, node: process.version, errors: [] };

const direct = await start([FAKE], { PATH: process.env.PATH });
let t = performance.now();
for (const i of [0, 1, 2]) await direct.request('tools/call', { name: `fake_read_${i}`, arguments: { path: 'x' } });
out.direct = { coldStartMs: direct.coldStart, listBytes: direct.listBytes, listTokens: Math.ceil(direct.listBytes / 4), threeCallsMs: performance.now() - t };
direct.child.kill();

const cfgPath = path.join(HERE, 'utcp-config.json');
writeFileSync(cfgPath, JSON.stringify({
  manual_call_templates: [{ name: 'fake', call_template_type: 'mcp', config: { mcpServers: { fake: { transport: 'stdio', command: process.execPath, args: [FAKE] } } } }],
  tool_repository: { tool_repository_type: 'in_memory' },
  tool_search_strategy: { tool_search_strategy_type: 'tag_and_description_word_match' },
}, null, 2));

try {
  if (!existsSync(PROXY)) throw new Error(`proxy entry not found at ${PROXY}`);
  // Scrubbed env: PATH, HOME and the config path only (security verdict on #304).
  const proxy = await start([PROXY], { PATH: process.env.PATH, HOME: process.env.HOME, UTCP_CONFIG_FILE: cfgPath });
  const names = proxy.list.tools.map((x) => x.name);
  out.proxy = { coldStartMs: proxy.coldStart, listBytes: proxy.listBytes, listTokens: Math.ceil(proxy.listBytes / 4), tools: names, rssMb: rssMb(proxy.child.pid) };
  // Management tools that let the model add new tool sources (e.g. a `cli` manual that runs commands) at run time.
  out.proxy.runtimeRegistration = names.filter((n) => /register_manual/.test(n));
  const listed = text(await proxy.request('tools/call', { name: 'list_tools', arguments: {} }));
  out.proxy.registeredTools = listed.slice(0, 600);
  const chain = 'call_tool_chain';
  // Names as the proxy reports them, e.g. fake.fake_read_0; hierarchical access per the README.
  const tn = (i) => (listed.match(new RegExp(`[\\w.]*fake_read_${i}\\b`)) || [`fake.fake_read_${i}`])[0];
  const code = `const a = await ${tn(0)}({ path: "a" }); const b = await ${tn(1)}({ path: "b" }); const c = await ${tn(2)}({ path: "c" }); return [a, b, c];`;
  t = performance.now();
  out.proxy.chainResult = text(await proxy.request('tools/call', { name: chain, arguments: { code } })).slice(0, 600);
  out.proxy.chainMs = performance.now() - t;
  const probe = `const r = {}; try { r.env = typeof process !== "undefined" && !!process.env; } catch (e) { r.env = false; } try { r.require = typeof require === "function"; } catch (e) { r.require = false; } r.fetch = typeof fetch === "function"; return r;`;
  out.proxy.sandboxProbe = text(await proxy.request('tools/call', { name: chain, arguments: { code: probe } })).slice(0, 400);
  proxy.child.kill();
} catch (e) { out.errors.push(String(e.message || e)); }

const p = out.proxy || {};
const gain = p.listTokens ? (1 - p.listTokens / out.direct.listTokens) * 100 : null;
const sandboxOk = p.sandboxProbe ? !/"(env|require|fetch)"\s*:\s*true/.test(p.sandboxProbe) : null;
const v = (ok) => (ok === null || ok === undefined ? 'UNKNOWN' : ok ? 'OK' : 'FAIL');
out.verdict = {
  gain: gain === null ? 'UNKNOWN' : gain >= 50 ? `GAIN (${gain.toFixed(0)}% smaller tools/list)` : `NO GAIN (${gain.toFixed(0)}%)`,
  coldStart: v(p.coldStartMs !== undefined ? p.coldStartMs < 2000 : null),
  rss: v(p.rssMb != null ? p.rssMb < 150 : null),
  callOverhead: v(p.chainMs !== undefined ? p.chainMs - out.direct.threeCallsMs < 300 : null),
  sandbox: v(sandboxOk),
  runtimeRegistration: p.tools ? (p.runtimeRegistration.length ? `PRESENT (${p.runtimeRegistration.join(', ')}): model can add tool sources at run time` : 'absent') : 'UNKNOWN',
};
writeFileSync(path.join(HERE, 'result.json'), JSON.stringify(out, null, 2));
const row = (k, a, b, c) => `| ${k} | ${a} | ${b} | ${c} |`;
const f = (n) => (typeof n === 'number' ? n.toFixed(0) : 'n/a');
writeFileSync(path.join(HERE, 'SUMMARY.md'), [
  `## ${out.platform} (Node ${out.node})`, '', '| Metric | Direct | Proxy | Verdict |', '| --- | --- | --- | --- |',
  row('tools/list tokens', out.direct.listTokens, p.listTokens ?? 'n/a', out.verdict.gain),
  row('cold start ms', f(out.direct.coldStartMs), f(p.coldStartMs), out.verdict.coldStart),
  row('RSS MB', 'n/a', f(p.rssMb), out.verdict.rss),
  row('3 calls ms', f(out.direct.threeCallsMs), f(p.chainMs), out.verdict.callOverhead),
  row('sandbox (env/require/fetch)', 'n/a', p.sandboxProbe ? 'probed' : 'n/a', out.verdict.sandbox),
  row('runtime tool registration', 'n/a', '', out.verdict.runtimeRegistration),
  '', out.errors.length ? `Errors: ${out.errors.join(' ; ')}` : 'Errors: none', '',
].join('\n'));
console.log(JSON.stringify(out.verdict, null, 2));
if (out.errors.length) { console.error(out.errors.join('\n')); process.exitCode = 1; }
