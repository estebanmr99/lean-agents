import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';
import { statSync, chmodSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync, spawn } from 'node:child_process';
import crypto from 'node:crypto';

const proxyDir = path.join(process.cwd(), 'tools/code-mode-proxy');
let skipReason = '';

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
});

test('code-mode-proxy tests', async (t) => {
  if (skipReason) return t.skip(skipReason);

  const { loadConfig } = await import('../tools/code-mode-proxy/config.mjs');
  const { Policy } = await import('../tools/code-mode-proxy/policy.mjs');
  const { UpstreamManager } = await import('../tools/code-mode-proxy/upstream.mjs');
  const { AuditLog } = await import('../tools/code-mode-proxy/audit.mjs');
  const { Sandbox } = await import('../tools/code-mode-proxy/sandbox.mjs');

  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'proxy-test-'));
  t.after(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  });

  const fakeUpstreamScript = path.join(tmpDir, 'fake-upstream.mjs');
  await fs.writeFile(fakeUpstreamScript, `
import readline from 'node:readline';
const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  if (!line.trim()) return;
  const msg = JSON.parse(line);
  if (msg.method === 'initialize') {
    console.log(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { capabilities: {} } }));
  } else if (msg.method === 'tools/list') {
    console.log(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { tools: [
      { name: 'echo', description: 'echoes', inputSchema: { type: 'object', properties: { p: { type: 'string' } }, required: ['p'] } },
      { name: 'readOnly', annotations: { readOnlyHint: true }, inputSchema: {} },
      { name: 'blocked', inputSchema: {} },
      { name: 'delete_something', inputSchema: {} },
      { name: 'delete_allowed', inputSchema: {} },
      { name: '__proto__', inputSchema: {} },
      { name: 'slow', inputSchema: {} },
      { name: 'env', inputSchema: {} },
      { name: 'large', inputSchema: {} },
      { name: 'never_resolving', inputSchema: {} }
    ] } }));
    console.log(JSON.stringify({ jsonrpc: '2.0', id: 999, method: 'roots/list' }));
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
  } else if (msg.id !== undefined && !msg.method) {
    if (msg.error && msg.error.code === -32601) {
      console.error('FAKE_ASSERT_32601');
    }
  }
});
  `);

  await t.test('Config loader', async () => {
    const configPath = path.join(tmpDir, 'code-mode-proxy.json');
    await fs.writeFile(configPath, JSON.stringify({
      allow: ['fake.echo', 'fake.delete_allowed'],
      mcpServers: { fake: { command: process.execPath, args: [fakeUpstreamScript] } }
    }));
    await assert.rejects(loadConfig(configPath), /managed by lean-agents/);

    await fs.writeFile(configPath, JSON.stringify({
      "//": "managed by lean-agents",
      allow: ['fake.echo', 'fake.delete_allowed'],
      mcpServers: { fake: { command: process.execPath, args: [fakeUpstreamScript] } }
    }));

    if (os.platform() !== 'win32') {
      chmodSync(configPath, 0o666);
      await assert.rejects(loadConfig(configPath), /group- or world-writable/);
      chmodSync(configPath, 0o600);
    }
    const config = await loadConfig(configPath);
    assert.ok(config);

    const badConfigPath = path.join(tmpDir, 'bad-config.json');
    await fs.writeFile(badConfigPath, JSON.stringify({
      "//": "managed by lean-agents",
      mcpServers: { bad: { command: path.resolve('/tmp/test.cmd') } }
    }));
    if (os.platform() !== 'win32') chmodSync(badConfigPath, 0o600);
    await assert.rejects(loadConfig(badConfigPath), /\.cmd or \.bat/);
  });

  await t.test('Policy evaluation', async () => {
    const policy = new Policy({ allow: ['fake.echo', 'fake.delete_allowed'] });
    policy.setTools('fake', [
      { name: 'echo' },
      { name: 'readOnly', annotations: { readOnlyHint: true } },
      { name: 'blocked' },
      { name: 'delete_something' },
      { name: 'delete_allowed' },
      { name: 'edit_file' }
    ]);
    assert.equal(policy.isBlocked('fake', 'echo'), false);
    assert.equal(policy.isBlocked('fake', 'readOnly'), false);
    assert.equal(policy.isBlocked('fake', 'blocked'), true);
    assert.equal(policy.isBlocked('fake', 'delete_something'), true);
    assert.equal(policy.isBlocked('fake', 'edit_file'), true);
    assert.equal(policy.isBlocked('fake', 'delete_allowed'), false);
  });

  let policy, upstreamManager, auditLog, listRes;
  const logPath = path.join(tmpDir, 'audit.log');

  await t.test('Start Upstream and Audit', async () => {
    const configPath = path.join(tmpDir, 'code-mode-proxy.json');
    await fs.writeFile(configPath, JSON.stringify({
      "//": "managed by lean-agents",
      allow: ['fake.echo', 'fake.delete_allowed', 'fake.slow', 'fake.env', 'fake.never_resolving', 'fake.large'],
      mcpServers: { fake: { command: process.execPath, args: [fakeUpstreamScript], env: { CUSTOM_VAR: 'val123' } } }
    }));
    if (os.platform() !== 'win32') chmodSync(configPath, 0o600);
    const config = await loadConfig(configPath);
    
    policy = new Policy(config);
    upstreamManager = new UpstreamManager(tmpDir);
    auditLog = new AuditLog(logPath, false);
    await auditLog.init();

    process.env.NODE_OPTIONS = '--max-old-space-size=512';
    await upstreamManager.startAll(config);
    const fakeUpstream = upstreamManager.upstreams.get('fake');
    assert.equal(fakeUpstream.status, 'ok');

    listRes = await upstreamManager.request('fake', 'tools/list');
    policy.setTools('fake', listRes.tools);
  });

  const getSandbox = (opts = {}) => new Sandbox(Object.assign({ wallTime: 2000, callLimit: 5, memoryLimit: 64 * 1024 * 1024 }, opts));
  const runCode = async (code, sb = getSandbox()) => {
    return sb.runScript(code, { fake: listRes.tools, __proto__: [{ name: 'x' }] }, policy, upstreamManager, auditLog);
  };

  await t.test('Sandbox Probes and exact globalThis keys', async () => {
    const keysProbe = await runCode(`Object.getOwnPropertyNames(globalThis).join(',')`);
    const actualKeys = new Set(keysProbe.result.split(','));
    const expectedKeys = new Set(["Error","EvalError","RangeError","ReferenceError","SyntaxError","TypeError","URIError","InternalError","AggregateError","Array","Object","Function","Iterator","parseInt","parseFloat","isNaN","isFinite","decodeURI","decodeURIComponent","encodeURI","encodeURIComponent","escape","unescape","Infinity","NaN","undefined","eval","Number","Boolean","String","Math","Reflect","Symbol","globalThis","BigInt","Date","RegExp","JSON","Proxy","Map","Set","WeakMap","WeakSet","ArrayBuffer","SharedArrayBuffer","Uint8ClampedArray","Int8Array","Uint8Array","Int16Array","Uint16Array","Int32Array","Uint32Array","BigInt64Array","BigUint64Array","Float16Array","Float32Array","Float64Array","DataView","Promise","WeakRef","FinalizationRegistry","console","tools"]);
    for (const k of actualKeys) {
      assert.ok(expectedKeys.has(k), `Unexpected key: ${k}`);
    }
    for (const k of expectedKeys) {
      assert.ok(actualKeys.has(k), `Missing key: ${k}`);
    }
    const processProbe = await runCode(`process.exit(0)`);
    assert.match(processProbe.error, /process.*is not defined/i);
    const requireProbe = await runCode(`require('fs')`);
    assert.match(requireProbe.error, /require.*is not defined/i);
    const fetchProbe = await runCode(`fetch('http://localhost')`);
    assert.match(fetchProbe.error, /fetch.*is not defined/i);
    const importProbe = await runCode(`import fs from 'fs'`);
    assert.match(importProbe.error, /Modules are not allowed/i);
  });

  await t.test('Limits: Memory, Infinite Loop, Deep Recursion, Await null', async () => {
    policy.calls = 0;
    const memProbe = await runCode(`
      let s = "x";
      try {
        while(true) s += s;
      } catch(e) { throw e; }
    `);
    assert.match(memProbe.result || memProbe.error, /out of memory|InternalError|string too long|interrupted/i);

    const loopProbe = await runCode(`while(true) {}`);
    assert.match(loopProbe.error, /interrupted/);

    const recurseProbe = await runCode(`function f() { f() } f()`);
    assert.match(recurseProbe.error, /stack overflow|call stack size/i);

    const awaitProbe = await runCode(`(async function f() { while(true) await null; })()`, getSandbox({ wallTime: 1000 }));
    assert.match(awaitProbe.error, /timed out|interrupted/i);
  });

  await t.test('Limits: Session Budget and per-script limit', async () => {
    policy.calls = 500;
    const sb = getSandbox();
    const budgetProbe = await runCode(`try { tools.fake.echo({ p: "x" }) } catch(e) { e.message }`, sb);
    assert.match(budgetProbe.result || budgetProbe.error, /budget/i);

    policy.calls = 0;
    const capProbe = await runCode(`(async () => {
      for (let i=0; i<10; i++) await tools.fake.echo({ p: "x" });
    })()`);
    assert.match(capProbe.error, /limit/);
  });

  await t.test('Sandbox: Object.prototype mutation prevented', async () => {
    await runCode(`Object.prototype.hacked = 42`);
    const protoProbe = await runCode(`({}).hacked`);
    assert.equal(protoProbe.result, undefined);
  });

  await t.test('Sandbox: Cut limit', async () => {
    const sb = getSandbox({ resultCap: 50 });
    const cutProbe = await runCode(`"x".repeat(100)`, sb);
    assert.match(cutProbe.result, /cut by proxy/);
  });

  await t.test('Sandbox: Schema checks', async () => {
    policy.calls = 0;
    const missingProp = await runCode(`try { tools.fake.echo({}) } catch(e) { e.message }`);
    assert.match(missingProp.result || missingProp.error, /Invalid arguments|Missing required/);
  });

  await t.test('Upstream: late reply and never-resolving', async () => {
    policy.calls = 0;
    const sb = getSandbox({ wallTime: 1000 });
    const lateProbe = await runCode(`(async () => await tools.fake.slow())()`, sb);
    assert.match(lateProbe.error, /timed out|interrupted/);

    const neverProbe = await runCode(`(async () => await tools.fake.never_resolving())()`, sb);
    assert.match(neverProbe.error, /timed out|interrupted/);
  });

  await t.test('Upstream: env stripped and 1MB line cap', async () => {
    policy.calls = 0;
    const envProbe = await runCode(`(async () => await tools.fake.env())()`);
    assert.ok(envProbe.result && !envProbe.result.includes('NODE_OPTIONS'), 'Result included NODE_OPTIONS: ' + envProbe.result);
    assert.ok(envProbe.result && envProbe.result.includes('CUSTOM_VAR'), 'Result missing CUSTOM_VAR: ' + envProbe.result);

    // 1MB line cap (upstream sends 2MB)
    const largeProbe = await runCode(`(async () => await tools.fake.large())()`);
    // Should fail and kill upstream
    assert.ok(largeProbe.error);
    const upstream = upstreamManager.upstreams.get('fake');
    assert.equal(upstream.status, 'unavailable');
  });

  await t.test('Proxy features via server.mjs: concurrency caps, schema check, search_tools, stdin close', async () => {
    // Write full config
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
      env: { ...process.env, HOME: tmpDir },
      stdio: ['pipe', 'pipe', 'pipe']
    });

    t.after(() => { cp.kill(); });
    let srvBuf = '';
    let srvErr = '';
    cp.stdout.on('data', d => { srvBuf += d.toString(); });
    cp.stderr.on('data', d => { srvErr += d.toString(); });
    
    // Send init
    cp.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }) + '\n');
    
    await new Promise(r => setTimeout(r, 1000));
    
    cp.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'search_tools', arguments: { query: 'echo' } } }) + '\n');
    await new Promise(r => setTimeout(r, 500));
    assert.match(srvBuf, /echoes/, 'Output missing echoes. Stderr: ' + srvErr);

    cp.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'run_script', arguments: { code: '(async () => { await tools.fake.slow(); })()' } } }) + '\n');
    cp.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'run_script', arguments: { code: '(async () => { await tools.fake.slow(); })()' } } }) + '\n');
    cp.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'run_script', arguments: { code: '42' } } }) + '\n');
    await new Promise(r => setTimeout(r, 500));
    assert.match(srvBuf, /Too many concurrent/);

    // Kill on stdin close
    cp.stdin.end();
    await new Promise(r => cp.on('exit', r));
  });

  await t.test('Audit log: redaction, rotation, 0600', async () => {
    // AuditLog was already writing during previous tests.
    // Redaction
    auditLog.logArgs = true;
    auditLog.logStderr('fake', 'Secret api_key="secret123" and gh_token github_' + 'pat_11ABCD00000000000000000000');
    auditLog.logCall({
      scriptSha256: 'abc', count: 1, server: 'fake', tool: 'echo', duration: 10, ok: true, blocked: false,
      args: '{"x":"npm_' + '12345678901234567890"}', result: 'ok'
    });
    
    // Force rotation by writing > 1MB
    auditLog.writeLine("x".repeat(1024 * 1024 + 10) + "\\n");

    const log1 = path.join(tmpDir, 'audit.log');
    const log2 = path.join(tmpDir, 'audit.log.1');
    assert.ok(await fs.stat(log1));
    assert.ok(await fs.stat(log2));

    if (os.platform() !== 'win32') {
      const stats = statSync(log1);
      assert.equal(stats.mode & 0o777, 0o600);
      const stats2 = statSync(log2);
      assert.equal(stats2.mode & 0o777, 0o600);
    }
    
    const content = await fs.readFile(log2, 'utf8');
    assert.match(content, /api_key=\\"<redacted>\\"/);
    assert.match(content, /<redacted-token>/);
    assert.ok(!content.includes('secret123'));
    assert.ok(!content.includes('github_' + 'pat_11ABCD00000000000000000000'));
    assert.ok(!content.includes('npm_' + '12345678901234567890'));
  });

  await t.test('remove.mjs logic', async () => {
    const runRemove = (dir) => {
      return spawnSync(process.execPath, [path.join(proxyDir, 'remove.mjs'), dir], { env: { LEAN_STATE_DIR: tmpDir } });
    };

    const fakeDir = path.join(tmpDir, 'to-remove');
    await fs.mkdir(fakeDir);
    const rm1 = runRemove(fakeDir);
    assert.equal(rm1.status, 1);
    assert.match(rm1.stderr.toString(), /marker file missing/);

    await fs.writeFile(path.join(fakeDir, '.lean-agents-code-mode-proxy'), 'managed by lean-agents');
    const rm2 = runRemove(fakeDir);
    assert.equal(rm2.status, 0);

    const outsideDir = path.join(os.tmpdir(), 'outside-test');
    await fs.mkdir(outsideDir, { recursive: true });
    const rm3 = runRemove(outsideDir);
    assert.equal(rm3.status, 1);
    assert.match(rm3.stderr.toString(), /outside lean data dir/);

    // symlink logic
    const linkDir = path.join(tmpDir, 'link-remove');
    await fs.symlink(tmpDir, linkDir, 'dir').catch(()=>null);
    const rm4 = runRemove(linkDir);
    assert.match(rm4.stderr.toString(), /is a symlink/);
  });

  t.after(() => {
    if (upstreamManager) upstreamManager.killAll();
    if (auditLog) auditLog.close();
  });
});
