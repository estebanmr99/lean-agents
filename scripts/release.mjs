#!/usr/bin/env node
// Builds dist/notes.md and the source archives for a release. Used by release.yml and CI.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

export function releaseNotes(changelog, version) {
  const lines = changelog.split('\n');
  const start = lines.findIndex((l) => l.startsWith(`## [${version}]`));
  if (start < 0) return '';
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => l.startsWith('## ['));
  return rest.slice(0, end < 0 ? undefined : end).join('\n').trim();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const version = process.argv[2];
  const current = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
  if (version !== current) throw new Error(`version ${version} does not match package.json ${current}`);
  const notes = releaseNotes(fs.readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8'), version);
  if (!notes) throw new Error(`CHANGELOG.md has no notes for ${version}`);
  const dist = path.join(ROOT, 'dist');
  fs.mkdirSync(dist, { recursive: true });
  fs.writeFileSync(path.join(dist, 'notes.md'), `${notes}\n`);
  const name = `lean-agents-${version}`;
  for (const ext of ['tar.gz', 'zip']) {
    execFileSync('git', ['archive', '--format', ext, '--prefix', `${name}/`, '-o', path.join(dist, `${name}.${ext}`), 'HEAD'], { cwd: ROOT });
  }
  console.log(`dist: notes.md, ${name}.tar.gz, ${name}.zip`);
}
