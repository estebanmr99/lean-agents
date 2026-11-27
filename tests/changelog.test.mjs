// Changelog fragments: folding changes/*.md into CHANGELOG.md, all on a temp copy.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { foldFragments } from '../scripts/changelog.mjs';
import { releaseNotes } from '../scripts/release.mjs';

const SCRIPT = fileURLToPath(new URL('../scripts/changelog.mjs', import.meta.url));

const BASE = [
  '# Changelog',
  '',
  '## [Unreleased]',
  '',
  '## [1.2.4] - 2026-11-27',
  '',
  '### Added',
  '- old entry (#1)',
  '',
].join('\n');

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lean-changelog-'));
  const changelog = path.join(dir, 'CHANGELOG.md');
  const changes = path.join(dir, 'changes');
  fs.writeFileSync(changelog, BASE);
  fs.mkdirSync(changes);
  fs.writeFileSync(path.join(changes, 'README.md'), '# Fragments\n');
  return { dir, changelog, changes };
}

const run = (f, version = '1.2.5', date = '2026-11-28') =>
  foldFragments({ version, changelogPath: f.changelog, changesDir: f.changes, date });

test('folds fragments from two sections into one dated block below Unreleased', (t) => {
  const f = fixture();
  t.after(() => fs.rmSync(f.dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(f.changes, '501.md'), '### Fixed\n- fixed one (#501)\n');
  fs.writeFileSync(path.join(f.changes, '502.md'), '### Added\n- added one (#502)\n- added two (#502)\n');

  const first = run(f);
  assert.equal(first.changed, true);
  const text = fs.readFileSync(f.changelog, 'utf8');
  assert.equal(text, [
    '# Changelog',
    '',
    '## [Unreleased]',
    '',
    '## [1.2.5] - 2026-11-28',
    '',
    '### Added',
    '- added one (#502)',
    '- added two (#502)',
    '',
    '### Fixed',
    '- fixed one (#501)',
    '',
    '## [1.2.4] - 2026-11-27',
    '',
    '### Added',
    '- old entry (#1)',
    '',
  ].join('\n'));
  assert.equal(releaseNotes(text, '1.2.5'), [
    '### Added',
    '- added one (#502)',
    '- added two (#502)',
    '',
    '### Fixed',
    '- fixed one (#501)',
  ].join('\n'));
});

test('deletes the fragments and keeps changes/README.md', (t) => {
  const f = fixture();
  t.after(() => fs.rmSync(f.dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(f.changes, '501.md'), '### Fixed\n- fixed one (#501)\n');
  fs.writeFileSync(path.join(f.changes, '516.md'), '### Added\n- added one (#516)\n');

  run(f);
  assert.deepEqual(fs.readdirSync(f.changes), ['README.md']);
});

test('a second run is a no-op', (t) => {
  const f = fixture();
  t.after(() => fs.rmSync(f.dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(f.changes, '501.md'), '### Fixed\n- fixed one (#501)\n');
  run(f);
  const after = fs.readFileSync(f.changelog, 'utf8');

  assert.equal(run(f).changed, false);
  assert.equal(fs.readFileSync(f.changelog, 'utf8'), after);
});

test('an empty changes/ fails with a clear error and a nonzero exit', (t) => {
  const f = fixture();
  t.after(() => fs.rmSync(f.dir, { recursive: true, force: true }));

  assert.throws(() => run(f), /no fragments/i);
  assert.equal(fs.readFileSync(f.changelog, 'utf8'), BASE);

  const cli = spawnSync(process.execPath, [SCRIPT, '1.2.5', '--changelog', f.changelog, '--changes', f.changes], { encoding: 'utf8' });
  assert.notEqual(cli.status, 0);
  assert.match(cli.stderr, /no fragments/i);
});

test('rejects an unknown section instead of writing it', (t) => {
  const f = fixture();
  t.after(() => fs.rmSync(f.dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(f.changes, '501.md'), '### Nonsense\n- nope (#501)\n');

  assert.throws(() => run(f), /501\.md.*section/i);
  assert.equal(fs.readFileSync(f.changelog, 'utf8'), BASE);
});

test('folds a CRLF fragment', (t) => {
  const f = fixture();
  t.after(() => fs.rmSync(f.dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(f.changes, '501.md'), '### Fixed\r\n- fixed one (#501)\r\n- fixed two (#501)\r\n');

  run(f);
  const text = fs.readFileSync(f.changelog, 'utf8');
  assert.deepEqual(text.split('\n').filter((l) => l.startsWith('- fixed')), ['- fixed one (#501)', '- fixed two (#501)']);
  assert.doesNotMatch(text, /\r/);
});

test('folds a fragment without a trailing newline', (t) => {
  const f = fixture();
  t.after(() => fs.rmSync(f.dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(f.changes, '501.md'), '### Fixed\n- fixed one (#501)');

  run(f);
  assert.equal(releaseNotes(fs.readFileSync(f.changelog, 'utf8'), '1.2.5'), '### Fixed\n- fixed one (#501)');
});

test('refuses non-blank lines left under Unreleased and changes nothing', (t) => {
  const f = fixture();
  t.after(() => fs.rmSync(f.dir, { recursive: true, force: true }));
  const stray = BASE.replace('## [Unreleased]\n\n', '## [Unreleased]\n### Added\n- old (#0)\n\n');
  fs.writeFileSync(f.changelog, stray);
  fs.writeFileSync(path.join(f.changes, '501.md'), '### Fixed\n- fixed one (#501)\n');

  assert.throws(() => run(f), /move these lines into changes\/<issue>\.md/i);
  assert.equal(fs.readFileSync(f.changelog, 'utf8'), stray);
  assert.deepEqual(fs.readdirSync(f.changes).sort(), ['501.md', 'README.md']);

  const cli = spawnSync(process.execPath, [SCRIPT, '1.2.5', '--changelog', f.changelog, '--changes', f.changes], { encoding: 'utf8' });
  assert.notEqual(cli.status, 0);
  assert.match(cli.stderr, /move these lines into changes\/<issue>\.md/i);
});

test('rejects a malformed version', (t) => {
  const f = fixture();
  t.after(() => fs.rmSync(f.dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(f.changes, '501.md'), '### Fixed\n- fixed one (#501)\n');

  assert.throws(() => run(f, '1.2'), /version/i);
  assert.equal(fs.readFileSync(f.changelog, 'utf8'), BASE);
  assert.equal(fs.readdirSync(f.changes).includes('501.md'), true);

  const cli = spawnSync(process.execPath, [SCRIPT, 'v1.2.5', '--changelog', f.changelog, '--changes', f.changes], { encoding: 'utf8' });
  assert.notEqual(cli.status, 0);
  assert.match(cli.stderr, /version/i);
});

test('rejects a symlinked fragment', (t) => {
  const f = fixture();
  t.after(() => fs.rmSync(f.dir, { recursive: true, force: true }));
  const target = path.join(f.dir, 'real.md');
  fs.writeFileSync(target, '### Fixed\n- fixed one (#501)\n');
  try {
    fs.symlinkSync(target, path.join(f.changes, '501.md'));
  } catch (error) {
    if (process.platform === 'win32') {
      t.skip('symlink creation needs Developer Mode or admin on Windows');
      return;
    }
    throw error;
  }

  assert.throws(() => run(f), /501\.md.*symlink/i);
  assert.equal(fs.readFileSync(f.changelog, 'utf8'), BASE);
  assert.equal(fs.readFileSync(target, 'utf8'), '### Fixed\n- fixed one (#501)\n');
});