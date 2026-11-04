// Settings upstream does not document (VERIFY in docs/compatibility.md). lean-agents never guesses
// them: the user pastes their docs or IT notes, saved as-is for an agent to apply after review.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { OWNED_MARK } from './fsops.mjs';
import { configHome } from './system.mjs';
import { redactUrl } from './network.mjs';

export const notesDir = (home) => path.join(home, '.config', 'lean-agents', 'notes');

// "kept": another agent or the user already set the tool up, so its config stays untouched.
export function unverifiedItems(o, home, { platform = process.platform, env = process.env, stateFiles = [] } = {}) {
  const ours = new Set(stateFiles.map((f) => f.path));
  const foreign = (p) => fs.existsSync(p) && !ours.has(p);
  const off = (c) => o.network[c] === 'off';
  const win = platform === 'win32';
  const items = [];
  const add = (id, label, kept = false) => items.push({ id, label, kept });
  if (o.agents.includes('antigravity') && (off('telemetry') || off('autoUpdate'))) add('antigravity', 'Antigravity telemetry and auto-update switches');
  if (o.tools.includes('serena')) add('serena', 'Serena config (serena_config.yml)', fs.existsSync(path.join(home, '.serena', 'serena_config.yml')));
  if (win && (env.HTTPS_PROXY || env.https_proxy || env.HTTP_PROXY || env.http_proxy)) add('winget-proxy', 'winget persistent proxy');
  if (o.tools.includes('playwright') || win) add('download-hosts', 'download hosts (Playwright browsers, winget packages)');
  if (off('telemetry')) {
    if (o.tools.includes('dcp')) add('dcp', 'DCP telemetry', foreign(path.join(configHome(home), 'opencode', 'dcp.jsonc')));
    if (o.tools.includes('gsd')) add('gsd', 'GSD telemetry', foreign(path.join(home, '.gsd', 'defaults.json')));
    if (o.tools.includes('autoskills')) add('autoskills', 'AutoSkills telemetry');
  }
  return items;
}

// The answer is one line of text or a path to a file with the docs.
export function notesFile(home, item, answer) {
  const p = answer.replace(/^~(?=[/\\])/, os.homedir());
  const fromFile = fs.existsSync(p) && fs.statSync(p).isFile();
  const text = redactUrl(fromFile ? fs.readFileSync(p, 'utf8') : answer).trimEnd();
  return {
    kind: 'file',
    path: path.join(notesDir(home), `${item.id}.md`),
    content: `<!-- ${OWNED_MARK}: your notes, never applied automatically -->\n# ${item.label}\n\n`
      + 'Upstream does not document this setting (VERIFY in lean-agents docs/compatibility.md).\n'
      + 'Ask your agent to apply these notes, showing you each change first.\n\n'
      + `Source: ${fromFile ? p : 'pasted'}\n\n${text}\n`,
  };
}
