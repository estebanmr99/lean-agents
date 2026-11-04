#!/usr/bin/env node
// lean-agents engine: plan, apply, update, uninstall and doctor.
// install.sh / install.ps1 make sure Node and this checkout exist, then call this file.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import tty from 'node:tty';
import { fileURLToPath } from 'node:url';
import { plan, apply, undo, describe } from './lib/fsops.mjs';
import { loadCore, renderRules, loadProfile } from './lib/render.mjs';
import { claudeAdapter } from './lib/adapters/claude.mjs';
import { opencodeV1Adapter } from './lib/adapters/opencode-v1.mjs';
import { opencodeV2Adapter } from './lib/adapters/opencode-v2.mjs';
import { copilotAdapter } from './lib/adapters/copilot-cli.mjs';
import { antigravityAdapter } from './lib/adapters/antigravity.mjs';
import { vscodeCopilotAdapter } from './lib/adapters/vscode-copilot.mjs';
import { cursorAdapter } from './lib/adapters/cursor.mjs';
import { projectPlan, projectStateDir } from './lib/project.mjs';
import { gsdPlan } from './lib/gsd.mjs';
import { adhdCommand } from './lib/adhd.mjs';
import { detectAgents, packageManager, prereqFor, bunInstall, bunPresent, which, run, quiet, exists, isolate } from './lib/system.mjs';
import { doctor } from './lib/doctor.mjs';
import { canUseMenus, menuPrompter, menuProgress } from './lib/ui.mjs';
import { CATEGORIES, preset, onOff, fromPrivacy, privacyOf, childEnv, shareProxy, proxyReport } from './lib/network.mjs';
import { unverifiedItems, notesFile } from './lib/unverified.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ADAPTERS = { claude: claudeAdapter, 'opencode-v1': opencodeV1Adapter, 'opencode-v2': opencodeV2Adapter, 'copilot-cli': copilotAdapter, antigravity: antigravityAdapter };
// Agents whose models do not depend on --profile.
const FIXED_PROFILE = { claude: 'claude-subscription', 'copilot-cli': 'github-copilot', antigravity: 'antigravity' };
Object.assign(ADAPTERS, { 'vscode-copilot': vscodeCopilotAdapter, cursor: cursorAdapter });
FIXED_PROFILE['vscode-copilot'] = 'github-copilot';
// Extensions cannot be installed silently without admin policy, so the user installs it.
const EXTENSION_NOTE = 'install the Playwright Extension yourself from https://chromewebstore.google.com/detail/playwright-extension/mmlmfjhmonkocbjadbfplnigmagldckm . Each session asks you to approve the connection; optional auto-approve: docs/browser-extension.md';
const MINIMAL_TOOLS = ['rtk', 'context-mode'];
const OPTIONAL_TOOLS = ['serena', 'playwright', 'ponytail', 'caveman', 'i-have-adhd', 'dcp', 'codeburn'];
// Asked for one by one and never part of --all-tools.
const OPT_IN_TOOLS = ['gsd', 'autoskills', 'playwright-extension'];
const TOOL_INFO = {
  serena: 'Serena MCP: symbol-level code navigation, so agents read less code',
  playwright: 'Playwright MCP: lets agents drive a browser to check web UIs',
  'playwright-extension': 'Playwright MCP extension mode: attaches to your own signed-in Chrome (pages behind single sign-on); not for Claude Code, which has Claude in Chrome',
  ponytail: 'Ponytail: code-quality guidance injected each turn (lite mode recommended)',
  caveman: 'Caveman skills: extra-compressed answers when you ask for them',
  'i-have-adhd': 'i-have-adhd: skimmable, action-first formatting for every answer',
  dcp: 'DCP: prunes old context on OpenCode 1.x (AGPL-3.0)',
  codeburn: 'Codeburn: usage and cost report across agents, run with npx',
  gsd: 'GSD Core: spec-driven workflow skills and agents (large install)',
  autoskills: 'AutoSkills: picks skills per project, run with npx (CC BY-NC 4.0: non-commercial use only)',
};

