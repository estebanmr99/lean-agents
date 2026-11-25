import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';
import { statSync, chmodSync, fchmodSync, openSync, closeSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync, spawn } from 'node:child_process';
import crypto from 'node:crypto';

const proxyDir = path.join(process.cwd(), 'tools/code-mode-proxy');
let skipReason = '';
let tmpDir;
let fakeUpstreamScript;
let configPath;

// Helper to wait for an event or condition
async function waitOn(conditionFn, timeoutMs = 2000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await conditionFn()) return true;
    await new Promise(r => setTimeout(r, 10));
  }
  return false;
}

test.before(async () => {
  const nmDir = path.join(proxyDir, 'node_modules');
  let missing = false;
  try {
    const stats = await fs.stat(nmDir);
    missing = !stats.isDirectory();
  } catch (e) {
    missing = true;
  }
  
  if (missing) {
    const r = spawnSync('npm', ['ci', '--ignore-scripts'], { cwd: proxyDir, stdio: 'ignore' });
    if (r.status !== 0) {
      skipReason = 'Skipping tests: offline or npm ci failed';
    }
  }

  if (skipReason) return;
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'proxy-test-'));
  fakeUpstreamScript = path.join(tmpDir, 'fake-upstream.mjs');
  
  await fs.writeFile(fakeUpstreamScript, `
import readline from 'node:readline';
const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  if (!line.trim()) return;
  let msg;
  try { msg = JSON.parse(line); } catch(e) { return; }
  
  if (msg.method === 'initialize') {
    console.log(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { capabilities: {} } }));
    // Test upstream-initiated request
    console.log(JSON.stringify({ jsonrpc: '2.0', id: 999, method: 'upstream_request' }));
  } else if (msg.method === 'tools/list') {
    console.log(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { tools: [
      { name: 'echo', description: 'echoes', inputSchema: { type: 'object', properties: { p: { type: 'string' }, n: { type: 'number' }, b: { type: 'boolean' } }, required: ['p'] } },
      { name: 'readOnly', annotations: { readOnlyHint: true }, inputSchema: {} },
      { name: 'blocked', inputSchema: {} },
      { name: 'delete_something', inputSchema: {} },
      { name: 'delete_allowed', inputSchema: {} },
      { name: '__proto__', inputSchema: {} },
      { name: 'slow', inputSchema: {} },
      { name: 'env', inputSchema: {} },
      { name: 'large', inputSchema: {} },
      { name: 'never_resolving', inputSchema: {} },
      { name: 'format_disk', inputSchema: {} },
      { name: 'confirm_format', inputSchema: {} },
      { name: 'asset_delete', inputSchema: {} }
    ] } }));
    console.log('not_a_json_object');
    console.log(JSON.stringify(['an', 'array']));
  } else if (msg.method === 'tools/call') {
    if (msg.params.name === 'slow') {
      setTimeout(() => {
        console.log(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: 'late' }] } }));
      }, 5000);
      return;
    }
    if (msg.params.name === 'never_resolving') return;
    if (msg.params.name === 'env') {
      console.log(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { keys: Object.keys(process.env).join(',') } }));
      return;
    }
    if (msg.params.name === 'large') {
      console.log(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { large: "x".repeat(2*1024*1024) } }));
      return;
    }
    console.log(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: msg.params.name }] } }));
  } else if (msg.id !== undefined && !msg.method && msg.error) {
    if (msg.error.code === -32601) {
      console.error('UPSTREAM_GOT_32601_FOR_' + msg.id);
    }
  }
});
  `);
  
  configPath = path.join(tmpDir, 'code-mode-proxy.json');
});

