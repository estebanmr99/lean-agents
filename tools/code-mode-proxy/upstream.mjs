import { spawn } from 'node:child_process';
import { RpcStream } from './rpc.mjs';

const PROXY_CA_VARS = [
  'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY',
  'http_proxy', 'https_proxy', 'no_proxy', 'all_proxy',
  'NODE_EXTRA_CA_CERTS', 'NODE_USE_SYSTEM_CA', 'NODE_USE_ENV_PROXY',
  'SSL_CERT_FILE', 'SSL_CERT_DIR', 'OPENSSL_CONF',
  'UV_SYSTEM_CERTS', 'REQUESTS_CA_BUNDLE', 'GIT_SSL_CAINFO',
  'CURL_CA_BUNDLE', 'PIP_CERT'
];

const BASE_VARS = [
  'PATH', 'HOME', 'USERPROFILE', 'SYSTEMROOT',
  'APPDATA', 'LOCALAPPDATA', 'TEMP', 'TMP', 'NVM_DIR'
];

function buildEnv(entryEnv) {
  const env = {};
  for (const name of [...BASE_VARS, ...PROXY_CA_VARS]) {
    if (process.env[name] !== undefined) {
      env[name] = process.env[name];
    }
  }
  if (entryEnv && typeof entryEnv === 'object') {
    for (const [k, v] of Object.entries(entryEnv)) {
      env[k] = v;
    }
  }
  return env;
}

function killTree(cp) {
  let exited = false;
  cp.on('exit', () => { exited = true; });
  if (process.platform === 'win32') {
    const killer = spawn('taskkill', ['/pid', String(cp.pid), '/f', '/t'], { stdio: 'ignore' });
    killer.on('error', () => {});
  } else {
    cp.kill('SIGTERM');
    setTimeout(() => {
      if (!exited) cp.kill('SIGKILL');
    }, 2000).unref();
  }
}

export class UpstreamManager {
  constructor(cwd) {
    this.cwd = cwd;
    this.upstreams = new Map(); // name -> { status, reason, ... }
    this.inFlightCalls = 0;
  }

  async startAll(config) {
    const promises = [];
    if (!config || !config.mcpServers) return;

    for (const [name, serverConfig] of Object.entries(config.mcpServers)) {
      promises.push(this.startOne(name, serverConfig));
    }
    await Promise.allSettled(promises);
  }

