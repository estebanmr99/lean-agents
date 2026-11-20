// Marked blocks: id-named blocks share one shell rc file, and undo removes only its own.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { plan, apply, undo, setBlock, removeBlock } from '../scripts/lib/fsops.mjs';

test('two id blocks live in one rc file; each undo removes only its own and the file still parses', { skip: process.platform === 'win32' && 'sh' }, () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lean-block-'));
  const rc = path.join(home, '.zshrc');
  fs.writeFileSync(rc, 'alias a=b\n');
  const one = apply(plan([{ kind: 'block', id: 'one', path: rc, body: 'export A=1' }], [], [home]), path.join(home, 'b1'), home);
  apply(plan([{ kind: 'block', id: 'two', path: rc, body: 'export B=2' }], [], [home]), path.join(home, 'b2'), home);
  assert.equal(spawnSync('sh', ['-n', rc]).status, 0, fs.readFileSync(rc, 'utf8'));
  undo(one, [home]);
  assert.equal(fs.readFileSync(rc, 'utf8'), 'alias a=b\n\n# lean-agents:two:start\nexport B=2\n# lean-agents:two:end\n');
  fs.rmSync(home, { recursive: true, force: true });
});

test('removeBlock without an id keeps an id block; with an id it keeps the others', () => {
  const text = setBlock(setBlock('x\n', 'A', false, 'one'), 'B', false, 'two');
  assert.equal(removeBlock(text), text);
  assert.equal(removeBlock(text, 'one'), 'x\n\n# lean-agents:two:start\nB\n# lean-agents:two:end\n');
});
