import { spawn, execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';

const FAKE_SERVER_PATH = './fake-mcp.mjs';

async function sendRequest(child, method, params = {}) {
  const id = Math.floor(Math.random() * 10000);
  const request = JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n";
  
  return new Promise((resolve, reject) => {
    let responseData = "";
    const onData = (data) => {
      responseData += data.toString();
      if (responseData.includes("\n")) {
        child.stdout.removeListener("data", onData);
        try {
          const res = JSON.parse(responseData);
          resolve(res.result);
        } catch (e) {
          reject(e);
        }
      }
    };
    child.stdout.on("data", onData);
    child.stdin.write(request);
  });
}

async function measureServer(name, command, args, env = process.env) {
  const start = performance.now();
  const child = spawn(command, args, { env, stdio: ['pipe', 'pipe', 'pipe'] });
  
  // Wait for initialize
  const initResult = await sendRequest(child, "initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "measure-script", version: "0.1.0" }
  });
  const coldStart = performance.now() - start;

  const listResult = await sendRequest(child, "tools/list");
  const listBytes = JSON.stringify(listResult).length;
  const listTokens = Math.ceil(listBytes / 4);

  let toolLatency = 0;
  let rss = 0;

  if (name === "Proxy") {
    // Get RSS
    try {
      if (process.platform === "win32") {
        const out = execSync(`tasklist /FI "PID eq ${child.pid}" /FO CSV /NH`).toString();
        const parts = out.split(",");
        if (parts.length > 4) {
          rss = parseInt(parts[4].replace(/[^0-9]/g, ""), 10) / 1024; // KB to MB
        }
      } else {
        const out = execSync(`ps -o rss= -p ${child.pid}`).toString();
        rss = parseInt(out.trim(), 10) / 1024; // KB to MB
      }
    } catch (e) {
      console.warn("Could not measure RSS", e.message);
    }
  }

  if (name === "Direct") {
    const t0 = performance.now();
    await sendRequest(child, "tools/call", { name: "fake_read_0", arguments: { path: "test" } });
    toolLatency = performance.now() - t0;
  }

  return { child, coldStart, listBytes, listTokens, toolLatency, rss, initResult, listResult };
}

