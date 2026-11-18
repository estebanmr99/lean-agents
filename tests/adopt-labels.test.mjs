// Pure helpers behind the --adopt Cursor hook names and the sqlite note (#213). No filesystem, so every OS runs them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { cmpVersion, cursorHookLabel, cursorEncoded, cursorNameManaged, sqliteOk, countInChild } from '../scripts/lib/adopt.mjs';
import { formatUpgrade } from '../scripts/lib/upgrade.mjs';

const argvOf = (c) => c.match(/"[^"]*"|'[^']*'|\S+/g).map((a) => a.replace(/^(["'])(.*)\1$/, '$2'));
const label = (c) => cursorHookLabel(c, argvOf(c));
const managed = (c) => cursorNameManaged(c, argvOf(c));

test('label: Windows backslash and posix paths give the bare file name', () => {
  assert.equal(label('"D:\\tools\\hooks\\run.exe" --x'), 'run.exe');
  assert.equal(label('D:/tools/hooks/run.exe'), 'run.exe');
  assert.equal(label('/home/u/hooks/run.sh'), 'run.sh');
  assert.equal(label('$(for n in a b; do echo $n; done) D:\\tools\\gsd-cursor-x.js'), 'gsd-cursor-x.js');
  assert.equal(label('sh -c "echo hi"'), 'shell');
});

test('managed: only the program name and the script label count, not the whole command', () => {
  assert.equal(managed('node /home/u/rtk-fork/hook.js'), false);
  assert.equal(managed('rtk hook cursor'), true);
  assert.equal(managed('C:\\Tools\\rtk.exe hook cursor'), true);
  assert.equal(managed('$(for n in a b; do echo $n; done) /home/u/gsd-cursor-x.js'), true);
});

test('encoded: -e, -ec and -enc* match, --encoding does not', () => {
  for (const c of ['powershell -e AAAA', 'powershell -ec AAAA', 'powershell -EncodedCommand AAAA', 'powershell -enc AAAA', 'pwsh.exe -NoProfile -e AAAA']) assert.equal(cursorEncoded(c), true, c);
  for (const c of ['node hook.js --encoding utf8', 'node hook.js -x', 'node hook.js -echo', 'node -e 1', '$(node -e 1) d-demo.ps1']) assert.equal(cursorEncoded(c), false, c);
});

test('sqliteOk: 22.13+, 23.4+ and 24+ only', () => {
  for (const v of ['22.13.0', '23.4.0', '23.11.1', '24.0.0']) assert.equal(sqliteOk(v), true, v);
  for (const v of ['22.12.9', '23.3.0', '20.19.0']) assert.equal(sqliteOk(v), false, v);
});

test('countInChild: the note labels name the Node version, never a path', () => {
  const c = countInChild('/nonexistent/synthetic.db', null);
  assert.deepEqual(c.tried, [`Node ${process.version} --experimental-sqlite`]);
});

test('upgrade text row: (file) only when set', () => {
  const item = (file) => ({ file, upgrade: { class: 'managed', before: 'a', after: 'b' } });
  const r = (file) => formatUpgrade({ upgrade: { binary: {}, layout: {}, counts: { managed: 1, 'user-translatable': 0, 'user-manual': 0 } }, items: [item(file)] });
  assert.match(r('x.json'), /a -> b {2}\(x\.json\)/);
  assert.doesNotMatch(r(undefined), /undefined/);
  assert.doesNotMatch(r(''), /\(\)/);
});

test('cmpVersion: build metadata is ignored, a pre-release still sorts below its release (#219)', () => {
  assert.ok(cmpVersion('2.1.7+build', '2.1.6') > 0); // newer
  assert.ok(cmpVersion('2.1.5+b', '2.1.7') < 0); // drift
  assert.equal(cmpVersion('2.1.7+build', '2.1.7'), 0);
  assert.ok(cmpVersion('2.1.7-beta.1+b', '2.1.7') < 0);
});