  async startOne(name, config) {
    return new Promise((resolve) => {
      let command = config.command;
      const args = config.args || [];
      
      const env = buildEnv(config.env);

      let cp;
      try {
        cp = spawn(command, args, {
          cwd: this.cwd,
          env,
          shell: false,
          windowsHide: true,
          stdio: ['pipe', 'pipe', 'pipe']
        });
        cp.stdin.on('error', () => {});
      } catch (err) {
        this.upstreams.set(name, { status: 'unavailable', reason: err.message });
        return resolve();
      }

      const stream = new RpcStream(cp.stdout);
      
      const upstream = {
        name,
        status: 'starting',
        cp,
        stream,
        pendingRequests: new Map(), // id -> { resolve, reject, timer }
        nextId: 1
      };

      this.upstreams.set(name, upstream);

      cp.on('error', (err) => {
        upstream.status = 'unavailable';
        upstream.reason = err.message;
        resolve();
      });

      cp.on('exit', (code, signal) => {
        upstream.status = 'unavailable';
        upstream.reason = `Exited with ${code ?? signal}`;
        for (const req of upstream.pendingRequests.values()) {
          clearTimeout(req.timer);
          req.reject(new Error('Upstream exited'));
        }
        upstream.pendingRequests.clear();
      });

      stream.on('error', (err) => {
        if (err.message.includes('Parse error') || err.message.includes('parse')) {
          return;
        }
        upstream.status = 'unavailable';
        upstream.reason = 'RpcStream error: ' + err.message;
        for (const req of upstream.pendingRequests.values()) {
          clearTimeout(req.timer);
          req.reject(new Error('RpcStream error: ' + err.message));
        }
        upstream.pendingRequests.clear();
        killTree(cp);
      });

      stream.on('message', (msg) => {
        this.handleMessage(upstream, msg);
      });

      // Send initialize
      const initReq = {
        jsonrpc: '2.0',
        id: upstream.nextId++,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'code-mode-proxy', version: '1.0.0' }
        }
      };

      const timer = setTimeout(() => {
        if (upstream.status === 'starting') {
          upstream.status = 'unavailable';
          upstream.reason = 'initialize timed out';
          killTree(cp);
          resolve();
        }
      }, 10000);

      upstream.pendingRequests.set(initReq.id, {
        resolve: (result) => {
          clearTimeout(timer);
          upstream.status = 'ok';
          
          // Send notifications/initialized
          try {
            const initNotif = { jsonrpc: '2.0', method: 'notifications/initialized' };
            const serialized = JSON.stringify(initNotif);
            cp.stdin.write(serialized + '\n');
          } catch (e) {
            // ignore
          }
          
          resolve();
        },
        reject: (err) => {
          clearTimeout(timer);
          upstream.status = 'unavailable';
          upstream.reason = err.message;
          resolve();
        },
        timer
      });

      try {
        const serialized = JSON.stringify(initReq);
        cp.stdin.write(serialized + '\n');
      } catch (err) {
        clearTimeout(timer);
        upstream.status = 'unavailable';
        upstream.reason = err.message;
        resolve();
      }
    });
  }

  handleMessage(upstream, msg) {
    if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return;
    if (msg.id !== undefined && !msg.method) {
      // It's a response
      const req = upstream.pendingRequests.get(msg.id);
      if (req) {
        upstream.pendingRequests.delete(msg.id);
        clearTimeout(req.timer);
        if (msg.error) {
          req.reject(msg.error);
        } else {
          req.resolve(msg.result);
        }
      }
    } else if (msg.method) {
      // Upstream-initiated request or notification
      if (msg.id !== undefined) {
        // Reply -32601 Method not found
        try {
          const reply = {
            jsonrpc: '2.0',
            id: msg.id,
            error: { code: -32601, message: 'Method not found' }
          };
          const serialized = JSON.stringify(reply);
          if (upstream.cp.stdin.writable) {
            upstream.cp.stdin.write(serialized + '\n');
          }
        } catch (e) {
          // ignore
        }
      }
    }
  }

  async request(name, method, params, timeoutMs = 15000, abortSignal) {
    if (this.inFlightCalls >= 4) {
      throw new Error('Too many in-flight upstream calls (cap is 4)');
    }
    this.inFlightCalls++;
    try {
      return await this._requestInternal(name, method, params, timeoutMs, abortSignal);
    } finally {
      this.inFlightCalls--;
    }
  }

  async _requestInternal(name, method, params, timeoutMs = 15000, abortSignal) {
    const upstream = this.upstreams.get(name);
    if (!upstream || upstream.status !== 'ok') {
      throw new Error(`Upstream ${name} is not available`);
    }

    const id = upstream.nextId++;
    const msg = { jsonrpc: '2.0', id, method };
    if (params !== undefined) msg.params = params;

    return new Promise((resolve, reject) => {
      let aborted = false;
      const timer = setTimeout(() => {
        if (aborted) return;
        upstream.pendingRequests.delete(id);
        reject(new Error(`Upstream ${name} timed out after ${timeoutMs}ms for ${method}`));
      }, timeoutMs);

      const req = { resolve, reject, timer };
      upstream.pendingRequests.set(id, req);

      const onAbort = () => {
        aborted = true;
        upstream.pendingRequests.delete(id);
        clearTimeout(timer);
        reject(new Error('Aborted'));
      };
      if (abortSignal) {
        abortSignal.addEventListener('abort', onAbort);
        req.resolve = (val) => { abortSignal.removeEventListener('abort', onAbort); resolve(val); };
        req.reject = (err) => { abortSignal.removeEventListener('abort', onAbort); reject(err); };
      }

      try {
        const serialized = JSON.stringify(msg);
        upstream.cp.stdin.write(serialized + '\n');
      } catch (err) {
        upstream.pendingRequests.delete(id);
        clearTimeout(timer);
        reject(err);
      }
    });
  }

  killAll() {
    for (const upstream of this.upstreams.values()) {
      if (upstream.cp && !upstream.cp.killed) {
        killTree(upstream.cp);
      }
    }
  }
}