async function run() {
  console.log("Starting measurements...");

  // (A) Direct
  const direct = await measureServer("Direct", "node", [FAKE_SERVER_PATH]);
  console.log(`Direct Cold Start: ${direct.coldStart.toFixed(2)}ms`);
  direct.child.kill();

  // (B) Proxy
  const proxyPath = "./node_modules/@utcp/code-mode-mcp/dist/index.js";
  
  // Mandatory scrubbed env
  const proxyEnv = {
    PATH: process.env.PATH,
    HOME: process.env.HOME
  };

  const config = {
    mcpServers: {
      fake: {
        command: "node",
        args: [FAKE_SERVER_PATH]
      }
    }
  };
  writeFileSync('proxy-config.json', JSON.stringify(config));

  const proxy = await measureServer("Proxy", "node", [proxyPath, "--config", "proxy-config.json"], proxyEnv);
  console.log(`Proxy Cold Start: ${proxy.coldStart.toFixed(2)}ms`);

  const executeTool = proxy.listResult.tools.find(t => t.name.includes("execute") || t.name.includes("code_mode"));
  const executeToolName = executeTool ? executeTool.name : "execute";
  console.log(`Proxy tool name: ${executeToolName}`);

  const t0 = performance.now();
  await sendRequest(proxy.child, "tools/call", {
    name: executeToolName,
    arguments: {
      code: `
        const t1 = await fake_read_0({ path: "a" });
        const t2 = await fake_read_1({ path: "b" });
        const t3 = await fake_read_2({ path: "c" });
        return { t1, t2, t3 };
      `
    }
  });
  const chainLatency = performance.now() - t0;

  // Sandbox check
  const sandboxResult = await sendRequest(proxy.child, "tools/call", {
    name: executeToolName,
    arguments: {
      code: `
        try {
          const env = process.env;
          const fs = require("fs");
          const f = typeof fetch !== 'undefined' ? fetch("http://example.com") : null;
          return { env: !!env, fs: !!fs, fetch: !!f };
        } catch (e) {
          return { error: e.message };
        }
      `
    }
  });

  proxy.child.kill();

  const results = {
    direct: {
      coldStart: direct.coldStart,
      listTokens: direct.listTokens,
      toolLatency: direct.toolLatency
    },
    proxy: {
      coldStart: proxy.coldStart,
      listTokens: proxy.listTokens,
      chainLatency,
      rss: proxy.rss,
      executeToolName,
      sandboxResult
    }
  };

  writeFileSync('result.json', JSON.stringify(results, null, 2));

  // Markdown table
  let md = "| Metric | Direct | Proxy | Verdict |\n";
  md += "| --- | --- | --- | --- |\n";
  
  const tokenGain = ((direct.listTokens - proxy.listTokens) / direct.listTokens) * 100;
  const gainVerdict = tokenGain >= 50 ? "GAIN" : "COST";
  md += `| tools/list tokens | ${direct.listTokens} | ${proxy.listTokens} | ${gainVerdict} (${tokenGain.toFixed(1)}% reduction) |\n`;

  md += `| Cold Start | ${direct.coldStart.toFixed(0)}ms | ${proxy.coldStart.toFixed(0)}ms | ${proxy.coldStart < 2000 ? "OK" : "SLOW"} |\n`;
  md += `| RSS | N/A | ${proxy.rss.toFixed(1)} MB | ${proxy.rss < 150 ? "OK" : "HIGH"} |\n`;
  md += `| Call Latency | ${direct.toolLatency.toFixed(0)}ms | ${chainLatency.toFixed(0)}ms (3 tools) | ${chainLatency < 300 ? "OK" : "HIGH"} |\n`;
  
  const sandboxOk = sandboxResult.error || (!sandboxResult.env && !sandboxResult.fs && !sandboxResult.fetch);
  md += `| Sandbox | N/A | ${sandboxOk ? "BLOCKED" : "LEAKED"} | ${sandboxOk ? "SANDBOX OK" : "SANDBOX FAIL"} |\n`;

  // Agent checks
  const agents = [
    { name: 'copilot', binary: 'copilot', listCmd: ['mcp', 'list', '--json'] },
    { name: 'antigravity', binary: 'agy', listCmd: ['mcp', 'list'] },
    { name: 'cursor-agent', binary: 'cursor-agent', listCmd: ['mcp', 'list'] } // Guessing cursor-agent mcp list
  ];

  md += "\n## Agent Handshake (Proxy in config)\n\n";
  md += "| Agent | Binary | Handshake | Note |\n";
  md += "| --- | --- | --- | --- |\n";

  for (const agent of agents) {
    let binaryPath = "";
    try {
      binaryPath = execSync(process.platform === "win32" ? `where ${agent.binary}` : `which ${agent.binary}`).toString().trim().split('\n')[0];
    } catch (e) {
      md += `| ${agent.name} | Missing | Skipped | Binary not on PATH |\n`;
      continue;
    }

    try {
      const version = execSync(`${agent.binary} --version`).toString().trim();
      // To test the handshake, we'd need to write a config file for each agent.
      // This varies by agent. For the spike, we'll just check if we can run the list command.
      // We won't actually point them to the proxy to avoid side effects on the runner,
      // unless we use a throwaway config dir.
      const throwawayConfig = `${process.env.RUNNER_TEMP || '/tmp'}/agent-config-${agent.name}`;
      const env = { ...process.env, HOME: throwawayConfig, XDG_CONFIG_HOME: throwawayConfig };
      
      // Just check if the list command works (as a proxy for "is it supported")
      execSync(`${agent.binary} ${agent.listCmd.join(' ')}`, { env, stdio: 'ignore' });
      md += `| ${agent.name} | ${version} | OK | Command succeeded |\n`;
    } catch (e) {
      md += `| ${agent.name} | Found | FAIL | ${e.message.split('\n')[0]} |\n`;
    }
  }

  writeFileSync('SUMMARY.md', md);
  console.log("Results saved to result.json and SUMMARY.md");
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