function parseArgs(argv) {
  const o = {
    command: 'install', dryRun: false, yes: false, agents: null, tools: null, privacy: null, profile: null,
    lang: null, home: os.homedir(), exec: true, adhdAlways: null, ponytailMode: null,
    networkPreset: null, networkFlags: {}, gh: null, bun: null,
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
      case '--bun': o.bun = true; break;
      case '--no-bun': o.bun = false; break;
      case '--privacy': o.privacy = next(); fromPrivacy(o.privacy); break;
      case '--gh': o.gh = true; break;
      case '--network': o.networkPreset = onOff(a, next()); break;
      case '--telemetry': o.networkFlags.telemetry = onOff(a, next()); break;
      case '--auto-update': o.networkFlags.autoUpdate = onOff(a, next()); break;
      case '--outbound': o.networkFlags.outbound = onOff(a, next()); break;
      case '--profile': o.profile = next(); break;
      case '--lang': o.lang = next(); break;
      case '--home': o.home = path.resolve(next()); break;
      // realpath: the state dir is keyed by this path, and /var and /private/var are one folder on macOS.
      case '--project': o.project = fs.realpathSync(path.resolve(next())); break;
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
  --agents a,b           ${Object.keys(ADAPTERS).join(', ')}
                         (default: the ones installed)
  --tools a,b            Optional tools on top of rtk and context-mode:
                         ${[...OPTIONAL_TOOLS, ...OPT_IN_TOOLS].join(', ')}
  --all-tools / --no-tools  (--all-tools leaves out ${OPT_IN_TOOLS.join(', ')})
  --privacy standard|strict  Same as --network on / --network off
  --network on|off       Preset for telemetry, auto-updates and other outbound calls
  --telemetry on|off, --auto-update on|off, --outbound on|off
                         One category; overrides the preset
  --profile <name>       Model profile for OpenCode (see profiles/)
  --lang en|es           Language for rules and replies
  --gh                   Install GitHub CLI (gh) if it is missing
  --bun / --no-bun       Install Bun for Context Mode (default: on; faster JS, TypeScript)
  --project <dir>        Write the shared team files into one repository
                         (AGENTS.md, .github/, .vscode/mcp.json, .cursor/)
  --adhd-always          Turn on i-have-adhd for every answer
  --ponytail-mode lite|full|ultra|off
  --update               Re-apply with your saved choices
  --uninstall            Undo everything lean-agents changed
  --doctor               Check the install
`;

async function prompter(yes) {
  if (yes) return { ask: async (_q, def) => def, select: async ({ def }) => def, multi: async ({ defaults }) => defaults, close() {} };
  let input = process.stdin;
  if (!process.stdin.isTTY) {
    // openSync reports a missing /dev/tty here, not later as a crash. A tty.ReadStream, unlike
    // an fs stream, can close while a read is pending, so the process can exit.
    try { input = new tty.ReadStream(fs.openSync(process.platform === 'win32' ? 'CONIN$' : '/dev/tty', 'r')); } catch { /* keep stdin */ }
  }
  if (canUseMenus(input)) return menuPrompter(input);
  const rl = readline.createInterface({ input, output: process.stdout });
  // Never fall back to the default answer here: nobody approved these changes.
  const noInput = () => new Error('no terminal to ask on: pass --yes to accept the defaults, or --dry-run with --agents and --tools to preview');
  let closed = false;
  let fail = null;
  rl.once('close', () => { closed = true; fail?.(noInput()); });
  const ask = (q, def) => new Promise((res, rej) => {
    if (closed) return rej(noInput());
    fail = rej;
    rl.question(`${q} [${def}] `, (a) => res(a.trim() || def));
  });
  return {
    tty: Boolean(input.isTTY),
    ask,
    // Menus fall back to the same text questions as before.
    select: ({ ask: q, def }) => ask(q, def),
    multi: async ({ items, defaults }) => {
      const picked = [];
      for (const it of items) if (yesNo(await ask(it.ask, defaults.includes(it.value) ? 'y' : 'n'))) picked.push(it.value);
      return picked;
    },
    close: () => { fail = null; rl.close(); if (input !== process.stdin) input.destroy(); },
  };
}
const yesNo = (a) => /^(y|yes|s|si|sí)$/i.test(a);

// --project keeps its own state, so a repo install and a user install never mix.
let project = null;
function stateDir(home) {
  if (project) return projectStateDir(home, project);
  return path.join(home, '.config', 'lean-agents');
}
function readState(home) {
  const f = path.join(stateDir(home), 'state.json');
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null;
}

async function choose(o, saved) {
  const p = await prompter(o.yes);
  if (!o.agents) {
    o.agents = saved?.agents ?? [];
    if (!saved) {
      const detected = detectAgents();
      const supported = Object.keys(detected).filter((a) => ADAPTERS[a]);
      if (!supported.length) console.log('No supported agent found on PATH (claude, opencode, copilot, agy). Use --agents to configure anyway.');
      const items = supported.map((a) => ({ value: a, label: `${a} ${detected[a]}`, ask: `Configure ${a} ${detected[a]}?` }));
      if (items.length) o.agents.push(...await p.multi({ message: 'Agents to configure (space to toggle, enter to confirm)', items, defaults: supported }));
    }
  }
  for (const a of o.agents) if (!ADAPTERS[a]) throw new Error(`agent "${a}" is not supported yet (available: ${Object.keys(ADAPTERS).join(', ')})`);
  if (o.agents.includes('opencode-v1') && o.agents.includes('opencode-v2')) {
    throw new Error('opencode-v1 and opencode-v2 write the same config files: pick one');
  }
  if (!o.tools) {
    o.tools = saved?.tools ?? [...MINIMAL_TOOLS];
    if (!saved) {
      const offered = [...OPTIONAL_TOOLS, ...OPT_IN_TOOLS].filter((t) => t !== 'dcp' || o.agents.includes('opencode-v1'));
      const items = offered.map((t) => ({ value: t, label: t, hint: TOOL_INFO[t].replace(/^[^:]+: /, ''), ask: `Add ${TOOL_INFO[t]}?` }));
      o.tools.push(...await p.multi({ message: `Optional tools (${MINIMAL_TOOLS.join(' and ')} are always included)`, items, defaults: [] }));
    }
  }
  const known = [...MINIMAL_TOOLS, ...OPTIONAL_TOOLS, ...OPT_IN_TOOLS];
  const unknown = o.tools.filter((t) => !known.includes(t));
  if (unknown.length) throw new Error(`unknown tools: ${unknown.join(', ')} (available: ${known.join(', ')})`);
  if (!o.agents.includes('opencode-v1')) o.tools = o.tools.filter((t) => t !== 'dcp');
  await chooseNetwork(o, saved, p);
  await chooseUnverified(o, saved, p);
  o.gh ??= saved?.gh ?? (!which('gh') && yesNo(await p.ask('Install GitHub CLI (gh)? You log in yourself afterwards', 'n')));
  if (o.tools.includes('context-mode') && !o.project) o.bun ??= saved?.bun ?? (bunPresent(o.home) || yesNo(await p.ask('Install Bun so Context Mode runs faster?', 'y')));
  o.lang ??= saved?.lang ?? (await p.select({ ask: 'Language for rules and replies (en/es)?', message: 'Language for rules and replies', options: [{ value: 'en', label: 'English' }, { value: 'es', label: 'Español' }], def: 'en' }));
  if (o.agents.some((a) => a.startsWith('opencode')) && !o.profile) {
    const profiles = ['github-copilot', 'vertex-gemini', 'anthropic-api', 'opencode-go', 'openai-api', 'none'];
    o.profile = saved?.profile ?? (await p.select({ ask: `OpenCode model profile (${profiles.join(', ')})?`, message: 'OpenCode model profile', options: profiles.map((v) => ({ value: v })), def: 'none' }));
  }
  if (o.profile === 'none') o.profile = null;
  if (o.tools.includes('i-have-adhd')) o.adhdAlways ??= saved?.adhdAlways ?? yesNo(await p.ask('Use i-have-adhd on every answer?', 'y'));
  if (o.tools.includes('ponytail')) o.ponytailMode ??= saved?.ponytailMode ?? (await p.select({ ask: 'Ponytail default mode (lite/full/ultra/off)?', message: 'Ponytail default mode', options: ['lite', 'full', 'ultra', 'off'].map((v) => ({ value: v })), def: 'lite' }));
  return p;
}

const NETWORK_INFO = { telemetry: 'telemetry and error reports', autoUpdate: 'auto-updates', outbound: 'other outbound calls (session sharing, feedback, built-in providers)' };

async function chooseNetwork(o, saved, p) {
  let base = o.networkPreset ? preset(o.networkPreset) : fromPrivacy(o.privacy) ?? saved?.network ?? fromPrivacy(saved?.privacy);
  if (!base && !Object.keys(o.networkFlags).length) {
    const a = await p.select({
      ask: 'Network: off (enterprise PC: no telemetry, auto-updates or sharing), on (personal PC), or choose per category?',
      message: 'Telemetry, auto-updates and other outbound calls',
      options: [
        { value: 'off', label: 'All off', hint: 'enterprise PC' },
        { value: 'on', label: 'All on', hint: 'personal PC, nothing changes' },
        { value: 'choose', label: 'Choose per category' },
      ],
      def: 'on',
    });
    if (a === 'off' || a === 'on') base = preset(a);
    else if (a === 'choose') {
      base = {};
      for (const c of CATEGORIES) base[c] = yesNo(await p.ask(`Keep ${NETWORK_INFO[c]} on?`, 'y')) ? 'on' : 'off';
    } else throw new Error(`network takes off, on or choose, not "${a}"`);
  }
  o.network = { ...(base ?? preset('on')), ...o.networkFlags };
  o.privacy = privacyOf(o.network);
}

async function chooseUnverified(o, saved, p) {
  o.unverified = { ...saved?.unverified };
  o.notes = [];
  for (const item of unverifiedItems(o, o.home, { stateFiles: readState(o.home)?.files ?? [] })) {
    if (item.kept) { o.unverified[item.id] = 'kept'; continue; }
    if (o.unverified[item.id] && o.unverified[item.id] !== 'kept') continue;
    // --yes, pipes and no terminal keep the default: pasting is interactive only.
    if (!p.menus && !p.tty) { o.unverified[item.id] = 'default'; continue; }
    const a = await p.select({
      ask: `${item.label} is not documented upstream. Paste your docs or IT notes (paste), or keep the tool's default (default)?`,
      message: `${item.label}: not documented upstream`,
      options: [
        { value: 'default', label: "Keep the tool's default" },
        { value: 'paste', label: 'Paste docs or IT notes', hint: 'saved for your agent to apply after review' },
      ],
      def: 'default',
    });
    const pick = { p: 'paste', d: 'default' }[a.trim().toLowerCase()[0]];
    if (!pick) throw new Error(`answer paste or default, not "${a}"`);
    const answer = pick === 'paste' ? (await p.ask('One line of notes, or a path to a file with them (no passwords)', '')).trim() : '';
    o.unverified[item.id] = answer ? 'notes' : 'default';
    if (answer) o.notes.push(notesFile(o.home, item, answer));
  }
}