test.after(async () => {
  if (tmpDir) {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
});

let sharedState = {};
test.beforeEach(async () => {
  if (skipReason) return;
  // Make sure we have a clean config per test
  await fs.writeFile(configPath, JSON.stringify({
    "//": "managed by lean-agents",
    allow: ['fake.echo', 'fake.delete_allowed', 'fake.slow', 'fake.env', 'fake.never_resolving', 'fake.large', 'fake.format_disk', 'fake.confirm_format', 'fake.asset_delete'],
    mcpServers: { fake: { command: process.execPath, args: [fakeUpstreamScript], env: { CUSTOM_VAR: 'val123' } } }
  }));
  if (os.platform() !== 'win32') chmodSync(configPath, 0o600);
});

test('Config loader', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const { loadConfig } = await import('../tools/code-mode-proxy/config.mjs');
  
  const cp = path.join(tmpDir, 'cfg1.json');
  await fs.writeFile(cp, 'not valid json');
  await assert.rejects(loadConfig(cp), /not valid JSON/);

  await fs.writeFile(cp, JSON.stringify(['array']));
  await assert.rejects(loadConfig(cp), /must be a JSON object/);

  await fs.writeFile(cp, JSON.stringify({ "allow": [] }));
  await assert.rejects(loadConfig(cp), /managed by lean-agents/);

  if (os.platform() !== 'win32') {
    await fs.writeFile(cp, JSON.stringify({ "//": "managed by lean-agents" }));
    chmodSync(cp, 0o666);
    await assert.rejects(loadConfig(cp), /group- or world-writable/);
    chmodSync(cp, 0o600);
  }

  const badConfigPath = path.join(tmpDir, 'bad-config.json');
  await fs.writeFile(badConfigPath, JSON.stringify({
    "//": "managed by lean-agents",
    mcpServers: { bad: { command: 'not-absolute' } }
  }));
  if (os.platform() !== 'win32') chmodSync(badConfigPath, 0o600);
  await assert.rejects(loadConfig(badConfigPath), /is not an absolute path/);
});

test('Policy evaluation and vetoes', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const { Policy } = await import('../tools/code-mode-proxy/policy.mjs');
  const policy = new Policy({ allow: ['fake.echo', 'fake.delete_allowed', 'fake.format_disk', 'fake.confirm_format', 'fake.asset_delete'] });
  policy.setTools('fake', [
    { name: 'echo' },
    { name: 'readOnly', annotations: { readOnlyHint: true } },
    { name: 'blocked' },
    { name: 'delete_something' },
    { name: 'delete_allowed' },
    { name: 'edit_file' },
    { name: 'format_disk' },
    { name: 'confirm_format' },
    { name: 'asset_delete' }
  ]);
  
  assert.equal(policy.isBlocked('fake', 'echo'), false);
  assert.equal(policy.isBlocked('fake', 'readOnly'), false);
  assert.equal(policy.isBlocked('fake', 'blocked'), true);
  assert.equal(policy.isBlocked('fake', 'delete_something'), true);
  assert.equal(policy.isBlocked('fake', 'delete_allowed'), false); // allowed in config
  
  // word-part veto keeps `format`, `confirm`, `asset` allowed
  assert.equal(policy.isBlocked('fake', 'format_disk'), false);
  assert.equal(policy.isBlocked('fake', 'confirm_format'), false);
  assert.equal(policy.isBlocked('fake', 'asset_delete'), false);
});

async function setupEnv() {
  const { loadConfig } = await import('../tools/code-mode-proxy/config.mjs');
  const { Policy } = await import('../tools/code-mode-proxy/policy.mjs');
  const { UpstreamManager } = await import('../tools/code-mode-proxy/upstream.mjs');
  const { AuditLog } = await import('../tools/code-mode-proxy/audit.mjs');
  const { Sandbox } = await import('../tools/code-mode-proxy/sandbox.mjs');

  const config = await loadConfig(configPath);
  const policy = new Policy(config);
  const upstreamManager = new UpstreamManager(tmpDir);
  const logPath = path.join(tmpDir, 'audit.log');
  const auditLog = new AuditLog(logPath, false);
  await auditLog.init();

  process.env.NODE_OPTIONS = '--max-old-space-size=512';
  process.env.npm_config_foo = 'bar'; // Set env to test stripping
  
  await upstreamManager.startAll(config);
  for (const [name, upstream] of upstreamManager.upstreams.entries()) {
    if (upstream.cp && upstream.cp.stderr) {
      upstream.cp.stderr.setEncoding('utf8');
      upstream.cp.stderr.on('data', (chunk) => {
        const lines = chunk.split('\\n');
        for (const line of lines) {
          if (line.trim()) auditLog.logStderr(name, line);
        }
      });
    }
  }
  
  const listRes = await upstreamManager.request('fake', 'tools/list');
  policy.setTools('fake', listRes.tools);
  
  return { config, policy, upstreamManager, auditLog, listRes, logPath, Sandbox };
}

