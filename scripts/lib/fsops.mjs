// File operations: plan each change without touching disk, then apply with backups.
// Three action kinds:
//   file  - a whole file lean-agents owns (rules, agent definitions, loaders)
//   json  - edits to a JSON/JSONC file the user owns; comments and formatting survive
//   block - a marked block inside a text file the user owns (CLAUDE.md, AGENTS.md);
//           toml: true uses # markers and puts the block first, so its keys stay top-level;
//           id: '<name>' uses # markers named by id (shell rc files: several blocks per file, and HTML markers break the shell)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { parse, modify, applyEdits, findNodeAtLocation, parseTree } from 'jsonc-parser';

// Rename that waits out a file another process holds for a moment (Windows antivirus or indexer: EBUSY, EPERM, EACCES on a file
// just written). Retries `tries` times, `ms` apart; if it still fails, the error says so and keeps its code.
const waitMs = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
export function renameRetry(from, to, { rename = fs.renameSync, sleep = waitMs, tries = 8, ms = 250 } = {}) {
  for (let i = 1; ; i++) {
    try { return rename(from, to); } catch (e) {
      if (!['EBUSY', 'EPERM', 'EACCES'].includes(e.code)) throw e;
      if (i >= tries) throw Object.assign(new Error(`${e.message} (still locked after ${tries} tries over ${Math.round(((tries - 1) * ms) / 1000)} s: another program holds it; close it and try again)`), { code: e.code });
      sleep(ms);
    }
  }
}

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