function buildPlan(o) {
  if (o.project) {
    const r = projectPlan(ROOT, o.project, o);
    return { planned: plan(r.actions), commands: r.commands };
  }
  const core = loadCore(ROOT);
  const rulesPath = path.join(stateDir(o.home), 'AGENTS.md');
  const rules = renderRules(ROOT, o);
  const actions = [{ kind: 'file', path: rulesPath, content: rules }, ...o.notes];
  const commands = [];
  for (const agent of o.agents) {
    const profile = loadProfile(ROOT, FIXED_PROFILE[agent] ?? o.profile);
    const r = ADAPTERS[agent]({ home: o.home, core, profile, opts: o, rules, adhdCommand: adhdCommand(o.home), rulesPath: rulesPath.split(path.sep).join('/') });
    actions.push(...r.actions);
    commands.push(...r.commands.map((c) => ({ ...c, agent })));
  }
  if (o.tools.includes('gsd')) {
    const r = gsdPlan(ROOT, o.home, o);
    actions.push(...r.actions);
    commands.push(...r.commands);
  }
  if (o.bun && o.network.telemetry === 'off') {
    actions.push({ kind: 'block', toml: true, path: path.join(o.home, '.bunfig.toml'), body: 'telemetry = false' });
  }
  return { planned: plan(actions), commands };
}

