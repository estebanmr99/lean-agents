// File operations: plan each change without touching disk, then apply with backups.
// Three action kinds:
//   file  - a whole file lean-agents owns (rules, agent definitions, loaders)
//   json  - edits to a JSON/JSONC file the user owns; comments and formatting survive
//   block - a marked block inside a text file the user owns (CLAUDE.md, AGENTS.md);
//           toml: true uses # markers and puts the block first, so its keys stay top-level
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { parse, modify, applyEdits, findNodeAtLocation, parseTree } from 'jsonc-parser';

export const OWNED_MARK = 'managed by lean-agents';
const BLOCK_START = '<!-- lean-agents:start -->';
const BLOCK_END = '<!-- lean-agents:end -->';
const TOML_START = '# lean-agents:start';
const TOML_END = '# lean-agents:end';
const FORMAT = { formattingOptions: { insertSpaces: true, tabSize: 2, eol: '\n' } };

export const sha = (text) => crypto.createHash('sha256').update(text).digest('hex');
const read = (p) => (fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null);

// The mark counts only in the first lines (a skill's frontmatter pushes it past line 5), so a user file that merely mentions it stays theirs.
const OWNED_LINES = 10;
export const hasMark = (text) => text.split('\n', OWNED_LINES).join('\n').includes(OWNED_MARK);

const realRoots = (roots) => roots.filter(Boolean).map((r) => { try { return fs.realpathSync(r); } catch { return path.resolve(r); } });
const within = (child, root) => { const rel = path.relative(root, child); return !rel.startsWith('..') && !path.isAbsolute(rel); };
const isLink = (p) => { try { return fs.lstatSync(p).isSymbolicLink(); } catch { return false; } };

// Why a target must not be written, or null. A symlinked target or a real parent outside the roots is never touched (edit by hand).
export function unsafe(target, roots) {
  if (isLink(target)) {
    let real = '?';
    try { real = fs.realpathSync(target); } catch { /* dangling link */ }
    return `symlink to ${real}; edit by hand`;
  }
  if (!roots?.length) return null;
  let dir = path.dirname(path.resolve(target));
  for (;;) {
    try { dir = fs.realpathSync(dir); break; } catch { /* not created yet: check the nearest existing parent */ }
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return realRoots(roots).some((r) => within(dir, r)) ? null : 'outside home and project';
}

// Backups can hold secrets from the user's config: owner-only files in owner-only dirs.
export function writePrivate(file, text) {
  fs.writeFileSync(file, text, { mode: 0o600 });
  fs.chmodSync(file, 0o600);
}
export const dropBackups = (dir) => fs.rmSync(dir, { recursive: true, force: true });
export function privateDir(dir, stop) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  for (let d = dir; ; d = path.dirname(d)) {
    fs.chmodSync(d, 0o700);
    if (d === stop || path.dirname(d) === d) break;
  }
}

function getAt(text, keyPath) {
  const tree = parseTree(text);
  if (!tree) return undefined;
  const node = findNodeAtLocation(tree, keyPath);
  return node === undefined ? undefined : parse(text.slice(node.offset, node.offset + node.length));
}

// True when `current` is the old shape in `legacy` (`*` in a string is a wildcard).
function isLegacy(current, legacy = []) {
  const eq = (a, b) => typeof b === 'string' && typeof a === 'string' ? new RegExp(`^${b.split('*').map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`).test(a)
    : a && b && typeof a === 'object' && typeof b === 'object' ? Object.keys(a).length === Object.keys(b).length && Object.keys(b).every((k) => eq(a[k], b[k])) : a === b;
  return legacy.some((l) => eq(current, l));
}

// Package name of an npm plugin spec: 'pkg@1.2.3' and '@scope/pkg@1.2.3' lose the version.
const pkgName = (v) => (typeof v === 'string' ? v.replace(/(?!^)@[^@/]*$/, '') : v);

