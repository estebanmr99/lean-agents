#!/usr/bin/env node
// Parallel agent sessions helper: start <task.md>…, status, merge <task> --yes, clean.
// Run it inside the repo whose work you want to split (or pass --repo <dir>).
import { start, status, merge, clean } from './lib/parallel.mjs';

const VALUE_FLAGS = ['repo', 'base', 'agent', 'tier', 'profile', 'model', 'cmd'];

function parse(argv) {
  const opts = {};
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const m = argv[i].match(/^--(\w+)$/);
    if (!m) rest.push(argv[i]);
    else if (VALUE_FLAGS.includes(m[1])) opts[m[1]] = argv[++i];
    else opts[m[1]] = true;
  }
  return { opts, rest };
}

const USAGE = `usage: parallel.mjs <command> [options]
  start <task.md>…  [--agent auto|orca|claude|opencode|print|custom] [--tier cheap|balanced|strong]
                    [--profile <name>] [--model <id>] [--base <branch>] [--cmd <program>]
  status
  merge <task> --yes   merge one finished worker (start order), rebase the rest
  clean                remove merged worktrees and branches
  --repo <dir>         repository to work in (default: current directory)`;

const { opts, rest } = parse(process.argv.slice(2));
const [cmd, ...args] = rest;
const cwd = opts.repo ?? process.cwd();

try {
  if (cmd === 'start' && args.length) {
    for (const w of start(cwd, args, opts)) {
      console.log(`${w.name}: ${w.agent}, tier ${w.tier}${w.model ? ` (${w.model})` : ''}, branch ${w.branch}, ${w.dir}`);
      if (w.command) console.log(`  run in a new terminal: ${w.command}`);
    }
  } else if (cmd === 'status') {
    const rows = status(cwd);
    if (!rows.length) console.log('no workers');
    for (const w of rows) {
      console.log(`${w.name}\t${w.merged ? 'merged' : w.status}\t${w.agent}\t${w.tier}\t${w.branch}`);
      if (w.tail && !w.merged) console.log(w.tail.replace(/^/gm, '    '));
    }
  } else if (cmd === 'merge' && args.length === 1) {
    if (!opts.yes) { console.log(`dry run: would merge ${args[0]}; ask the user, then add --yes`); process.exit(0); }
    const rebased = merge(cwd, args[0]);
    console.log(`merged ${args[0]}${rebased.length ? `; rebased ${rebased.join(', ')}; rerun their checks` : ''}`);
  } else if (cmd === 'clean') {
    const r = clean(cwd);
    console.log(`removed: ${r.removed.join(', ') || 'none'}${r.kept.length ? `; kept (not merged): ${r.kept.join(', ')}` : ''}`);
  } else {
    console.log(USAGE);
    process.exit(cmd ? 1 : 0);
  }
} catch (e) {
  console.error(`error: ${e.message}`);
  process.exit(1);
}
