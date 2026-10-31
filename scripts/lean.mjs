#!/usr/bin/env node
// lean-agents engine: plan, apply, update, uninstall and doctor.
// install.sh / install.ps1 make sure Node and this checkout exist, then call this file.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { plan, apply, undo, describe } from './lib/fsops.mjs';
import { loadCore, renderRules, loadProfile } from './lib/render.mjs';
import { claudeAdapter } from './lib/adapters/claude.mjs';
import { opencodeV2Adapter } from './lib/adapters/opencode-v2.mjs';
import { detectAgents, packageManager, prereqFor, which, run, quiet, exists } from './lib/system.mjs';
import { doctor } from './lib/doctor.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ADAPTERS = { claude: claudeAdapter, 'opencode-v2': opencodeV2Adapter };
const MINIMAL_TOOLS = ['rtk', 'context-mode'];
const OPTIONAL_TOOLS = ['serena', 'playwright', 'ponytail', 'caveman', 'i-have-adhd'];
const TOOL_INFO = {
  serena: 'Serena MCP: symbol-level code navigation, so agents read less code',
  playwright: 'Playwright MCP: lets agents drive a browser to check web UIs',
  ponytail: 'Ponytail: code-quality guidance injected each turn (lite mode recommended)',
  caveman: 'Caveman skills: extra-compressed answers when you ask for them',
  'i-have-adhd': 'i-have-adhd: skimmable, action-first formatting for every answer',
};

function parseArgs(argv) {
  const o = {
    command: 'install', dryRun: false, yes: false, agents: null, tools: null, privacy: null, profile: null,
    lang: null, home: os.homedir(), exec: true, adhdAlways: null, ponytailMode: null,
  };
  const list = (v) => v.split(',').map((s) => s.trim()).filter(Boolean);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    switch (a) {
      case '--dry-run': o.dryRun = true; break;
      case '--yes': case '-y': o.yes = true; break;
      case '--agents': o.agents = list(next()); break;
      case '--tools': o.tools = [...new Set([...MINIMAL_TOOLS, ...list(next())])]; break;
      case '--all-tools': o.tools = [...MINIMAL_TOOLS, ...OPTIONAL_TOOLS]; break;
      case '--no-tools': o.tools = []; break;
      case '--privacy': o.privacy = next(); break;
      case '--profile': o.profile = next(); break;
      case '--lang': o.lang = next(); break;
      case '--home': o.home = path.resolve(next()); break;
      case '--no-exec': o.exec = false; break;
      case '--adhd-always': o.adhdAlways = true; break;
      case '--ponytail-mode': o.ponytailMode = next(); break;
      case '--update': o.command = 'update'; break;
      case '--uninstall': o.command = 'uninstall'; break;
      case '--doctor': o.command = 'doctor'; break;
      case '--skip-agents': case '--no-admin': break; // defaults in v1: agents are never installed, nothing needs admin
      case '--help': case '-h': o.command = 'help'; break;
      default: throw new Error(`unknown option ${a} (see --help)`);
    }
  }
  return o;
}

const HELP = `Usage: lean-agents [options]

  --dry-run              Show every file change and command; change nothing
  --yes                  Accept defaults without asking
  --agents a,b           claude, opencode-v2 (default: the ones installed)
  --tools a,b            Optional tools on top of rtk and context-mode:
                         ${OPTIONAL_TOOLS.join(', ')}
  --all-tools / --no-tools
  --privacy standard|strict
  --profile <name>       Model profile for OpenCode (see profiles/)
  --lang en|es           Language for rules and replies
  --adhd-always          Turn on i-have-adhd for every answer
  --ponytail-mode lite|full|ultra|off
  --update               Re-apply with your saved choices
  --uninstall            Undo everything lean-agents changed
  --doctor               Check the install
`;

function prompter(yes) {
  if (yes) return { ask: async (_q, def) => def, close() {} };
  let input = process.stdin;
  if (!process.stdin.isTTY) {
    try { input = fs.createReadStream(process.platform === 'win32' ? 'CONIN$' : '/dev/tty'); } catch { /* keep stdin */ }
  }
  const rl = readline.createInterface({ input, output: process.stdout });
  return {
    ask: (q, def) => new Promise((res) => rl.question(`${q} [${def}] `, (a) => res(a.trim() || def))),
    close: () => rl.close(),
  };
}
const yesNo = (a) => /^(y|yes|s|si|sí)$/i.test(a);

