#!/usr/bin/env node
// Times Context Mode's ctx_execute on the fixed workloads in tests/fixtures/bench/ over MCP stdio.
// Usage: node tests/bench-context-mode.mjs <label> <out.json> [node.json to compare with]. Used by CI only.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const [label, out, baseline] = process.argv.slice(2);
const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'bench');
const WARMUP = 2;
const RUNS = 10;

// Minimal MCP client: newline-delimited JSON-RPC 2.0 over the server's stdin and stdout.
const server = spawn('context-mode', [], { stdio: ['pipe', 'pipe', 'pipe'], shell: process.platform === 'win32' });
let stderr = '';
server.stderr.on('data', (d) => { stderr += d; });
const pending = new Map();
let buf = '';
server.stdout.on('data', (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    pending.get(msg.id)?.(msg);
    pending.delete(msg.id);
  }
});
// A missing or crashed server fails every pending request at once instead of after the timeout.
const failAll = (why) => { for (const done of pending.values()) done({ error: `${why}\n${stderr}` }); pending.clear(); };
server.on('error', (e) => failAll(e.message));
server.on('exit', (code) => failAll(`context-mode exited with ${code}`));
let nextId = 1;
function rpc(method, params, timeout = 120000) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${method} timed out\n${stderr}`)), timeout);
    pending.set(id, (msg) => { clearTimeout(timer); msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result); });
    server.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
}
const text = (result) => (result?.content ?? []).map((c) => c.text ?? '').join('\n');

await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'lean-agents-bench', version: '0' } });
server.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
const tools = (await rpc('tools/list', {})).tools.map((t) => t.name);

const stats = (ms) => {
  const s = [...ms].sort((a, b) => a - b);
  const mid = (s.length - 1) / 2;
  return { median: Math.round((s[Math.floor(mid)] + s[Math.ceil(mid)]) / 2), min: Math.round(s[0]), max: Math.round(s[s.length - 1]) };
};
const results = {};
for (const [language, file] of [['javascript', 'workload.js'], ['typescript', 'workload.ts']]) {
  const code = fs.readFileSync(path.join(FIX, file), 'utf8');
  const ms = [];
  try {
    for (let n = 0; n < WARMUP + RUNS; n++) {
      const t0 = performance.now();
      const r = await rpc('tools/call', { name: 'ctx_execute', arguments: { language, code } });
      const took = performance.now() - t0;
      if (r.isError || !text(r).includes('20000 224737')) throw new Error(`unexpected result: ${text(r).slice(0, 300)}`);
      if (n >= WARMUP) ms.push(took);
    }
    results[language] = stats(ms);
  } catch (e) {
    // TypeScript may need a runtime Node lacks; record it instead of failing the whole run.
    if (language === 'javascript') throw e;
    results[language] = { error: e.message.split('\n')[0].slice(0, 200) };
  }
}

// The SQLite backend is not in the protocol; keep the doctor lines that name it.
let backend = [];
if (tools.includes('ctx_doctor')) {
  const doc = text(await rpc('tools/call', { name: 'ctx_doctor', arguments: {} }));
  backend = doc.split('\n').filter((l) => /sqlite|bun|runtime|node/i.test(l)).slice(0, 12).map((l) => l.trim());
} else {
  backend = [`ctx_doctor not offered; tools: ${tools.join(', ')}`];
}
server.kill();

const report = { label, os: process.platform, results, backend };
fs.writeFileSync(out, JSON.stringify(report, null, 2));
const cell = (r) => (r.error ? `error: ${r.error}` : `${r.median} ms (${r.min}–${r.max})`);
const lines = [`### Context Mode ctx_execute, ${label}, ${process.platform}`, '', '| Language | Median (min–max), 10 runs |', '| --- | --- |'];
for (const [lang, r] of Object.entries(results)) lines.push(`| ${lang} | ${cell(r)} |`);
if (baseline) {
  const base = JSON.parse(fs.readFileSync(baseline, 'utf8')).results;
  for (const lang of Object.keys(results)) {
    if (base[lang]?.median && results[lang].median) lines.push('', `${lang}: Node / ${label} = ${(base[lang].median / results[lang].median).toFixed(2)}x`);
  }
}
lines.push('', 'Backend lines from ctx_doctor:', '', ...backend.map((l) => `- ${l}`), '');
console.log(lines.join('\n'));
if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join('\n') + '\n');
// On Windows kill() stops only the cmd.exe shell; the server would keep the pipes and the script open.
process.exit(0);