test('Upstream Request Gets 32601 and Non-Object JSON Does Not Crash', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const env = await setupEnv();
  
  const upstream = env.upstreamManager.upstreams.get('fake');
  let found = false;
  await waitOn(() => {
    return env.auditLog.stderrLines.get('fake') > 0;
  }, 2000);
  
  const content = await fs.readFile(env.logPath, 'utf8');
  assert.match(content, /UPSTREAM_GOT_32601_FOR_999/);
  
  env.upstreamManager.killAll();
  env.auditLog.close();
});

test('Sandbox Probes: exact globals and missing proto', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const env = await setupEnv();
  const sb = new env.Sandbox({ wallTime: 2000, callLimit: 5 });
  
  const keysProbe = await sb.runScript(`Object.getOwnPropertyNames(globalThis).join(',')`, { fake: env.listRes.tools }, env.policy, env.upstreamManager, env.auditLog);
  const actualKeys = new Set(keysProbe.result.split(','));
  const expectedKeys = new Set(["Error","EvalError","RangeError","ReferenceError","SyntaxError","TypeError","URIError","InternalError","AggregateError","Array","Object","Function","Iterator","parseInt","parseFloat","isNaN","isFinite","decodeURI","decodeURIComponent","encodeURI","encodeURIComponent","escape","unescape","Infinity","NaN","undefined","eval","Number","Boolean","String","Math","Reflect","Symbol","globalThis","BigInt","Date","RegExp","JSON","Proxy","Map","Set","WeakMap","WeakSet","ArrayBuffer","SharedArrayBuffer","Uint8ClampedArray","Int8Array","Uint8Array","Int16Array","Uint16Array","Int32Array","Uint32Array","BigInt64Array","BigUint64Array","Float16Array","Float32Array","Float64Array","DataView","Promise","WeakRef","FinalizationRegistry","console","tools"]);
  for (const k of expectedKeys) assert.ok(actualKeys.has(k), `Missing key: ${k}`);
  
  const protoProbe = await sb.runScript(`
    const keys = Object.getOwnPropertyNames(tools.fake).join(',');
    const proto = Object.getPrototypeOf(tools.fake);
    JSON.stringify({ keys, protoIsNull: proto === null });
  `, { fake: env.listRes.tools }, env.policy, env.upstreamManager, env.auditLog);
  
  const res = JSON.parse(protoProbe.result);
  assert.ok(!res.keys.split(',').includes('__proto__'));
  assert.ok(res.protoIsNull);
  
  env.upstreamManager.killAll();
  env.auditLog.close();
});