function stateDir(home) { return path.join(home, '.config', 'lean-agents'); }
function readState(home) {
  const f = path.join(stateDir(home), 'state.json');
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null;
}

async function choose(o, saved) {
  const p = prompter(o.yes);
  const detected = detectAgents();
  const supported = Object.keys(detected).filter((a) => ADAPTERS[a]);
  if (!o.agents) {
    o.agents = saved?.agents ?? [];
    if (!saved) {
      if (!supported.length) console.log('No supported agent found on PATH (claude, opencode 2.x). Use --agents to configure anyway.');
      for (const a of supported) {
        if (yesNo(await p.ask(`Configure ${a} ${detected[a]}?`, 'y'))) o.agents.push(a);
      }
    }
  }
  for (const a of o.agents) if (!ADAPTERS[a]) throw new Error(`agent "${a}" is not supported yet (available: ${Object.keys(ADAPTERS).join(', ')})`);
  if (Object.keys(detected).includes('opencode-v1') && !o.agents.includes('opencode-v1')) {
    console.log('Note: OpenCode 1.x support lands in the next release.');
  }
  if (!o.tools) {
    o.tools = saved?.tools ?? [...MINIMAL_TOOLS];
    if (!saved) {
      for (const t of OPTIONAL_TOOLS) if (yesNo(await p.ask(`Add ${TOOL_INFO[t]}?`, 'n'))) o.tools.push(t);
    }
  }
  o.privacy ??= saved?.privacy ?? (yesNo(await p.ask('Strict privacy (no telemetry, no auto-updates, no session sharing)?', 'n')) ? 'strict' : 'standard');
  o.lang ??= saved?.lang ?? (await p.ask('Language for rules and replies (en/es)?', 'en'));
  if (o.agents.includes('opencode-v2') && !o.profile) {
    o.profile = saved?.profile ?? (await p.ask('OpenCode model profile (vertex-gemini, anthropic-api, none)?', 'none'));
  }
  if (o.profile === 'none') o.profile = null;
  if (o.tools.includes('i-have-adhd')) o.adhdAlways ??= saved?.adhdAlways ?? yesNo(await p.ask('Use i-have-adhd on every answer?', 'y'));
  if (o.tools.includes('ponytail')) o.ponytailMode ??= saved?.ponytailMode ?? (await p.ask('Ponytail default mode (lite/full/ultra/off)?', 'lite'));
  return p;
}

function buildPlan(o) {
  const core = loadCore(ROOT);
  const rulesPath = path.join(stateDir(o.home), 'AGENTS.md');
  const actions = [{ kind: 'file', path: rulesPath, content: renderRules(ROOT, o) }];
  const commands = [];
  for (const agent of o.agents) {
    const profile = agent === 'claude' ? loadProfile(ROOT, 'claude-subscription') : loadProfile(ROOT, o.profile);
    const r = ADAPTERS[agent]({ home: o.home, core, profile, opts: o, rulesPath });
    actions.push(...r.actions);
    commands.push(...r.commands.map((c) => ({ ...c, agent })));
  }
  return { planned: plan(actions), commands };
}

function prereqCommands(o) {
  const pm = packageManager();
  const out = [];
  for (const t of o.tools) {
    const p = prereqFor(t, pm);
    if (!p || which(p.bin)) continue;
    if (p.install) out.push({ tool: t, desc: `install ${p.bin}`, run: p.install, undo: [] });
    else out.push({ tool: t, desc: `${p.bin} is missing: install it from ${p.manual}`, run: [], undo: [], manual: true });
  }
  return out;
}

