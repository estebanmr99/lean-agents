#!/usr/bin/env node
// Builds dist/notes.md, the source archives, the npm tarball and SHA256SUMS for a release. Used by release.yml and CI.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
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

// Needs `npm ci --omit=dev` first: the tarball bundles node_modules.
export function packDist(dist, version) {
  const name = `lean-agents-${version}`;
  execFileSync('npm', ['pack', '--pack-destination', dist, '--silent'], { cwd: ROOT });
  for (const f of ['install.sh', 'install.ps1']) fs.copyFileSync(path.join(ROOT, f), path.join(dist, f));
  const files = [`${name}.tgz`, `${name}.tar.gz`, `${name}.zip`, 'install.sh', 'install.ps1'];
  const sums = files.map((f) => `${crypto.createHash('sha256').update(fs.readFileSync(path.join(dist, f))).digest('hex')}  ${f}\n`);
  fs.writeFileSync(path.join(dist, 'SHA256SUMS'), sums.join(''));
  return files;
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
  const packed = packDist(dist, version);
  console.log(`dist: notes.md, SHA256SUMS, ${packed.join(', ')}`);
}
