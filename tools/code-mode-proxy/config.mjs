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

  if (!content.includes('managed by lean-agents')) {
    throw new Error(`Config at ${configPath} is missing the "managed by lean-agents" mark`);
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

  if (parsed.mcpServers) {
    for (const [name, server] of Object.entries(parsed.mcpServers)) {
      if (!server.command) continue;
      
      const isCmdOrBat = /\.cmd$/i.test(server.command) || /\.bat$/i.test(server.command);
      if (isCmdOrBat) {
        throw new Error(`Command for upstream ${name} ends in .cmd or .bat, which is rejected`);
      }
    }
  }

  return parsed;
}
