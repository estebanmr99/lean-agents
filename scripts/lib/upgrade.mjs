// --upgrade-agent opencode (#80 PR A): the --adopt inventory plus, per OpenCode 1.x item, what a move to 2.x would do with it.
// Read-only: only key names are printed, never env or header values. `home`, `fsx` and `binary` are passed in so tests never read the real machine.
import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'jsonc-parser';
import { hasMark } from './fsops.mjs';
import { configHome } from './system.mjs';
import { configPath } from './adapters/opencode-v2.mjs';

const j = path.join;

// The translation table. `verified: false` rows are VERIFY (docs/compatibility.md): their items stay user-manual until proven.
export const TRANSLATIONS = [
  { key: 'agent', from: 'agent.<name>', to: 'agents.<name>', source: 'SPEC 0, real 2.2.5', verified: true },
  { key: 'plugin', from: 'plugin[] (npm spec)', to: 'plugins[]', source: 'SPEC 0, tests/real-opencode.sh', verified: true },
  { key: 'mcp', from: 'mcp.<name>', to: 'mcp.servers.<name>', source: 'SPEC 0, real 2.2.5 (tests/real-opencode.sh)', verified: true },
  { key: 'compaction.auto', from: 'compaction.auto', to: 'compaction.auto', source: 'SPEC 0', verified: true },
  { key: 'compaction.reserved', from: 'compaction.reserved', to: 'compaction.buffer', source: 'SPEC 0', verified: true },
  { key: 'autoupdate', from: 'autoupdate: false', to: 'update: "disable"', source: 'opencode.ai/docs/migrate-v1, 2026-11-12 (docs only)', verified: true },
  { key: 'autoupdate-true', from: 'autoupdate: true', to: 'update: "auto"', source: 'opencode.ai/docs/migrate-v1, 2026-11-12 (docs only)', verified: true },
  { key: 'disabled_providers', from: 'disabled_providers[]', to: 'policies: deny provider.use', source: 'real 2.1.4 accepts `policies` (tests/real-opencode.sh)', verified: true },
  ...['instructions', 'default_agent', 'model', 'share', 'shell'].map((k) => ({ key: k, from: k, to: k, source: 'real 2.2.5, #124b', verified: true })),
  { key: 'tui-plugin', from: 'tui.json(c) plugin[] (file://)', to: 'cli.json plugins[]', source: 'VERIFY: opencode.ai/docs/plugins says cli.json `plugins`, tui docs still say tui.json; no binary proof', verified: false },
  { key: 'keybinds', from: 'keybinds', to: '?', source: 'VERIFY: docs name no 2.x file for keybinds (tui.json vs cli.json)', verified: false },
  { key: 'dir', from: 'agent/ agents/ command/ commands/ folders', to: 'same folders', source: 'opencode.ai/docs/migrate-v1, 2026-11-12 (docs only)', verified: true },
  { key: 'skills', from: '~/.config/opencode/skills, ~/.agents/skills, ~/.claude/skills', to: 'same folders', source: 'opencode.ai/docs/skills, 2026-11-12 (docs only)', verified: true },
];
const row = (key) => TRANSLATIONS.find((t) => t.key === key);

// Keys with no verified 2.x equivalent, and so no row.
const MANUAL_KEYS = new Set(['provider']);
// Keys the docs name but whose value conversion they do not state as a rule (opencode.ai/docs/migrate-v1, permissions, config; 2026-11-13, docs only).
const MANUAL_WHY = {
  permission: 'VERIFY: 2.x renames it to `permissions` (array of {action, resource, effect}; bash -> shell, task -> subagent); the docs show no general rule to convert the 1.x values',
  experimental: 'VERIFY: 2.x keeps `experimental` but only `mcp_timeout` and `subagent_depth` have a documented mapping; `batch_tool`, `openTelemetry`, `primary_tools` and `continue_loop_on_deny` are ignored in 2.x',
};
const SAME = new Set(['instructions', 'default_agent', 'model', 'share', 'shell']);
const HANDLED = new Set(['$schema', 'mcp', 'plugin']); // mcp and plugin come from the adopt items

const readJson = (file, fsx) => { try { return parse(fsx.readFileSync(file, 'utf8'), [], { allowTrailingComma: true }) ?? null; } catch { return null; } };

