// File operations: plan each change without touching disk, then apply with backups.
// Three action kinds:
//   file  - a whole file lean-agents owns (rules, agent definitions, loaders)
//   json  - edits to a JSON/JSONC file the user owns; comments and formatting survive
//   block - a marked block inside a text file the user owns (CLAUDE.md, AGENTS.md)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { parse, modify, applyEdits, findNodeAtLocation, parseTree } from 'jsonc-parser';

export const OWNED_MARK = 'managed by lean-agents';
const BLOCK_START = '<!-- lean-agents:start -->';
const BLOCK_END = '<!-- lean-agents:end -->';
const FORMAT = { formattingOptions: { insertSpaces: true, tabSize: 2, eol: '\n' } };

export const sha = (text) => crypto.createHash('sha256').update(text).digest('hex');
const read = (p) => (fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null);

function getAt(text, keyPath) {
  const tree = parseTree(text);
  if (!tree) return undefined;
  const node = findNodeAtLocation(tree, keyPath);
  return node === undefined ? undefined : parse(text.slice(node.offset, node.offset + node.length));
}

// Returns { text, applied: [edit], kept: [{path, value}] }.
export function applyJsonEdits(original, edits) {
  let text = original && original.trim() ? original : '{}\n';
  const applied = [];
  const kept = [];
  for (const e of edits) {
    const current = getAt(text, e.path);
    if (e.mode === 'arrayAdd') {
      const list = Array.isArray(current) ? current : [];
      if (list.some((v) => JSON.stringify(v) === JSON.stringify(e.value))) continue;
      const target = Array.isArray(current) ? [...e.path, -1] : e.path;
      const value = Array.isArray(current) ? e.value : [e.value];
      text = applyEdits(text, modify(text, target, value, { ...FORMAT, isArrayInsertion: true }));
      applied.push(e);
      continue;
    }
    if (current !== undefined) {
      if (JSON.stringify(current) === JSON.stringify(e.value)) continue;
      if (e.mode !== 'set') {
        kept.push({ path: e.path, value: current });
        continue;
      }
    }
    text = applyEdits(text, modify(text, e.path, e.value, FORMAT));
    applied.push(e);
  }
  return { text, applied, kept };
}

// Undo edits recorded at install time, leaving every other key alone.
export function revertJsonEdits(text, applied) {
  for (const e of [...applied].reverse()) {
    if (e.mode === 'arrayAdd') {
      const list = getAt(text, e.path);
      if (!Array.isArray(list)) continue;
      const i = list.findIndex((v) => JSON.stringify(v) === JSON.stringify(e.value));
      if (i >= 0) text = applyEdits(text, modify(text, [...e.path, i], undefined, FORMAT));
    } else if (e.previous === undefined) {
      text = applyEdits(text, modify(text, e.path, undefined, FORMAT));
    } else {
      text = applyEdits(text, modify(text, e.path, e.previous, FORMAT));
    }
  }
  // Drop containers lean-agents created that are now empty.
  const parents = applied.flatMap((e) => e.createdParents ?? []).sort((a, b) => b.length - a.length);
  for (const p of parents) {
    const v = getAt(text, p);
    const empty = Array.isArray(v) ? v.length === 0 : v && typeof v === 'object' && Object.keys(v).length === 0;
    if (empty) text = applyEdits(text, modify(text, p, undefined, FORMAT));
  }
  return text;
}

export function setBlock(original, body) {
  const block = `${BLOCK_START}\n${body.trim()}\n${BLOCK_END}`;
  const text = original ?? '';
  const start = text.indexOf(BLOCK_START);
  const end = text.indexOf(BLOCK_END);
  if (start >= 0 && end > start) {
    return text.slice(0, start) + block + text.slice(end + BLOCK_END.length);
  }
  const sep = text && !text.endsWith('\n\n') ? (text.endsWith('\n') ? '\n' : '\n\n') : '';
  return `${text}${sep}${block}\n`;
}