function prereqCommands(o) {
  const pm = packageManager();
  const out = [];
  for (const t of [...o.tools, ...(o.gh ? ['gh'] : [])]) {
    const p = prereqFor(t, pm);
    if (!p || which(p.bin)) continue;
    if (p.install) out.push({ tool: t, desc: `install ${p.bin}`, run: p.install, undo: [] });
    else out.push({ tool: t, desc: `${p.bin} is missing: install it from ${p.manual}`, run: [], undo: [], manual: true });
  }
  if (o.bun && o.tools.includes('context-mode') && process.platform !== 'linux' && !which('bun') && bunPresent(o.home)) {
    console.log('! Bun is in ~/.bun/bin but not on PATH; Context Mode needs it on PATH here. Add that folder to PATH.');
  }
  if (o.bun && o.tools.includes('context-mode') && !bunPresent(o.home)) {
    const b = bunInstall(o.home, stateDir(o.home), process.platform, pm);
    if (b) out.push(b);
    else console.log('! Bun needs Homebrew here: install it from https://bun.com/docs/installation. Context Mode will run on Node.');
  }
  return out;
}

function printPlan(o, planned, commands) {
  console.log(`\nlean-agents plan for ${o.agents.join(', ') || 'no agents'}`);
  if (o.project) console.log(`  project: ${o.project}`);
  console.log(`  tools: ${o.tools.join(', ') || 'none'} | privacy: ${o.privacy} | lang: ${o.lang} | profile: ${o.profile ?? 'none'}`);
  if (o.tools.includes('context-mode')) console.log(`  bun: ${o.bun ? `on${bunPresent(o.home) ? ' (already installed)' : ''}` : 'off'}`);
  console.log(`  network: ${CATEGORIES.map((c) => `${c} ${o.network[c]}`).join(', ')}`);
  const net = proxyReport();
  if (net.length) console.log(`  proxy and CA (passed to every command): ${net.join(' ')}`);
  if (o.tools.includes('playwright-extension')) console.log(`  signed-in browser: ${EXTENSION_NOTE}`);
  if (o.notes.length) console.log(`  your notes for undocumented settings (saved, never applied): ${o.notes.map((n) => path.basename(n.path, '.md')).join(', ')}`);
  console.log('');
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
  const ui = p.menus ? await menuProgress() : null;
  Object.assign(process.env, childEnv(o.network), { BUN_INSTALL: path.join(o.home, '.bun') });

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = path.join(stateDir(o.home), 'backups', stamp);
  const files = apply(planned, backupDir, o.home);
  const ran = [];
  let failed = 0;
  if (o.exec) {
    for (const [i, c] of commands.entries()) {
      if (c.manual) { console.log(`! ${c.desc}`); failed++; continue; }
      if (c.skipIfExists && exists(c.skipIfExists)) continue;
      if (c.skipIfOutput && quiet(c.skipIfOutput.cmd).ok) continue;
      if (ui) ui.step(i + 1, commands.length, c.desc);
      else console.log(`- ${c.desc}`);
      const ok = c.run.every((argv) => run(argv, { dryRun: false, log: console.log }));
      if (ui) ui.result(ok || c.optional, c.desc);
      else if (!ok && !c.optional) console.log(`  ! failed: ${c.desc}. Run the command above by hand, then --doctor.`);
      // An optional step (Bun) that fails only means Context Mode runs on Node; nothing to undo.
      if (!ok && c.optional) { console.log('! Bun install failed; Context Mode will run on Node.'); continue; }
      if (!ok) failed++;
      ran.push({ desc: c.desc, ok, undo: c.undo });
    }
  }
  const previous = readState(o.home);
  const state = {
    version: JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version,
    installedAt: previous?.installedAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    options: { agents: o.agents, tools: o.tools, privacy: o.privacy, network: o.network, gh: o.gh, unverified: o.unverified, lang: o.lang, profile: o.profile, adhdAlways: o.adhdAlways, ponytailMode: o.ponytailMode, bun: o.bun },
    files: [...(previous?.files ?? []), ...files],
    commands: [...(previous?.commands ?? []), ...ran],
  };
  fs.mkdirSync(stateDir(o.home), { recursive: true });
  fs.writeFileSync(path.join(stateDir(o.home), 'state.json'), `${JSON.stringify(state, null, 2)}\n`);
  if (failed) {
    console.log(`\n${failed} step(s) failed; see the lines marked ! above. Backups: ${backupDir}`);
    ui?.summary('Summary', [`${failed} of ${commands.length} commands failed`, `Backups: ${backupDir}`], false);
    process.exitCode = 1;
    return;
  }
  console.log(`\nDone. Backups: ${backupDir}`);
  if (o.project) return console.log('Next: review and commit these files. Each teammate runs the installer once for the tools (rtk, context-mode, ...).');
  console.log('Next: restart your agents, log in to your providers, then run --doctor.');
  if (o.tools.includes('playwright-extension')) console.log(`Signed-in browser: ${EXTENSION_NOTE}`);
  if (o.gh) console.log('GitHub CLI: run `gh auth login` yourself; lean-agents never handles tokens.');
  for (const n of o.notes) console.log(`Notes saved: ${n.path}. Ask your agent to apply them, showing you each change first.`);
  if (o.network.telemetry === 'off' && o.agents.includes('claude')) {
    console.log('Strict privacy: also turn off "Help improve Claude" in your claude.ai privacy settings.');
  }
  if (o.network.telemetry === 'off' && o.agents.includes('copilot-cli')) {
    console.log('Strict privacy: Copilot CLI has no telemetry setting. Start it with --disable-client-telemetry.');
  }
  if (o.network.telemetry === 'off' && o.agents.includes('cursor')) {
    console.log('Strict privacy: turn on Privacy Mode in Cursor settings. It is stored on your account.');
  }
  if (o.network.telemetry === 'off' && o.agents.includes('antigravity')) {
    console.log('Strict privacy: turn off "Enable Telemetry" in Antigravity settings. It is stored on your account.');
  }
  if (o.network.autoUpdate === 'off' && o.agents.includes('antigravity')) {
    console.log('Auto-updates off: Antigravity CLI updates itself and has no documented switch for it.');
  }
  ui?.summary('Summary', [`${files.length} files written, ${ran.length} commands run`, `Backups: ${backupDir}`], true);
}

