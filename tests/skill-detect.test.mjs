// Session 45: every command in the "Detect what is installed" table of docs/manual-install.md runs read-only
// (the lean-update skill runs exactly these), and the documented backup snippet copies then removes. Temp HOME, stub CLIs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DOC = fs.readFileSync(path.join(ROOT, 'docs', 'manual-install.md'), 'utf8');
const section = (title) => DOC.split(/^## /m).find((s) => s.startsWith(title));

function snapshot(dir) {
  const out = {};
  for (const e of fs.readdirSync(dir, { recursive: true, withFileTypes: true })) {
    const p = path.join(e.parentPath ?? e.path, e.name);
    out[path.relative(dir, p)] = e.isFile() ? fs.statSync(p).mtimeMs + ':' + fs.readFileSync(p, 'utf8') : 'dir';
  }
  return out;
}

test('every detection command runs read-only in a temp HOME', { skip: process.platform === 'win32' }, () => {
  const rows = section('6. Detect').split('\n').filter((l) => /^\| /.test(l)).slice(2);
  assert.ok(rows.length >= 8, 'table found');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lean-home-'));
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'lean-bin-'));
  for (const name of ['claude', 'opencode', 'rtk', 'uvx', 'npm']) fs.writeFileSync(path.join(bin, name), '#!/bin/sh\necho stub 1.0.0\n', { mode: 0o755 });
  fs.writeFileSync(path.join(home, '.claude.json'), JSON.stringify({ mcpServers: { serena: { args: ['--from', 'git+x'] }, playwright: { args: ['@playwright/mcp@0.0.83'] } } }));
  fs.mkdirSync(path.join(home, '.agents'));
  fs.writeFileSync(path.join(home, '.agents', '.skill-lock.json'), JSON.stringify({ version: 3, skills: { caveman: { source: 'a/b', ref: 'v1.0.0' } } }));
  const env = { PATH: `${bin}${path.delimiter}${path.dirname(process.execPath)}:/usr/bin:/bin`, HOME: home };
  const before = snapshot(home);
  for (const row of rows) {
    const cmd = row.split(/ \| /)[1].match(/`([^`]+)`/)[1];
    const r = spawnSync('sh', ['-c', cmd], { encoding: 'utf8', env });
    assert.equal(r.status, 0, `${cmd}\n${r.stderr}`);
    assert.ok(r.stdout.trim(), `${cmd}: no output`);
  }
  assert.deepEqual(snapshot(home), before, 'a detection command wrote into HOME');
});

test('the documented backup snippet copies only the named file, then removes the folder', { skip: process.platform === 'win32' }, () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lean-tmp-'));
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'lean-cfg-')), 'settings.json');
  fs.writeFileSync(file, '{"a":1}');
  const lines = section('7. Back up').match(/```sh\n([\s\S]*?)```/)[1].split('\n').filter((l) => l && !l.startsWith('#'));
  const run = (script) => spawnSync('sh', ['-c', script], { encoding: 'utf8', env: { ...process.env, TMPDIR: tmp, P: file } });
  const made = run(`${lines.slice(0, 2).join('\n')}\necho "$B"`);
  assert.equal(made.status, 0, made.stderr);
  const folder = made.stdout.trim();
  assert.ok(folder.startsWith(tmp) && /lean-agents-backup-\d{8}-\d{6}$/.test(folder), folder);
  assert.equal(fs.readFileSync(path.join(folder, file), 'utf8'), '{"a":1}');
  assert.deepEqual(fs.readdirSync(tmp), [path.basename(folder)]);
  assert.equal(run(`B=${folder}\n${lines[2]}`).status, 0);
  assert.deepEqual(fs.readdirSync(tmp), []);
  assert.ok(fs.existsSync(file), 'the original stays');
});