// True when `current` is the old shape in `legacy` (`*` in a string is a wildcard, `{semver}` is digits.digits.digits).
function isLegacy(current, legacy = []) {
  const eq = (a, b) => typeof b === 'string' && typeof a === 'string' ? new RegExp(`^${b.split('*').map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*').replace(/\\\{semver\\\}/g, '\\d+\\.\\d+\\.\\d+')}$`).test(a)
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
          // `replaced`: the user's own legacy entry, so --uninstall can put it back; over an earlier pin of ours (a pin bump) it carries that pin's.
          const earlier = owned.find((o) => o.mode === 'arrayAdd' && JSON.stringify(o.path) === JSON.stringify(e.path) && o.value === list[old]);
          const replaced = !e.restore ? undefined : wrote(list[old]) ? earlier?.replaced : e.legacy.includes(list[old]) ? list[old] : undefined;
          text = applyEdits(text, modify(text, [...e.path, old], e.value, FORMAT));
          applied.push(replaced === undefined ? e : { ...e, replaced });
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
    if (e.mode === 'remove') {
      // Drops the key; `previous` (recorded by plan) lets undo write it back.
      if (current === undefined) continue;
      text = applyEdits(text, modify(text, e.path, undefined, FORMAT));
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
      if (i >= 0) text = applyEdits(text, modify(text, [...e.path, i], e.replaced, FORMAT));
    } else if (e.keepIfChanged && JSON.stringify(getAt(text, e.path)) !== JSON.stringify(e.value)) {
      // The user changed our value after install: it is theirs now.
      continue;
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

// Hash of a JSON file without the key paths lean-agents' own commands write (plugin installs, rtk hooks), so the doctor
// tells the user's edits from ours even when the stored whole-file hash predates those commands (#492).
// Each ignore entry is `{ path, value }` or `{ path, repo }`: the key is dropped only while its value still matches.
export function userHash(text, ignore = []) {
  const data = parse(text, [], { allowTrailingComma: true });
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  for (const entry of ignore) {
    const keyPath = entry.path;
    let o = data;
    for (const k of keyPath.slice(0, -1)) o = o && typeof o === 'object' ? o[k] : undefined;
    if (!o || typeof o !== 'object' || !keyPath.length) continue;
    const value = o[keyPath.at(-1)];
    const src = value && typeof value === 'object' ? value.source : undefined;
    const match = entry.repo !== undefined ? src && (src.repo === entry.repo || src.url === entry.repo) : value === entry.value;
    if (match) delete o[keyPath.at(-1)];
  }
  return sha(JSON.stringify(data));
}

const samePath = (a, b) => a.length === b.length && a.every((k, i) => k === b[i]);
const underPath = (path, parent) => path.length > parent.length && parent.every((k, i) => k === path[i]);

function pruneToManaged(node, prefix, ignore, managed) {
  if (!node || typeof node !== 'object' || Array.isArray(node)) return node;
  const out = {};
  for (const [k, v] of Object.entries(node)) {
    const keyPath = [...prefix, k];
    if (ignore.some((p) => samePath(p, keyPath))) continue;
    if (managed.some((p) => samePath(p, keyPath))) out[k] = v;
    else if (managed.some((p) => underPath(p, keyPath))) out[k] = pruneToManaged(v, keyPath, ignore, managed);
    else if (ignore.some((p) => underPath(p, keyPath))) out[k] = pruneToManaged(v, keyPath, ignore, managed);
  }
  return out;
}

// Hash of what lean-agents itself manages in a planned JSON file: every managed key, with all ignored command-written
// keys removed (whatever their value). A user key outside `managed`, or an ignored key with another value, changes this
// hash, so --update never blesses it (#492).
export function managedUserHash(text, ignore = [], managed = []) {
  const data = parse(text, [], { allowTrailingComma: true });
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  return sha(JSON.stringify(pruneToManaged(data, [], ignore.map((e) => e.path), managed)));
}

const idMarks = (id) => [`# lean-agents:${id}:start`, `# lean-agents:${id}:end`];

export function setBlock(original, body, toml = false, id = undefined) {
  const [open, close] = id ? idMarks(id) : toml ? [TOML_START, TOML_END] : [BLOCK_START, BLOCK_END];
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

export function removeBlock(text, id = undefined) {
  for (const [open, close] of id ? [idMarks(id)] : [[BLOCK_START, BLOCK_END], [TOML_START, TOML_END]]) {
    const start = text.indexOf(open);
    const end = text.indexOf(close);
    if (start < 0 || end < start) continue;
    const head = text.slice(0, start);
    const tail = text.slice(end + close.length).replace(/^\n+/, '');
    // A block between two others leaves one blank line, not the separators of both.
    const rest = tail ? head.replace(/\n*$/, head ? '\n\n' : '') + tail : head;
    return rest.replace(/\n{3,}$/, '\n\n').replace(/^\n+$/, '');
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
      const moved = r.applied.filter((e) => e.mode === 'arrayAdd' && /@\d+\.\d+\.\d+$/.test(e.replaced ?? '')).map((e) => `${path.basename(a.path)} ${e.label ?? 'pin'} ${e.replaced.replace(/^.*@/, '')} -> ${e.value.replace(/^.*@/, '')}${e.why ? ` ${e.why}` : ''}`);
      if (moved.length) note = moved.join('; ');
      if (r.kept.length) note = `kept your values for: ${r.kept.map((k) => k.path.join('.')).join(', ')}`;
    } else if (a.kind === 'block') {
      after = setBlock(before, a.body, a.toml, a.id);
    }
    const status = before === null ? 'create' : before === after ? 'unchanged' : 'modify';
    // A file lean-agents created and nobody edited since holds nothing of the user's: a rerun needs no backup of it.
    const mine = prior.filter((f) => f.path === a.path);
    const noBackup = before !== null && mine.some((f) => f.created) && sha(before) === mine.at(-1).hash;
    return { ...a, before, after, applied, status, note, keptKeys, noBackup, ...(a.ignore?.length && { userHash: userHash(after, a.ignore) }) };
  });
}

// Home as `~` inside free text: only a whole folder (home + a separator), never an empty home or `/`.
// One path under home as ~: case-insensitive on Windows (a path built with `c:` while home is `C:\...`, #493), and only at a
// path boundary, so /home/u2 is not shortened against /home/u.
export function homeRel(p, home, platform = process.platform) {
  if (!p || !home) return p;
  if (home.length > 1) home = home.replace(/[\\/]+$/, '');
  const win = platform === 'win32';
  const head = p.slice(0, home.length);
  const rest = p.slice(home.length);
  return (win ? head.toLowerCase() === home.toLowerCase() : head === home) && (!rest || /^[\\/]/.test(rest)) ? `~${rest}` : p;
}

export function tilde(text, home, platform = process.platform) {
  if (!home || home === '/' || home === path.sep) return text;
  let out = text;
  const esc = (h) => h.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Windows: any letter case (#493). Only at the start of a path: /opt/x/home/me is not /home/me (#506);
  // a home after `//` (file:///opt/me/x) still counts, so a file URL cannot leak it.
  for (const h of new Set([home, home.replace(/\\/g, '/')])) out = out.replace(new RegExp(`(?:(?<=//)|(?<![\\\\/\\w.-]))${esc(h)}(?=[\\\\/])`, platform === 'win32' ? 'gi' : 'g'), '~');
  return out;
}

// `brief`: unchanged files are counted on one line instead of listed (#491).
export function describe(planned, home, brief = false, platform = process.platform) {
  const rel = (p) => homeRel(p, home, platform);
  const same = brief ? planned.filter((p) => p.status === 'unchanged').length : 0;
  return [...planned
    .filter((p) => !(brief && p.status === 'unchanged'))
    .map((p) => `  ${p.status.padEnd(9)} ${rel(p.path)}${p.note ? `  (${p.note})` : ''}`)
    , ...(same ? [`  ${same} unchanged`] : [])]
    .join('\n');
}

// Write planned changes. Returns state entries for uninstall; a caller that passes `entries` keeps what was written if a later write throws.
export function apply(planned, backupDir, home, roots = [home], entries = []) {
  for (const p of planned) {
    if (p.status === 'skip' || p.status === 'unchanged') continue;
    const blocked = unsafe(p.path, roots);
    if (blocked) throw new Error(`refusing to write ${p.path}: ${blocked}`);
    let backup = null;
    if (p.before !== null && !p.noBackup) {
      const rel = home && (p.path === home || p.path.startsWith(home + path.sep)) ? path.relative(home, p.path) : p.path.replace(/^[A-Za-z]:/, '').replace(/^[\\/]+/, '');
      backup = path.join(backupDir, rel);
      privateDir(path.dirname(backup), path.dirname(backupDir));
      writePrivate(backup, p.before);
    }
    // The folders this write creates, deepest first: undo removes them again once they are empty (#223).
    const dirs = [];
    for (let d = path.dirname(p.path); !fs.existsSync(d); d = path.dirname(d)) dirs.push(d);
    fs.mkdirSync(path.dirname(p.path), { recursive: true });
    entries.push({ path: p.path, kind: p.kind, created: p.before === null, backup, hash: sha(p.after), applied: p.applied, noRestore: p.applied?.some((e) => e.upgraded), keepEmpty: p.keepEmpty, ...(p.userHash && { userHash: p.userHash, ignore: p.ignore }), ...(p.id && { id: p.id }), ...(dirs.length && { dirs }) });
    fs.writeFileSync(p.path, p.after);
  }
  return entries;
}

// Only empty folders: a file the user added since keeps its folder.
function removeEmptyDirs(dirs = []) {
  for (const d of dirs) try { fs.rmdirSync(d); } catch { return; }
}

// Undo state entries. If the user edited a file after install, remove only our parts.
export function undo(entries, roots = []) {
  const report = [];
  for (const e of [...entries].reverse()) {
    const blocked = unsafe(e.path, roots);
    if (blocked) { report.push(['left (symlink)', e.path]); continue; }
    const now = read(e.path);
    if (now === null) { removeEmptyDirs(e.dirs); continue; }
    const untouched = sha(now) === e.hash;
    if (untouched && e.created) {
      fs.rmSync(e.path);
      report.push(['removed', e.path]);
      removeEmptyDirs(e.dirs);
    } else if (untouched && e.backup && !e.noRestore && fs.existsSync(e.backup)) {
      fs.writeFileSync(e.path, fs.readFileSync(e.backup, 'utf8'));
      report.push(['restored', e.path]);
    } else if (e.kind === 'json') {
      let text = revertJsonEdits(now, e.applied ?? []);
      const left = parse(text, [], { allowTrailingComma: true });
      if (e.created && left && typeof left === 'object' && !Object.keys(left).length) {
        fs.rmSync(e.path);
        report.push(['removed', e.path]);
        removeEmptyDirs(e.dirs);
        continue;
      }
      // A tool that rejects a file without its container key (Copilot: "mcpServers: Required") keeps it empty.
      for (const key of e.keepEmpty ?? []) if (getAt(text, key) === undefined) text = applyEdits(text, modify(text, key, {}, FORMAT));
      fs.writeFileSync(e.path, text);
      report.push(['reverted our keys', e.path]);
    } else if (e.kind === 'block') {
      fs.writeFileSync(e.path, removeBlock(now, e.id));
      report.push(['removed our block', e.path]);
    } else {
      report.push(['left (you edited it)', e.path]);
    }
  }
  return report;
}