// Returns { text, applied: [edit], kept: [{path, value}] }.
// `owned`: arrayAdd edits an earlier run recorded in state.json for this file, so a past pin counts as ours.
export function applyJsonEdits(original, edits, owned = []) {
  let text = original && original.trim() ? original : '{}\n';
  const applied = [];
  const kept = [];
  for (const e of edits) {
    const current = getAt(text, e.path);
    if (e.mode === 'arrayAdd') {
      const list = Array.isArray(current) ? current : [];
      if (list.some((v) => JSON.stringify(v) === JSON.stringify(e.value))) continue;
      if (e.legacy) {
        // Pinned plugin spec: an exact legacy value, or a pin we recorded earlier, becomes the pinned one in place; any
        // other entry for the same package is the user's own choice, so it stays and nothing is added.
        const wrote = (v) => owned.some((o) => o.mode === 'arrayAdd' && JSON.stringify(o.path) === JSON.stringify(e.path) && o.value === v && pkgName(v) === pkgName(e.value));
        const old = list.findIndex((v) => e.legacy.includes(v) || wrote(v));
        if (old >= 0) {
          text = applyEdits(text, modify(text, [...e.path, old], e.value, FORMAT));
          applied.push(e);
          continue;
        }
        const own = list.find((v) => pkgName(v) === pkgName(e.value));
        if (own !== undefined) { kept.push({ path: e.path, value: own }); continue; }
      }
      const target = Array.isArray(current) ? [...e.path, -1] : e.path;
      const value = Array.isArray(current) ? e.value : [e.value];
      text = applyEdits(text, modify(text, target, value, { ...FORMAT, isArrayInsertion: true }));
      applied.push(e);
      continue;
    }
    if (current !== undefined) {
      if (JSON.stringify(current) === JSON.stringify(e.value)) continue;
      if (e.mode !== 'set' && !(e.mode === 'upgradeIf' && isLegacy(current, e.legacy))) {
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

export function setBlock(original, body, toml = false) {
  const [open, close] = toml ? [TOML_START, TOML_END] : [BLOCK_START, BLOCK_END];
  const block = `${open}\n${body.trim()}\n${close}`;
  const text = original ?? '';
  const start = text.indexOf(open);
  const end = text.indexOf(close);
  if (start >= 0 && end > start) {
    return text.slice(0, start) + block + text.slice(end + close.length);
  }
  if (toml) return text ? `${block}\n\n${text}` : `${block}\n`;
  const sep = text && !text.endsWith('\n\n') ? (text.endsWith('\n') ? '\n' : '\n\n') : '';
  return `${text}${sep}${block}\n`;
}

export function removeBlock(text) {
  for (const [open, close] of [[BLOCK_START, BLOCK_END], [TOML_START, TOML_END]]) {
    const start = text.indexOf(open);
    const end = text.indexOf(close);
    if (start < 0 || end < start) continue;
    const rest = text.slice(0, start) + text.slice(end + close.length);
    return (start === 0 ? rest.replace(/^\n+/, '') : rest).replace(/\n{3,}$/, '\n\n').replace(/^\n+$/, '');
  }
  return text;
}

// Compute what each action would do. Pure apart from reading files.
// `prior`: the `files` entries of the last state.json, to tell our earlier edits from the user's.
export function plan(actions, roots = [], prior = []) {
  return actions.map((a) => {
    const blocked = unsafe(a.path, roots);
    if (blocked) return { ...a, before: null, after: null, status: 'skip', note: blocked };
    const before = read(a.path);
    let after;
    let note = '';
    let applied;
    let keptKeys;
    if (a.kind === 'file') {
      if (before !== null && before !== a.content && !hasMark(before) && !a.force) {
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
        const previous = before === null ? undefined : getAt(before, e.path);
        // An upgraded legacy entry has no user value to restore: uninstall removes it.
        const upgraded = e.mode === 'upgradeIf' && isLegacy(previous, e.legacy);
        return { ...e, previous: upgraded ? undefined : previous, upgraded, createdParents };
      });
      const owned = prior.filter((f) => f.path === a.path).flatMap((f) => f.applied ?? []);
      const r = applyJsonEdits(before, edits, owned);
      after = r.text;
      applied = r.applied;
      keptKeys = r.kept.map((k) => k.path.join('.'));
      if (r.kept.length) note = `kept your values for: ${r.kept.map((k) => k.path.join('.')).join(', ')}`;
    } else if (a.kind === 'block') {
      after = setBlock(before, a.body, a.toml);
    }
    const status = before === null ? 'create' : before === after ? 'unchanged' : 'modify';
    return { ...a, before, after, applied, status, note, keptKeys };
  });
}

export function describe(planned, home) {
  const rel = (p) => (p === home || p.startsWith(home + path.sep) ? `~${p.slice(home.length)}` : p);
  return planned
    .map((p) => `  ${p.status.padEnd(9)} ${rel(p.path)}${p.note ? `  (${p.note})` : ''}`)
    .join('\n');
}

// Write planned changes. Returns state entries for uninstall.
export function apply(planned, backupDir, home, roots = [home]) {
  const entries = [];
  for (const p of planned) {
    if (p.status === 'skip' || p.status === 'unchanged') continue;
    const blocked = unsafe(p.path, roots);
    if (blocked) throw new Error(`refusing to write ${p.path}: ${blocked}`);
    let backup = null;
    if (p.before !== null) {
      const rel = home && (p.path === home || p.path.startsWith(home + path.sep)) ? path.relative(home, p.path) : p.path.replace(/^[A-Za-z]:/, '').replace(/^[\\/]+/, '');
      backup = path.join(backupDir, rel);
      privateDir(path.dirname(backup), path.dirname(backupDir));
      writePrivate(backup, p.before);
    }
    fs.mkdirSync(path.dirname(p.path), { recursive: true });
    fs.writeFileSync(p.path, p.after);
    entries.push({ path: p.path, kind: p.kind, created: p.before === null, backup, hash: sha(p.after), applied: p.applied, noRestore: p.applied?.some((e) => e.upgraded), keepEmpty: p.keepEmpty });
  }
  return entries;
}

// Undo state entries. If the user edited a file after install, remove only our parts.
export function undo(entries, roots = []) {
  const report = [];
  for (const e of [...entries].reverse()) {
    const blocked = unsafe(e.path, roots);
    if (blocked) { report.push(['left (symlink)', e.path]); continue; }
    const now = read(e.path);
    if (now === null) continue;
    const untouched = sha(now) === e.hash;
    if (untouched && e.created) {
      fs.rmSync(e.path);
      report.push(['removed', e.path]);
    } else if (untouched && e.backup && !e.noRestore && fs.existsSync(e.backup)) {
      fs.writeFileSync(e.path, fs.readFileSync(e.backup, 'utf8'));
      report.push(['restored', e.path]);
    } else if (e.kind === 'json') {
      let text = revertJsonEdits(now, e.applied ?? []);
      const left = parse(text, [], { allowTrailingComma: true });
      if (e.created && left && typeof left === 'object' && !Object.keys(left).length) {
        fs.rmSync(e.path);
        report.push(['removed', e.path]);
        continue;
      }
      // A tool that rejects a file without its container key (Copilot: "mcpServers: Required") keeps it empty.
      for (const key of e.keepEmpty ?? []) if (getAt(text, key) === undefined) text = applyEdits(text, modify(text, key, {}, FORMAT));
      fs.writeFileSync(e.path, text);
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