const translate = (t, name, before = t.from.replace('<name>', name)) => ({ class: 'user-translatable', before, after: t.to.replace('<name>', name), reason: 'row in the translation table', source: t.source });
const verifyRow = (t, before) => ({ class: 'user-manual', before, after: null, reason: `${t.source}: no proven 2.x equivalent`, source: t.source });
const manual = (before, reason) => ({ class: 'user-manual', before, after: null, reason, source: null });
const managed = (before, after) => ({ class: 'managed', before, after, reason: 'lean-agents owns it; the 2.x adapter reinstalls it', source: 'adapters/opencode-v2.mjs' });

// The source text of a local plugin (a file, or the entry file of a folder), or null when unreadable.
function pluginSource(it, home, fsx) {
  const p = (x) => (x.startsWith('~') ? home + x.slice(1) : x);
  const f = p(it.source ?? it.file);
  try {
    if (!fsx.statSync(f).isDirectory()) return fsx.readFileSync(f, 'utf8');
    const entry = ['tui.js', 'index.js', 'index.ts'].find((n) => fsx.existsSync(j(f, n)));
    return entry ? fsx.readFileSync(j(f, entry), 'utf8') : null;
  } catch { return null; }
}
// Only a file that calls `api.command` gets the 1.x -> 2.x API reason; for the rest nothing is proven either way.
const localPluginReason = (text) => (text !== null && /\bapi\.command\b/.test(text)
  ? 'JS/TS plugin uses 1.x API `api.command`; 2.x uses `api.keymap`'
  : 'local plugin file: the 2.x plugin API is not proven for it');

// Classify one adopt item of the OpenCode 1.x config (mcp, plugin, plugins/ file) or a skill.
function classifyItem(it, stopgaps, home, fsx) {
  if (it.owner === 'managed') return managed(`${it.kind} ${it.name}`, it.kind === 'plugin' ? 'plugins[]' : it.kind === 'mcp' ? `mcp.servers.${it.name}` : it.file);
  if (it.kind === 'mcp') return translate(row('mcp'), it.name);
  if (it.kind === 'skill') { const t = row('skills'); return t.verified ? translate(t, it.name, `skill ${it.name}`) : verifyRow(t, `skill ${it.name}`); }
  if (it.kind === 'plugin' && it.keyPath.length) {
    const tui = /tui\.jsonc?$/.test(it.file);
    const t = row(tui ? 'tui-plugin' : 'plugin');
    if (!t.verified) return verifyRow(t, `${tui ? 'tui.json ' : ''}plugin ${it.name}`);
    if (it.source) return manual(`plugin ${it.name}`, localPluginReason(pluginSource(it, home, fsx)));
    return translate(t, it.name, `plugin ${it.name}`);
  }
  const sg = stopgaps.find((s) => s.file === it.file);
  if (sg) return manual(`plugin ${it.name}`, `leftover stopgap: replace with ${sg.replaceWith}`);
  return manual(`plugin ${it.name}`, localPluginReason(pluginSource(it, home, fsx)));
}

// Top-level keys of the 1.x config and the files in its agent/command folders, as new items (key names only).
function configItems(home, ocDir, fsx, rel) {
  const out = [];
  const file = configPath(ocDir);
  const mk = (kind, name, f, keyPath, owner, upgrade) => out.push({ client: 'opencode', kind, name, file: rel(f), keyPath, launch: null, owner, status: [], pin: null, wanted: null, action: 'keep', upgrade });
  const cfg = readJson(file, fsx);
  for (const [k, v] of Object.entries(cfg && typeof cfg === 'object' ? cfg : {})) {
    if (HANDLED.has(k)) continue;
    const at = (name, u) => mk('config', name, file, [k], 'user', u);
    if (k === 'agent') for (const n of Object.keys(v ?? {})) at(`agent.${n}`, translate(row('agent'), n));
    else if (k === 'compaction') for (const s of Object.keys(v ?? {})) at(`compaction.${s}`, ['auto', 'reserved'].includes(s) ? translate(row(`compaction.${s}`), s) : manual(`compaction.${s}`, 'no verified 2.x key'));
    else if (k === 'autoupdate') at(k, typeof v === 'boolean' ? translate(row(v ? 'autoupdate-true' : 'autoupdate'), k) : manual(k, 'no verified 2.x value (autoupdate "notify" is not in the table)'));
    else if (k === 'disabled_providers') at(k, translate(row(k), k));
    else if (SAME.has(k)) at(k, translate(row(k), k));
    else if (k === 'keybinds') at(k, verifyRow(row(k), k));
    else at(k, manual(k, MANUAL_WHY[k] ?? (MANUAL_KEYS.has(k) ? 'no verified 2.x key' : 'unknown 1.x key: no verified 2.x key')));
  }
  for (const d of ['agent', 'agents', 'command', 'commands']) {
    let list = [];
    try { list = fsx.readdirSync(j(ocDir, d), { withFileTypes: true }).filter((e) => e.isFile()); } catch { continue; }
    for (const e of list) {
      const f = j(ocDir, d, e.name);
      let owned = false;
      try { owned = hasMark(fsx.readFileSync(f, 'utf8')); } catch { /* unreadable: user */ }
      mk('file', `${d}/${e.name}`, f, [], owned ? 'managed' : 'user', owned ? managed(`${d}/${e.name}`, 'rewritten by the 2.x adapter') : row('dir').verified ? { ...translate(row('dir'), d), before: `${d}/${e.name}`, after: `${d}/${e.name}` } : verifyRow(row('dir'), `${d}/${e.name}`));
    }
  }
  return out;
}

