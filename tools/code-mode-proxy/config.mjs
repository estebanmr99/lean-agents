import fs from 'node:fs/promises';
import { statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export async function loadConfig(configPath) {
  let content;
  try {
    content = await fs.readFile(configPath, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') {
      return { mcpServers: {}, allow: [] };
    }
    throw new Error(`Failed to read config at ${configPath}: ${err.message}`);
  }

  // POSIX check: not group/world writable
  if (os.platform() !== 'win32') {
    const stats = statSync(configPath);
    if ((stats.mode & 0o022) !== 0) {
      throw new Error(`Config at ${configPath} is group- or world-writable (mode ${stats.mode.toString(8)})`);
    }
  }

  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch (err) {
    throw new Error(`Config at ${configPath} is not valid JSON: ${err.message}`);
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`Config at ${configPath} must be a JSON object`);
  }

  if (!parsed['//'] || typeof parsed['//'] !== 'string' || !parsed['//'].includes('managed by lean-agents')) {
    throw new Error(`Config at ${configPath} is missing the "managed by lean-agents" mark at top-level "//" key`);
  }

  if (parsed.mcpServers) {
    for (const [name, server] of Object.entries(parsed.mcpServers)) {
      if (!server.command) continue;
      
      if (!path.isAbsolute(server.command)) {
        throw new Error(`Command for upstream ${name} is not an absolute path: ${server.command}`);
      }

      const isCmdOrBat = /\.cmd$/i.test(server.command) || /\.bat$/i.test(server.command);
      if (isCmdOrBat) {
        throw new Error(`Command for upstream ${name} ends in .cmd or .bat, which is rejected`);
      }
    }
  }

  const enforceLimit = (val, def) => {
    if (typeof val === 'number' && Number.isFinite(val) && val > 0) {
      return val;
    }
    return def;
  };

  parsed.memoryLimit = enforceLimit(parsed.memoryLimit, 64 * 1024 * 1024);
  parsed.stackSize = enforceLimit(parsed.stackSize, 512 * 1024);
  parsed.wallTime = enforceLimit(parsed.wallTime, 15000);
  parsed.callLimit = enforceLimit(parsed.callLimit, 25);
  parsed.resultCap = enforceLimit(parsed.resultCap, 20000);
  parsed.sessionBudget = enforceLimit(parsed.sessionBudget, 500);

  return parsed;
}