function printPlan(o, planned, commands) {
  console.log(`\nlean-agents plan for ${o.agents.join(', ') || 'no agents'}`);
  console.log(`  tools: ${o.tools.join(', ') || 'none'} | privacy: ${o.privacy} | lang: ${o.lang} | profile: ${o.profile ?? 'none'}\n`);
  console.log('Files:');
  console.log(describe(planned, o.home));
  if (commands.length) {
    console.log('\nCommands:');
    for (const c of commands) {
      console.log(`  - ${c.desc}${c.agent ? ` (${c.agent})` : ''}`);
      for (const argv of c.run) console.log(`      $ ${argv.join(' ')}`);
    }
  }
  console.log('');
}

async function install(o) {
  const saved = o.command === 'update' ? readState(o.home) : null;
  if (o.command === 'update' && !saved) throw new Error('nothing to update: lean-agents is not installed');
  const p = await choose(o, saved?.options);
  const { planned, commands: agentCommands } = buildPlan(o);
  const commands = [...(o.exec ? prereqCommands(o) : []), ...agentCommands];
  printPlan(o, planned, commands);
  if (o.dryRun) { p.close(); console.log('Dry run: nothing was changed.'); return; }
  if (!yesNo(await p.ask('Apply these changes?', 'y'))) { p.close(); console.log('Cancelled.'); return; }
  p.close();

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = path.join(stateDir(o.home), 'backups', stamp);
  const files = apply(planned, backupDir, o.home);
  const ran = [];
  if (o.exec) {
    for (const c of commands) {
      if (c.manual) { console.log(`! ${c.desc}`); continue; }
      if (c.skipIfExists && exists(c.skipIfExists)) continue;
      if (c.skipIfOutput && quiet(c.skipIfOutput.cmd).ok) continue;
      console.log(`- ${c.desc}`);
      const ok = c.run.every((argv) => run(argv, { dryRun: false, log: console.log }));
      if (!ok) console.log(`  ! failed: ${c.desc}. Run the command above by hand, then --doctor.`);
      ran.push({ desc: c.desc, ok, undo: c.undo });
    }
  }
  const previous = readState(o.home);
  const state = {
    version: JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version,
    installedAt: previous?.installedAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    options: { agents: o.agents, tools: o.tools, privacy: o.privacy, lang: o.lang, profile: o.profile, adhdAlways: o.adhdAlways, ponytailMode: o.ponytailMode },
    files: [...(previous?.files ?? []), ...files],
    commands: [...(previous?.commands ?? []), ...ran],
  };
  fs.mkdirSync(stateDir(o.home), { recursive: true });
  fs.writeFileSync(path.join(stateDir(o.home), 'state.json'), `${JSON.stringify(state, null, 2)}\n`);
  console.log(`\nDone. Backups: ${backupDir}`);
  console.log('Next: restart your agents, log in to your providers, then run --doctor.');
  if (o.privacy === 'strict' && o.agents.includes('claude')) {
    console.log('Strict privacy: also turn off "Help improve Claude" in your claude.ai privacy settings.');
  }
}

async function uninstall(o) {
  const state = readState(o.home);
  if (!state) { console.log('lean-agents is not installed.'); return; }
  const p = prompter(o.yes);
  console.log(`This restores ${state.files.length} files and undoes ${state.commands.length} commands.`);
  if (o.dryRun || !yesNo(await p.ask('Uninstall?', o.yes ? 'y' : 'n'))) { p.close(); console.log('Nothing changed.'); return; }
  p.close();
  if (o.exec) {
    for (const c of [...state.commands].reverse()) for (const argv of c.undo ?? []) run(argv, { dryRun: false, log: console.log });
  }
  for (const [what, file] of undo(state.files)) console.log(`  ${what.padEnd(20)} ${file}`);
  fs.renameSync(path.join(stateDir(o.home), 'state.json'), path.join(stateDir(o.home), `state.uninstalled-${Date.now()}.json`));
  console.log('Uninstalled. Backups are kept in ~/.config/lean-agents/backups.');
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  if (o.command === 'help') return console.log(HELP);
  if (o.command === 'doctor') return process.exit(doctor({ home: o.home, state: readState(o.home), exec: o.exec }) ? 0 : 1);
  if (o.command === 'uninstall') return uninstall(o);
  return install(o);
}

main().catch((e) => {
  console.error(`lean-agents: ${e.message}`);
  process.exit(1);
});
