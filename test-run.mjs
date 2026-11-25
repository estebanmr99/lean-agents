import test from 'node:test';
import { spawnSync } from 'node:child_process';
const result = spawnSync('node', ['--test', 'tests/code-mode-proxy.test.mjs']);
console.log(result.stdout.toString(), result.stderr.toString());
