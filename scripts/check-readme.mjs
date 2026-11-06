#!/usr/bin/env node
// Checks the READMEs: links and anchors resolve, the part before Details fits the 1-minute budget,
// images have alt text and stay small, EN and ES share one structure, and every installer command
// shown exits 0 as a dry run in a temp HOME. Used by tests/readme.test.mjs, the lint job and the release.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
export const READMES = ['README.md', 'README.es.md'];
export const DETAILS_MARK = '<!-- details -->';
export const HERO_BUDGET = 80;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const stripFences = (md) => md.replace(/^\s*```[\s\S]*?^\s*```/gm, '');

// GitHub heading slug: lowercase, drop punctuation, spaces to hyphens.
export const slug = (h) => h.toLowerCase().replace(/[`*]/g, '').replace(/[^\p{L}\p{N} _-]/gu, '').replace(/ /g, '-');

export function headings(md) {
  return [...stripFences(md).matchAll(/^(#{1,6}) +(.+)$/gm)].map((m) => ({ level: m[1].length, text: m[2].trim() }));
}

// Broken relative links, images and anchors, as readable strings.
export function brokenLinks(file) {
  const md = read(file);
  const own = new Set(headings(md).map((h) => slug(h.text)));
  const bad = [];
  const refs = [...md.matchAll(/\]\(([^)\s]+)\)/g)].map((m) => m[1]).concat([...md.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1]));
  for (const ref of refs) {
    if (/^(https?:|mailto:)/.test(ref)) continue;
    const [target, anchor] = ref.split('#');
    const dest = target ? path.join(ROOT, path.dirname(file), target) : path.join(ROOT, file);
    if (!fs.existsSync(dest)) { bad.push(`${file}: missing ${ref}`); continue; }
    if (anchor && dest.endsWith('.md')) {
      const known = dest === path.join(ROOT, file) ? own : new Set(headings(fs.readFileSync(dest, 'utf8')).map((h) => slug(h.text)));
      if (!known.has(anchor)) bad.push(`${file}: no anchor ${ref}`);
    }
  }
  return bad;
}

// Every <img> and ![alt](src) in the text.
const images = (md) => [
  ...[...md.matchAll(/<img\b[^>]*>/g)].map((m) => ({ src: m[0].match(/\bsrc="([^"]*)"/)?.[1], alt: m[0].match(/\balt="([^"]*)"/)?.[1] })),
  ...[...md.matchAll(/!\[([^\]]*)\]\(([^)\s]+)/g)].map((m) => ({ src: m[2], alt: m[1] })),
];

// Lines before the Details divider must fit the budget, so the first screen stays a 1-minute read.
export function heroProblems(md, file) {
  const at = md.split('\n').findIndex((l) => l.trim() === DETAILS_MARK);
  if (at < 0) return [`${file}: no ${DETAILS_MARK} divider`];
  return at > HERO_BUDGET ? [`${file}: ${at} lines before Details, the budget is ${HERO_BUDGET}`] : [];
}

// Images need alt text and a local file of at most 5 MB (a missing file is reported by brokenLinks).
export function imageProblems(md, file, dir = path.join(ROOT, path.dirname(file))) {
  const bad = [];
  for (const { src, alt } of images(md)) {
    if (!alt?.trim()) bad.push(`${file}: image without alt text ${src}`);
    if (!src || /^(https?:|data:)/.test(src)) continue;
    const dest = path.join(dir, src);
    if (fs.existsSync(dest) && fs.statSync(dest).size > MAX_IMAGE_BYTES) bad.push(`${file}: image over 5 MB ${src}`);
  }
  return bad;
}

// Shape that EN and ES must share: heading levels, rows and columns per table, fenced blocks.
export function shape(file) {
  const md = read(file);
  const tables = [...md.matchAll(/(?:^\|.*\|\n?)+/gm)].map((m) => {
    const rows = m[0].trim().split('\n');
    return `${rows.length}x${rows[0].split('|').length - 2}`;
  });
  return {
    headings: headings(md).map((h) => h.level).join(''),
    tables: tables.join(','),
    fences: [...md.matchAll(/^\s*```(\w*)/gm)].map((m) => m[1]).join(','),
    images: images(md).length,
    details: (md.match(/<details>/g) || []).length,
    links: (md.match(/\]\(/g) || []).length,
    bullets: (md.match(/^\s*[-*] /gm) || []).length,
  };
}

const kebab = (s) => s.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();

// Engine argument lists for every `install.sh | bash -s --` and install.ps1 command in the text.
export function installerArgs(file) {
  const out = [];
  for (const raw of read(file).split('\n')) {
    const line = raw.replace(/\s+#.*$/, '');
    const sh = line.match(/install\.sh \| bash -s -- (.+?)`?$/);
    const ps = line.match(/install\.ps1\)\)\) ?([^`]*)`?/);
    if (sh) out.push(sh[1].trim().split(/\s+/));
    else if (ps) out.push(ps[1].trim().split(/\s+/).filter(Boolean).map((a) => (/^-[A-Z]/.test(a) ? `--${kebab(a.slice(1))}` : a)));
  }
  return out;
}

// Runs one command as a dry run in a temp HOME; returns the exit status.
export function dryRun(args) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lean-readme-'));
  const home = path.join(tmp, 'home');
  fs.mkdirSync(home);
  const a = args.map((x) => (x === '.' ? tmp : x));
  const lean = (...rest) => spawnSync(process.execPath, [path.join(ROOT, 'scripts/lean.mjs'), '--home', home, '--no-exec', '--yes', ...rest], { cwd: tmp, encoding: 'utf8', timeout: 60000 });
  // --doctor exits 1 on a HOME with nothing installed, so give it a no-exec install to check.
  if (a.includes('--doctor')) lean();
  let r;
  try { r = lean('--dry-run', ...a); } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  return { status: r.status, stderr: r.stderr.trim().split('\n').slice(-2).join(' ') };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  let failed = 0;
  for (const f of READMES) {
    for (const b of [...brokenLinks(f), ...heroProblems(read(f), f), ...imageProblems(read(f), f)]) { console.log(b); failed++; }
    for (const args of installerArgs(f)) {
      const r = dryRun(args);
      if (r.status !== 0) { console.log(`${f}: exit ${r.status} for ${args.join(' ')} ${r.stderr}`); failed++; }
    }
  }
  const [en, es] = READMES.map(shape);
  for (const k of Object.keys(en)) if (en[k] !== es[k]) { console.log(`EN/ES differ in ${k}: ${en[k]} vs ${es[k]}`); failed++; }
  console.log(failed ? `${failed} problem(s)` : 'README checks passed');
  process.exit(failed ? 1 : 0);
}
