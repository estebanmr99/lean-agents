// Seeds a hand-built machine into a throwaway HOME for --adopt tests (plan 106 section 5). Used by tests/adopt.test.mjs and the
// real-tool-node job: `node tests/fixtures/handbuilt.mjs <home> <oldNodeDir> <oldVersion> <newNodeDir> <newVersion> <link> [win]` seeds,
// `node tests/fixtures/handbuilt.mjs hash <dir>` prints a tree hash.
// The "old" Node (below a pin's range) and the "new" Node are folders that may already hold a real Node; a fake binary is written only when missing.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const j = path.join;
const put = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };

// One hash over every path and byte under dir (symlinks and junctions count by target text, never followed).
export function treeHash(dir) {
  const h = createHash('sha256');
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const p = j(d, e.name);
      h.update(`${path.relative(dir, p)}\0`);
      if (e.isSymbolicLink()) h.update(fs.readlinkSync(p));
      else if (e.isDirectory()) walk(p);
      else if (e.isFile()) h.update(fs.readFileSync(p));
    }
  };
  walk(dir);
  return h.digest('hex');
}

export const SECRETS = ['relay-env-secret-123', 'relay-header-secret-456', 'hook-arg-secret-789']; // gitleaks:allow (fake values the tests assert are never printed)

export async function seedHandbuilt(home, { old, neu, link, win = false }) {
  const bin = (n) => (win ? j(n.dir, 'node.exe') : j(n.dir, 'bin', 'node'));
  const mods = (n) => (win ? j(n.dir, 'node_modules') : j(n.dir, 'lib', 'node_modules'));
  for (const n of [old, neu]) if (!fs.existsSync(bin(n))) { put(bin(n), '#!/bin/sh\nexit 0\n'); fs.chmodSync(bin(n), 0o755); }
  // The same pinned package under both Nodes, a version apart: a duplicate and a drift.
  put(j(mods(old), 'context-mode', 'package.json'), '{"name":"context-mode","version":"2.1.4"}');
  put(j(mods(neu), 'context-mode', 'package.json'), '{"name":"context-mode","version":"2.1.3"}');
  if (!fs.existsSync(link)) fs.symlinkSync(old.dir, link, 'junction');
  const linkNode = win ? j(link, 'node.exe') : j(link, 'bin', 'node');
  const cli = j(mods(old), 'context-mode', 'cli.mjs');

  put(j(home, '.claude.json'), JSON.stringify({ mcpServers: {
    'context-mode': { command: 'npx', args: ['-y', 'context-mode@2.1.4', 'server'] }, // bare npx
    'ctx-link': { command: linkNode, args: [cli, 'server'] }, // symlink Node
    relay: { command: 'node', args: [j(home, 'relay.js')], env: { RELAY_TOKEN: SECRETS[0] } }, // user relay
    remote: { type: 'http', url: 'https://example.invalid/mcp', headers: { Authorization: `Bearer ${SECRETS[1]}` } },
  } }));
  put(j(home, '.claude', 'settings.json'), JSON.stringify({
    enabledPlugins: { 'ghost@nowhere': true, 'context-mode@context-mode': true },
    hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'rtk hook claude' }, { type: 'command', command: 'echo my-own-hook' }, { type: 'command', command: `mytool --api-key=${SECRETS[2]}` }] }] },
  }));
  put(j(home, '.claude', 'plugins', 'installed_plugins.json'), JSON.stringify({ version: 1, plugins: { 'context-mode@context-mode': [{ scope: 'user' }] } }));

  const oc = j(home, '.config', 'opencode');
  put(j(oc, 'opencode.jsonc'), `{\n  // user comment\n  "mcp": { "context-mode": { "type": "local", "command": ["npx", "-y", "context-mode@2.1.4", "server"] }, "mine": { "type": "remote", "url": "https://example.invalid/mine", "headers": { "Authorization": "Bearer ${SECRETS[1]}" } } },\n  "agent": { "reviewer": { "mode": "subagent" } },\n  "compaction": { "auto": true, "reserved": 20000 },\n  "autoupdate": false,\n  "disabled_providers": ["opencode"],\n  "keybinds": { "leader": "ctrl+x" },\n  "provider": { "acme": { "options": { "apiKey": "${SECRETS[0]}" } } },\n  "plugin": ["context-mode", "some-npm-plugin@1.0.0", "${new URL(`file://${win ? '/' : ''}${j(home, 'gone', 'plugin.js').replaceAll('\\', '/')}`).href}"]\n}\n`);
  put(j(oc, 'tui.json'), JSON.stringify({ plugin: [new URL(`file://${win ? '/' : ''}${j(oc, 'plugins', 'copilot-usage-tui', 'tui.js').replaceAll('\\', '/')}`).href] }));
  put(j(oc, 'agents', 'mine.md'), '# my agent\n'); // a 1.x agents/ file of the user's
  put(j(oc, 'agent', 'lean.md'), '<!-- managed by lean-agents -->\n'); // an owned one
  put(j(oc, 'plugins', 'rtk.ts'), 'export default {}\n'); // a user plugin: no lean-agents mark
  put(j(oc, 'plugins', 'orca-status-tui-shim.js'), 'export default {}\n'); // #78 stopgap
  put(j(home, '.local', 'bin', 'copilot-usage'), '#!/bin/sh\n'); // #123 stopgap

  put(j(home, '.agents', 'skills', 'dup-demo', 'SKILL.md'), '# one\n');
  put(j(home, '.claude', 'skills', 'dup-demo', 'SKILL.md'), '# two\n');

  // OpenCode 1.x database with sessions, when this Node can create one.
  let sessions = null;
  try {
    const { DatabaseSync } = await import('node:sqlite');
    const dir = j(home, '.local', 'share', 'opencode');
    fs.mkdirSync(dir, { recursive: true });
    const db = new DatabaseSync(j(dir, 'opencode.db'));
    db.exec('CREATE TABLE session (id TEXT PRIMARY KEY); INSERT INTO session VALUES (\'a\'),(\'b\'),(\'c\');');
    db.close();
    sessions = 3;
  } catch { /* no node:sqlite: the report says sessions null */ }
  return { linkNode, sessions };
}

if (process.argv[1] === fileURLToPath(import.meta.url) && process.argv[2] === 'hash') console.log(treeHash(process.argv[3]));
else if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [home, oldDir, oldV, newDir, newV, link, win] = process.argv.slice(2);
  const r = await seedHandbuilt(home, { old: { dir: oldDir, version: oldV }, neu: { dir: newDir, version: newV }, link, win: win === 'win' });
  console.log(JSON.stringify(r));
}
