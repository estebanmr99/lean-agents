import os from 'node:os';
import path from 'node:path';
import { RpcStream } from './rpc.mjs';
import { loadConfig } from './config.mjs';
import { Policy } from './policy.mjs';
import { UpstreamManager } from './upstream.mjs';
import { AuditLog } from './audit.mjs';
import { Sandbox } from './sandbox.mjs';

const home = os.homedir();
const stateDir = path.join(home, '.config', 'lean-agents');
const configPath = path.join(stateDir, 'code-mode-proxy.json');
const logPath = path.join(stateDir, 'code-mode-proxy.log');

let config;
let policy;
let upstreamManager;
let auditLog;
let sandbox;
let initialized = false;

// Gather all tools
const proxyTools = [
  {
    name: 'search_tools',
    description: 'Search available proxied tools by name or description.',
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string' } }
    }
  },
  {
    name: 'run_script',
    description: 'Run a JavaScript snippet in a sandbox to call proxied tools.',
    inputSchema: {
      type: 'object',
      properties: { code: { type: 'string' } },
      required: ['code']
    }
  }
];

const allUpstreamTools = new Map(); // server -> array of tools

async function start() {
  try {
    config = await loadConfig(configPath);
  } catch (err) {
    console.error(`Failed to load config: ${err.message}`);
    process.exit(1);
  }

  policy = new Policy(config);
  sandbox = new Sandbox(config);
  auditLog = new AuditLog(logPath, Boolean(config.log_args));
  await auditLog.init();

  upstreamManager = new UpstreamManager(stateDir);
  await upstreamManager.startAll(config);

  // Fetch tools from all available upstreams
  for (const [name, upstream] of upstreamManager.upstreams.entries()) {
    if (upstream.status === 'ok') {
      try {
        const res = await upstreamManager.request(name, 'tools/list');
        if (res && res.tools) {
          allUpstreamTools.set(name, res.tools);
          policy.setTools(name, res.tools);
        }
      } catch (err) {
        upstream.status = 'unavailable';
        upstream.reason = `tools/list failed: ${err.message}`;
      }
    }
  }

  const rpc = new RpcStream(process.stdin);
  
  // Forward upstream stderr to auditLog
  for (const [name, upstream] of upstreamManager.upstreams.entries()) {
    if (upstream.cp && upstream.cp.stderr) {
      upstream.cp.stderr.setEncoding('utf8');
      upstream.cp.stderr.on('data', (chunk) => {
        const lines = chunk.split('\n');
        for (const line of lines) {
          if (line.trim()) auditLog.logStderr(name, line);
        }
      });
    }
  }

  rpc.on('message', async (msg) => {
    if (!msg.method) return;

    if (msg.method === 'initialize') {
      initialized = true;
      rpc.send({
        jsonrpc: '2.0',
        id: msg.id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'code-mode-proxy', version: '1.0.0' }
        }
      });
    } else if (msg.method === 'notifications/initialized') {
      // Nothing to do
    } else if (msg.method === 'ping') {
      rpc.send({ jsonrpc: '2.0', id: msg.id, result: {} });
    } else if (msg.method === 'tools/list') {
      rpc.send({ jsonrpc: '2.0', id: msg.id, result: { tools: proxyTools } });
    } else if (msg.method === 'tools/call') {
      const name = msg.params?.name;
      const args = msg.params?.arguments || {};

      if (name === 'search_tools') {
        const query = (args.query || '').toLowerCase();
        let matches = [];
        for (const [server, tools] of allUpstreamTools.entries()) {
          for (const t of tools) {
            const isBlocked = policy.isBlocked(server, t.name);
            const signature = `${server}.${t.name}(${Object.keys(t.inputSchema?.properties || {}).join(', ')})`;
            const matchStr = `${signature} ${t.description}`.toLowerCase();
            if (!query || matchStr.includes(query)) {
              matches.push({
                path: `${server}.${t.name}`,
                signature,
                description: t.description,
                status: isBlocked ? 'blocked' : 'callable'
              });
            }
          }
        }
        rpc.send({ jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: JSON.stringify(matches, null, 2) }] } });
      } else if (name === 'run_script') {
        const code = args.code;
        if (typeof code !== 'string') {
          rpc.send({ jsonrpc: '2.0', id: msg.id, error: { code: -32602, message: 'code must be a string' } });
          return;
        }

        try {
          const res = await sandbox.runScript(code, Object.fromEntries(allUpstreamTools), policy, upstreamManager, auditLog);
          
          let text = '';
          if (res.error) text += `Error: ${res.error}\n`;
          if (res.result) text += `Result: ${res.result}\n`;
          if (res.logs) text += `Logs: ${res.logs}\n`;
          
          rpc.send({ jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: text.trim() }] } });
        } catch (err) {
          rpc.send({ jsonrpc: '2.0', id: msg.id, error: { code: -32603, message: err.message } });
        }
      } else {
        rpc.send({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: `Tool not found: ${name}` } });
      }
    } else {
      if (msg.id !== undefined) {
        rpc.send({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'Method not found' } });
      }
    }
  });

  rpc.on('end', () => {
    upstreamManager.killAll();
    auditLog.close();
    process.exit(0);
  });
  
  process.on('SIGINT', () => {
    upstreamManager.killAll();
    auditLog.close();
    process.exit(0);
  });
}

// Ensure process exit if stdin closes not gracefully
process.stdin.on('close', () => {
  if (upstreamManager) upstreamManager.killAll();
  if (auditLog) auditLog.close();
  process.exit(0);
});

start();