test('Sandbox Probes: exact error outcomes', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const env = await setupEnv();
  const sb = new env.Sandbox({ wallTime: 1000, callLimit: 5 });
  
  const memStart = Date.now();
  const memProbe = await sb.runScript(`
    let s = "x";
    try { while(true) s += s; } catch(e) { throw e; }
  `, { fake: env.listRes.tools }, env.policy, env.upstreamManager, env.auditLog);
  const memElapse = Date.now() - memStart;
  assert.match(memProbe.error, /out of memory|InternalError|string too long/i);
  
  const loopStart = Date.now();
  const loopProbe = await sb.runScript(`while(true) {}`, { fake: env.listRes.tools }, env.policy, env.upstreamManager, env.auditLog);
  const loopElapse = Date.now() - loopStart;
  assert.match(loopProbe.error, /interrupted/);
  assert.ok(loopElapse < 1000 + 2000, `Took ${loopElapse}ms`);

  const awaitStart = Date.now();
  const awaitProbe = await sb.runScript(`(async function f() { while(true) await null; })()`, { fake: env.listRes.tools }, env.policy, env.upstreamManager, env.auditLog);
  const awaitElapse = Date.now() - awaitStart;
  assert.match(awaitProbe.error, /timed out|interrupted/i);
  assert.ok(awaitElapse < 1000 + 2000, `Took ${awaitElapse}ms`);

  const cleanupStart = Date.now();
  const cleanupProbe = await sb.runScript(`
    try {
      while(true) {}
    } finally {
      while(true) {}
    }
  `, { fake: env.listRes.tools }, env.policy, env.upstreamManager, env.auditLog);
  const cleanupElapse = Date.now() - cleanupStart;
  assert.match(cleanupProbe.error, /interrupted/i);
  assert.ok(cleanupElapse < 1000 + 2000, `Cleanup took ${cleanupElapse}ms`);
  
  env.upstreamManager.killAll();
  env.auditLog.close();
});

test('Schema Type Mismatch and Env Variables', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const env = await setupEnv();
  const sb = new env.Sandbox({ wallTime: 2000, callLimit: 5 });
  
  const mismatch = await sb.runScript(`
    try { tools.fake.echo({ p: 123 }) } catch(e) { e.message; }
  `, { fake: env.listRes.tools }, env.policy, env.upstreamManager, env.auditLog);
  assert.match(mismatch.result || mismatch.error, /must be a string/);

  const envProbe = await sb.runScript(`(async () => await tools.fake.env())()`, { fake: env.listRes.tools }, env.policy, env.upstreamManager, env.auditLog);
  const keys = JSON.parse(envProbe.result).keys.split(',');
  assert.ok(!keys.includes('NODE_OPTIONS'));
  assert.ok(!keys.includes('npm_config_foo'));
  assert.ok(keys.includes('CUSTOM_VAR'));
  
  env.upstreamManager.killAll();
  env.auditLog.close();
});

test('Console Cap and Untrusted Tool Output', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const env = await setupEnv();
  const sb = new env.Sandbox({ wallTime: 2000, callLimit: 5, resultCap: 20 });
  
  const consoleProbe = await sb.runScript(`
    console.log("very long string that exceeds the cap");
    "ok";
  `, { fake: env.listRes.tools }, env.policy, env.upstreamManager, env.auditLog);
  assert.match(consoleProbe.logs, /cut by proxy/);
  
  env.upstreamManager.killAll();
  env.auditLog.close();
});

