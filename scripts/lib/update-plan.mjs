// The --update plan (#182): one row per tool `installed -> release pin`, what is held back, and the CHANGELOG notes
// since the installed lean-agents version. Pure: versions, state and the changelog text are passed in; no I/O, no network.
import { compare } from './node-runtime.mjs';
import { pinInUse } from './pins.mjs';

// Agent CLI binary -> [pin key, key in agents.json]. Cursor and Antigravity have no version pin, so they get no row.
const AGENTS = { claude: ['claude-code', 'claude'], opencode: ['opencode-v2', 'opencode-v2'], copilot: ['copilot-cli', 'copilot-cli'] };
const major = (v) => String(v).replace(/^v/, '').split('.')[0];
// `download` and `ciOnly` pins never reach state.pins (see pins.mjs), so they cannot be rows here either.
const tracked = (p) => !p.ciOnly && p.kind !== 'download';

// App releases use all their numeric parts (Warp: 0.2026.11.04.08.17.stable_01), unlike the x.y.z `compare`.
export function compareAppVersions(a, b) {
  const parts = (v) => String(v).replace(/^v/, '').split('.').map((n) => Number.parseInt(n, 10) || 0);
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0) ? 1 : -1;
  return 0;
}

const APP_LABEL = { orca: 'Orca', warp: 'Warp' };
// Optional terminal apps: a managed app behind its pin is an update row; a user-installed one is left alone.
export function appUpdateRows({ pins, installed = {}, managed = [] }) {
  const rows = [];
  for (const [app, label] of Object.entries(APP_LABEL)) {
    const have = installed[app];
    const pinned = pins[`${app}-app`]?.version;
    if (!have || !pinned || compareAppVersions(have, pinned) >= 0) continue;
    const isManaged = managed.includes(app);
    rows.push({
      tool: `${app}-app`, app, label, installed: have, pinned,
      action: isManaged ? 'update' : 'own',
      reason: isManaged ? null : 'installed by you, left alone',
    });
  }
  return rows;
}

export const appAdoptQuestion = (row) => `${row.label} ${row.installed} was not installed by lean-agents. Update it to ${row.pinned} and manage it?`;
export const appAdoptHint = (row) => `! ${row.label} app ${row.installed} -> ${row.pinned} is not managed: run --update --install-terminal ${row.app} to update it`;

// action: update (will move to the pin), held (never moved), major (pin is another major), own (not installed by lean-agents).
// `installed`: versions of the binaries on PATH ({ claude, opencode, copilot }, null when absent). `owned`: agents.json `agents` keys.
export function planUpdate({ saved, pins, installed = {}, owned = [] }) {
  const rows = [];
  for (const [tool, was] of Object.entries(saved.pins ?? {})) {
    const p = pins[tool];
    if (!p || !tracked(p) || p.version === was || !pinInUse(tool, saved.options)) continue;
    rows.push({ tool, installed: was, pinned: p.version, action: p.hold ? 'held' : 'update', reason: p.hold ? 'held pin' : null });
  }
  for (const [bin, [key, agent]] of Object.entries(AGENTS)) {
    const have = installed[bin];
    if (!have || have === 'unknown') continue;
    if (bin === 'opencode' && major(have) === '1') {
      rows.push({ tool: 'opencode-v1', installed: have, pinned: pins['opencode-v1']?.version ?? null, action: 'held', reason: 'OpenCode 1.x is never updated by lean-agents' });
      continue;
    }
    const pinned = pins[key]?.version;
    if (!pinned || compare(have, pinned) >= 0) continue;
    const base = { tool: key, installed: have, pinned };
    if (!owned.includes(agent)) rows.push({ ...base, action: 'own', reason: 'installed by you, left alone' });
    else if (major(have) !== major(pinned)) rows.push({ ...base, action: 'major', reason: `crosses major ${major(have)} -> ${major(pinned)}, update it yourself` });
    else rows.push({ ...base, action: 'update', reason: null });
  }
  return rows;
}

// `## [x.y.z]` sections of the shipped CHANGELOG newer than `from`, up to and including `to`; [Unreleased] is never included.
export function changelogNotes(text, from, to) {
  const out = [];
  let cur = null;
  for (const line of String(text ?? '').split('\n')) {
    const h = /^## \[(\d+\.\d+\.\d+)\]/.exec(line);
    if (h) {
      cur = compare(h[1], from) > 0 && compare(h[1], to) <= 0 ? { version: h[1], body: [] } : null;
      if (cur) out.push(cur);
    } else if (cur) cur.body.push(line);
  }
  return out.map((s) => ({ version: s.version, body: s.body.join('\n').trim() }));
}

const CHANGELOG_URL = 'https://github.com/estebanmr99/lean-agents/blob/main/CHANGELOG.md';
// First sentence: ends at . ! ? before a space or the end, not after e.g. / i.e. / etc. / vs. and not inside a version like v1.2.0.
const firstSentence = (t) => {
  for (const m of t.matchAll(/[.!?](?=\s|$)/g)) if (!/\b(e\.g|i\.e|etc|vs)$/i.test(t.slice(0, m.index))) { t = t.slice(0, m.index + 1); break; }
  return t.length > 160 ? `${t.slice(0, 159)}…` : t;
};
const briefBody = (body) => body.split('\n').filter((l) => /^\s*- /.test(l)).map((l) => `- ${firstSentence(l.replace(/^\s*- /, ''))}`).join('\n');

// `brief`: one line per release-note entry (its first sentence), then the CHANGELOG link (#491).
export function formatUpdatePlan(rows, notes, brief = false) {
  const out = [];
  const line = (r) => (r.app ? `${r.app} app ${r.installed} -> ${r.pinned}` : `${r.tool}: ${r.installed}${r.pinned && r.pinned !== r.installed ? ` -> ${r.pinned}` : ''}`);
  const moves = rows.filter((r) => r.action === 'update');
  const rest = rows.filter((r) => r.action !== 'update');
  if (moves.length) out.push('Pins that will change (old -> new):', ...moves.map(line));
  if (rest.length) out.push('Not updated:', ...rest.map((r) => `${line(r)} (${r.reason})`));
  if (notes.length) out.push(`Release notes since your version (${notes.map((n) => n.version).join(', ')}):`, ...notes.flatMap((n) => [`## ${n.version}`, brief ? briefBody(n.body) : n.body]));
  if (notes.length && brief) out.push(`Full notes: ${CHANGELOG_URL}`);
  return out.join('\n');
}
