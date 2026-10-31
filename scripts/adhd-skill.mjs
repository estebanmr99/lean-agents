#!/usr/bin/env node
// Usage: adhd-skill.mjs on|off <home>. See scripts/lib/adhd.mjs for why this exists.
import fs from 'node:fs';
import { adhdSkillFiles, setInvocable } from './lib/adhd.mjs';

const [mode, home] = process.argv.slice(2);
const files = adhdSkillFiles(home);
for (const f of files) fs.writeFileSync(f, setInvocable(fs.readFileSync(f, 'utf8'), mode === 'on'));
if (mode === 'on' && !files.length) {
  console.error('i-have-adhd skill not found');
  process.exit(1);
}
