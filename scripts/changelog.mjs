#!/usr/bin/env node
// Folds changes/<issue>.md fragments into CHANGELOG.md as one released section. Format: changes/README.md.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

// The section names CHANGELOG.md already uses, in the order a release lists them.
export const SECTIONS = ['Added', 'Changed', 'Docs', 'Fixed', 'Security'];

function parseFragment(file) {
  const groups = new Map();
  let section = null;
  let bullets = 0;
  fs.readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
    if (!line.trim()) return;
    const heading = /^### (.+)$/.exec(line);
    if (heading) {
      const name = heading[1].trim();
      if (!SECTIONS.includes(name)) throw new Error(`${file}:${i + 1}: unknown section "${name}" (allowed: ${SECTIONS.join(', ')})`);
      section = name;
      return;
    }
    if (!line.startsWith('- ')) throw new Error(`${file}:${i + 1}: expected a bullet ("- ...") or a section heading`);
    if (!section) throw new Error(`${file}:${i + 1}: bullet before any section heading`);
    if (!groups.has(section)) groups.set(section, []);
    groups.get(section).push(line);
    bullets += 1;
  });
  if (!bullets) throw new Error(`${file}: no bullets`);
  return groups;
}

// Reads the fragments, inserts the release block below ## [Unreleased], then deletes the fragments.
// A run with no fragments and the version already in CHANGELOG.md is a no-op.
export function foldFragments({ version, changelogPath, changesDir, date = new Date().toISOString().slice(0, 10) }) {
  const changelog = fs.readFileSync(changelogPath, 'utf8');
  const hasVersion = changelog.split('\n').some((l) => l.startsWith(`## [${version}]`));
  const fragments = fs.readdirSync(changesDir).filter((f) => f.endsWith('.md') && f !== 'README.md').sort();

  if (!fragments.length) {
    if (hasVersion) return { changed: false };
    throw new Error(`no fragments in ${changesDir} (add changes/<issue>.md first)`);
  }
  if (hasVersion) throw new Error(`CHANGELOG.md already has ## [${version}]; fragments left in ${changesDir}`);

  const groups = new Map();
  for (const name of fragments) {
    for (const [section, bullets] of parseFragment(path.join(changesDir, name))) {
      groups.set(section, (groups.get(section) ?? []).concat(bullets));
    }
  }

  const block = [`## [${version}] - ${date}`, ''];
  for (const section of SECTIONS) {
    if (!groups.has(section)) continue;
    block.push(`### ${section}`, ...groups.get(section), '');
  }
  block.pop();

  const lines = changelog.split('\n');
  const unreleased = lines.findIndex((l) => l.startsWith('## [Unreleased]'));
  if (unreleased < 0) throw new Error('CHANGELOG.md has no ## [Unreleased] heading');
  let next = unreleased + 1;
  while (next < lines.length && lines[next] === '') next += 1;

  const out = [...lines.slice(0, unreleased + 1), '', ...block, '', ...lines.slice(next)].join('\n');
  fs.writeFileSync(changelogPath, out);
  for (const name of fragments) fs.rmSync(path.join(changesDir, name));
  return { changed: true };
}

function main(argv) {
  const [version, ...rest] = argv;
  if (!version) throw new Error('usage: node scripts/changelog.mjs <version>');
  let changelogPath = path.join(ROOT, 'CHANGELOG.md');
  let changesDir = path.join(ROOT, 'changes');
  for (let i = 0; i < rest.length; i += 2) {
    if (rest[i] === '--changelog') changelogPath = rest[i + 1];
    else if (rest[i] === '--changes') changesDir = rest[i + 1];
    else throw new Error(`unknown argument ${rest[i]}`);
  }
  const { changed } = foldFragments({ version, changelogPath, changesDir });
  console.log(changed ? `changelog: folded fragments into ## [${version}]` : `changelog: ## [${version}] already present, nothing to do`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(`changelog: ${error.message}`);
    process.exit(1);
  }
}