test('Proxy server.mjs tests', async (t) => {
  if (skipReason) return t.skip(skipReason);
  const stateDir = path.join(tmpDir, '.config', 'lean-agents');
  await fs.mkdir(stateDir, { recursive: true });
  const srvConfig = path.join(stateDir, 'code-mode-proxy.json');
  await fs.writeFile(srvConfig, JSON.stringify({
    "//": "managed by lean-agents",
    allow: ['fake.echo', 'fake.slow'],
    mcpServers: { fake: { command: process.execPath, args: [fakeUpstreamScript] } }
  }));
  const proxyPath = path.join(proxyDir, 'server.mjs');
  
  const cp = spawn(process.execPath, [proxyPath], {
    env: { ...process.env, HOME: tmpDir, LEAN_STATE_DIR: stateDir },
    stdio: ['pipe', 'pipe', 'pipe']
  });

  t.after(() => { cp.kill(); });
  let outputs = [];
  let srvErr = '';
  let stdoutBuf = '';
  cp.stdout.on('data', d => {
    stdoutBuf += d.toString();
    let idx;
    while ((idx = stdoutBuf.indexOf('\n')) >= 0) {
      const line = stdoutBuf.slice(0, idx);
      stdoutBuf = stdoutBuf.slice(idx + 1);
      if (line.trim()) {
        try { outputs.push(JSON.parse(line.trim())); } catch(e) {}
      }
    }
  });
  cp.stderr.on('data', d => { srvErr += d.toString(); });

  let idCounter = 1;
  const send = (msg) => {
    msg.jsonrpc = '2.0';
    if (msg.id === undefined) msg.id = idCounter++;
    cp.stdin.write(JSON.stringify(msg) + '\n');
    return msg.id;
  };

  const waitForId = async (id, timeout = 2000) => {
    let res;
    await waitOn(() => {
      res = outputs.find(o => o.id === id);
      return !!res;
    }, timeout);
    return res;
  };

  send({ method: 'initialize', params: {} });
  await waitForId(1);
  
  cp.stdin.write('invalid\n');
  let errRes;
  await waitOn(() => {
    errRes = outputs.find(o => o.error && o.error.code === -32700);
    return !!errRes;
  });
  assert.ok(errRes, 'Missing -32700 for malformed json. Outputs: ' + JSON.stringify(outputs) + ' Stderr: ' + srvErr);
  
  const pingId = send({ method: 'ping' });
  const pingRes = await waitForId(pingId);
  assert.ok(pingRes.result);

  const searchId = send({ method: 'tools/call', params: { name: 'search_tools', arguments: { query: 'echo' } } });
  const searchRes = await waitForId(searchId);
  assert.ok(searchRes, 'searchRes is missing! Outputs: ' + JSON.stringify(outputs) + ' Stderr: ' + srvErr);
  assert.match(searchRes.result.content[0].text, /Untrusted tool output follows/, 'search_tools missing header. Stderr: ' + srvErr);

  const capId = send({ method: 'tools/call', params: { name: 'run_script', arguments: { code: `
    (async () => {
      const p = [];
      for (let i=0; i<5; i++) p.push(tools.fake.slow().catch(e => e.message));
      return await Promise.all(p);
    })()
  ` } } });
  
  const capRes = await waitForId(capId, 8000);
  assert.ok(capRes, 'capRes is missing! Stderr: ' + srvErr);
  assert.match(capRes.result.content[0].text, /cap is 4/);

  const toolCallId = send({ method: 'tools/call', params: { name: 'run_script', arguments: { code: `tools.fake.echo({p:"a"})` } } });
  const toolCallRes = await waitForId(toolCallId);
  assert.ok(toolCallRes, 'toolCallRes is missing! Stderr: ' + srvErr);
  assert.match(toolCallRes.result.content[0].text, /Tools called:/);
  assert.match(toolCallRes.result.content[0].text, /- fake\.echo: 1/);
  assert.match(toolCallRes.result.content[0].text, /Untrusted tool output follows/);

  cp.stdin.end();
  await new Promise(r => cp.on('exit', r));
});

test('remove.mjs `<root>-evil` prefix refused', async (t) => {
  if (skipReason) return t.skip(skipReason);
  
  const fakeRoot = path.join(tmpDir, 'state');
  await fs.mkdir(fakeRoot);
  
  const runRemove = (dir) => {
    return spawnSync(process.execPath, [path.join(proxyDir, 'remove.mjs'), dir], { env: { LEAN_STATE_DIR: fakeRoot } });
  };

  const evilDir = fakeRoot + '-evil';
  await fs.mkdir(evilDir, { recursive: true });
  
  const rm = runRemove(evilDir);
  assert.equal(rm.status, 1);
  assert.match(rm.stderr.toString(), /outside lean data dir/);
});

test('Audit chmod on pre-existing 0644 file -> 0600', async (t) => {
  if (skipReason) return t.skip(skipReason);
  if (os.platform() === 'win32') return t.skip('Windows');
  
  const logPath = path.join(tmpDir, 'audit_chmod.log');
  await fs.writeFile(logPath, 'test');
  chmodSync(logPath, 0o644);
  
  const { AuditLog } = await import('../tools/code-mode-proxy/audit.mjs');
  const auditLog = new AuditLog(logPath, false);
  await auditLog.init();
  
  const stats = statSync(logPath);
  assert.equal(stats.mode & 0o777, 0o600);
  
  auditLog.close();
});