// Where the `opencode` binary came from, by its path. Unknown paths stay unknown.
export const installVia = (p) => (!p ? null : /node_modules|[\\/]\.nvm[\\/]|[\\/]npm[\\/]/.test(p) ? 'npm' : /[\\/]\.opencode[\\/]bin/.test(p) ? 'script' : /homebrew|Cellar|linuxbrew/i.test(p) ? 'brew' : /scoop/i.test(p) ? 'scoop' : 'unknown');

export function upgradeInventory(inv, { home, fsx = fs, binary = { path: null, version: null } }) {
  const rel = (p) => (p && p.startsWith(home) ? `~${p.slice(home.length)}` : p);
  const ocDir = j(configHome(home), 'opencode');
  const items = inv.items.map((it) => {
    if (!(it.client === 'opencode' || it.kind === 'skill')) return it;
    return { ...it, upgrade: classifyItem(it, inv.stopgaps, home, fsx) };
  });
  items.push(...configItems(home, ocDir, fsx, rel));
  const mine = items.filter((i) => i.upgrade);
  const counts = { managed: 0, 'user-translatable': 0, 'user-manual': 0 };
  for (const i of mine) counts[i.upgrade.class]++;
  const plan = [
    ...(counts.managed ? [`reinstall ${counts.managed} managed items through the 2.x adapter`] : []),
    ...mine.filter((i) => i.upgrade.class === 'user-translatable').map((i) => `translate ${i.upgrade.before} -> ${i.upgrade.after}`),
    ...mine.filter((i) => i.upgrade.class === 'user-manual').map((i) => `manual ${i.upgrade.before}: ${i.upgrade.reason}`),
  ];
  return {
    ...inv,
    items,
    upgrade: {
      from: 'opencode-v1', to: 'opencode-v2',
      binary: { path: rel(binary.path), version: binary.version, via: installVia(binary.path) },
      layout: { configDir: rel(ocDir), dataDir: inv.opencode.dataDir, sessions: inv.opencode.sessions, major: inv.opencode.major },
      backup: null, // PR B: the permanent session backup
      counts, plan,
    },
  };
}

export function formatUpgrade(r) {
  const u = r.upgrade;
  const out = [`--upgrade-agent opencode (dry run: nothing is changed; apply is not in this release yet)`,
    `OpenCode: ${u.binary.version ?? 'version unknown'} at ${u.binary.path ?? 'not on PATH'} (${u.binary.via ?? 'n/a'}), major ${u.layout.major ?? 'none'}, sessions ${u.layout.sessions ?? 'unknown'}`,
    `${u.counts.managed} managed, ${u.counts['user-translatable']} translatable, ${u.counts['user-manual']} manual`];
  for (const i of r.items.filter((x) => x.upgrade)) out.push(`  ${i.upgrade.class.padEnd(16)} ${i.upgrade.before}${i.upgrade.after ? ` -> ${i.upgrade.after}` : ''}${i.upgrade.class === 'user-manual' ? `  (${i.upgrade.reason})` : ''}`);
  out.push('Translation table:', ...TRANSLATIONS.map((t) => `  ${t.from} -> ${t.to}  [${t.source}]`));
  return out.join('\n');
}