async function uninstall(o) {
  const state = readState(o.home);
  if (!state) { console.log('lean-agents is not installed.'); return; }
  const p = await prompter(o.yes);
  console.log(`This restores ${state.files.length} files and undoes ${state.commands.length} commands.`);
  if (o.dryRun || !yesNo(await p.ask('Uninstall?', o.yes ? 'y' : 'n'))) { p.close(); console.log('Nothing changed.'); return; }
  p.close();
  if (!o.exec && state.commands.length) throw new Error('--no-exec cannot undo the commands this install ran; run --uninstall without it');
  if (o.exec) {
    for (const c of [...state.commands].reverse()) {
      for (const argv of c.undo ?? []) {
        if (!run(argv, { dryRun: false, log: console.log })) {
          console.log('  ! failed. Run the command above by hand.');
          process.exitCode = 1;
        }
      }
    }
  }
  for (const [what, file] of undo(state.files)) console.log(`  ${what.padEnd(20)} ${file}`);
  fs.renameSync(path.join(stateDir(o.home), 'state.json'), path.join(stateDir(o.home), `state.uninstalled-${Date.now()}.json`));
  console.log('Uninstalled. Backups are kept in ~/.config/lean-agents/backups.');
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  // A repository gets files only: tools and agents stay per user.
  if (o.project && o.agents?.length) throw new Error('--project writes repository files only: run --agents in a separate install');
  if (o.project) { project = o.project; o.agents = []; o.exec = false; }
  isolate(o.home);
  shareProxy();
  if (o.command === 'help') return console.log(HELP);
  if (o.command === 'doctor') return process.exit(doctor({ home: o.home, state: readState(o.home), exec: o.exec }) ? 0 : 1);
  if (o.command === 'uninstall') return uninstall(o);
  return install(o);
}

main().catch((e) => {
  console.error(`lean-agents: ${e.message}`);
  process.exit(1);
});