export function removeBlock(text) {
  const start = text.indexOf(BLOCK_START);
  const end = text.indexOf(BLOCK_END);
  if (start < 0 || end < start) return text;
  return (text.slice(0, start) + text.slice(end + BLOCK_END.length)).replace(/\n{3,}$/, '\n\n').replace(/^\n+$/, '');
}

// Compute what each action would do. Pure apart from reading files.
export function plan(actions) {
  return actions.map((a) => {
    const before = read(a.path);
    let after;
    let note = '';
    let applied;
    if (a.kind === 'file') {
      if (before !== null && before !== a.content && !before.includes(OWNED_MARK) && !a.force) {
        return { ...a, before, after: before, status: 'skip', note: 'exists and is not managed by lean-agents' };
      }
      after = a.content;
    } else if (a.kind === 'json') {
      if (before !== null && parse(before, [], { allowTrailingComma: true }) === undefined) {
        return { ...a, before, after: before, status: 'skip', note: 'could not parse; edit by hand' };
      }
      const absent = (keyPath) => before === null || getAt(before, keyPath) === undefined;
      const edits = a.edits.map((e) => {
        const depth = e.mode === 'arrayAdd' ? e.path.length : e.path.length - 1;
        const createdParents = [];
        for (let k = 1; k <= depth; k++) if (absent(e.path.slice(0, k))) createdParents.push(e.path.slice(0, k));
        return { ...e, previous: before === null ? undefined : getAt(before, e.path), createdParents };
      });
      const r = applyJsonEdits(before, edits);
      after = r.text;
      applied = r.applied;
      if (r.kept.length) note = `kept your values for: ${r.kept.map((k) => k.path.join('.')).join(', ')}`;
    } else if (a.kind === 'block') {
      after = setBlock(before, a.body);
    }
    const status = before === null ? 'create' : before === after ? 'unchanged' : 'modify';
    return { ...a, before, after, applied, status, note };
  });
}

export function describe(planned, home) {
  const rel = (p) => (p.startsWith(home) ? `~${p.slice(home.length)}` : p);
  return planned
    .map((p) => `  ${p.status.padEnd(9)} ${rel(p.path)}${p.note ? `  (${p.note})` : ''}`)
    .join('\n');
}

// Write planned changes. Returns state entries for uninstall.
export function apply(planned, backupDir, home) {
  const entries = [];
  for (const p of planned) {
    if (p.status === 'skip' || p.status === 'unchanged') continue;
    let backup = null;
    if (p.before !== null) {
      const rel = home && p.path.startsWith(home) ? path.relative(home, p.path) : p.path.replace(/^[A-Za-z]:/, '').replace(/^[\\/]+/, '');
      backup = path.join(backupDir, rel);
      fs.mkdirSync(path.dirname(backup), { recursive: true });
      fs.writeFileSync(backup, p.before);
    }
    fs.mkdirSync(path.dirname(p.path), { recursive: true });
    fs.writeFileSync(p.path, p.after);
    entries.push({ path: p.path, kind: p.kind, created: p.before === null, backup, hash: sha(p.after), applied: p.applied });
  }
  return entries;
}

// Undo state entries. If the user edited a file after install, remove only our parts.
export function undo(entries) {
  const report = [];
  for (const e of [...entries].reverse()) {
    const now = read(e.path);
    if (now === null) continue;
    const untouched = sha(now) === e.hash;
    if (untouched && e.created) {
      fs.rmSync(e.path);
      report.push(['removed', e.path]);
    } else if (untouched && e.backup && fs.existsSync(e.backup)) {
      fs.writeFileSync(e.path, fs.readFileSync(e.backup, 'utf8'));
      report.push(['restored', e.path]);
    } else if (e.kind === 'json') {
      fs.writeFileSync(e.path, revertJsonEdits(now, e.applied ?? []));
      report.push(['reverted our keys', e.path]);
    } else if (e.kind === 'block') {
      fs.writeFileSync(e.path, removeBlock(now));
      report.push(['removed our block', e.path]);
    } else {
      report.push(['left (you edited it)', e.path]);
    }
  }
  return report;
}
