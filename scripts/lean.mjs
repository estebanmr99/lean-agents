#!/usr/bin/env node
// lean-agents engine: plan, apply, update, uninstall and doctor.
// `npx lean-agents` runs this file; install.sh / install.ps1 make sure Node and a verified release exist, then call it.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import tty from 'node:tty';
import { fileURLToPath } from 'node:url';
import { plan, apply, undo, describe, writePrivate, privateDir, dropBackups } from './lib/fsops.mjs';
import { loadCore, renderRules, loadProfile, useToolNode } from './lib/render.mjs';
import { claudeAdapter } from './lib/adapters/claude.mjs';
import { opencodeV1Adapter } from './lib/adapters/opencode-v1.mjs';
import { opencodeV2Adapter } from './lib/adapters/opencode-v2.mjs';
import { copilotAdapter } from './lib/adapters/copilot-cli.mjs';
import { antigravityAdapter } from './lib/adapters/antigravity.mjs';
import { vscodeCopilotAdapter } from './lib/adapters/vscode-copilot.mjs';
import { cursorAdapter } from './lib/adapters/cursor.mjs';
import { projectPlan, projectStateDir } from './lib/project.mjs';
import { gsdPlan } from './lib/gsd.mjs';
import { MIGRATE_SOURCES, MIGRATE_TARGETS, readSource, detectSources, migratePlan, finishRows, formatTable } from './lib/migrate.mjs';
import { adhdCommand } from './lib/adhd.mjs';
import { version as binVersion, gitHint, detectAgents, packageManager, prereqFor, antigravityPrereqs, bunInstall, bunPresent, which, run, quiet, exists, isolate, configHome, envDir } from './lib/system.mjs';
import { doctor } from './lib/doctor.mjs';
import { adopt, inventory } from './lib/adopt.mjs';
import { upgradeInventory, formatUpgrade } from './lib/upgrade.mjs';
import { copilotUsage } from './lib/copilot-usage.mjs';
import { draftIssue } from './lib/feedback.mjs';
import { pinVersions, behindPins, pinTool, nodeRange, npmSpec } from './lib/pins.mjs';
import { findNvm, resolveToolNodes, nvmLatest, nvmInstallArgv, nvmEnv, toolEnv } from './lib/node-runtime.mjs';
import { leanUpdateCommands, coordinateCommands, leanMigrateCommands } from './lib/lean-update.mjs';
import { canUseMenus, menuPrompter, menuProgress } from './lib/ui.mjs';
import { CATEGORIES, preset, onOff, fromPrivacy, privacyOf, childEnv, shareProxy, proxyReport } from './lib/network.mjs';
import { unverifiedItems, notesFile } from './lib/unverified.mjs';
import { detectTerminals, parseTerminal, terminalCommands, terminalPrivacyNotes, orcaEnvSet, gitBashActions, stillNeeded, shellNotice } from './lib/terminals.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ADAPTERS = { claude: claudeAdapter, 'opencode-v1': opencodeV1Adapter, 'opencode-v2': opencodeV2Adapter, 'copilot-cli': copilotAdapter, antigravity: antigravityAdapter };
// Agents whose models do not depend on --profile.
const FIXED_PROFILE = { claude: 'claude-subscription', 'copilot-cli': 'github-copilot', antigravity: 'antigravity' };
Object.assign(ADAPTERS, { 'vscode-copilot': vscodeCopilotAdapter, cursor: cursorAdapter });
FIXED_PROFILE['vscode-copilot'] = 'github-copilot';
// Extensions cannot be installed silently without admin policy, so the user installs it.
const EXTENSION_NOTE = 'install the Playwright Extension yourself from https://chromewebstore.google.com/detail/playwright-extension/mmlmfjhmonkocbjadbfplnigmagldckm . Each session asks you to approve the connection; optional auto-approve: docs/browser-extension.md';
const MINIMAL_TOOLS = ['rtk', 'context-mode'];
const OPTIONAL_TOOLS = ['serena', 'playwright', 'ponytail', 'caveman', 'i-have-adhd', 'dcp', 'codeburn', 'copilot-usage'];
// Asked for one by one and never part of --all-tools.
const OPT_IN_TOOLS = ['gsd', 'autoskills', 'playwright-extension', 'coordinate', 'lean-migrate'];
const TOOL_INFO = {
  serena: 'Serena MCP: symbol-level code navigation, so agents read less code',
  playwright: 'Playwright MCP: lets agents drive a browser to check web UIs',
  'playwright-extension': 'Playwright MCP extension mode: attaches to your own signed-in Chrome (pages behind single sign-on); not for Claude Code, which has Claude in Chrome',
  ponytail: 'Ponytail: code-quality guidance injected each turn (lite mode recommended)',
  caveman: 'Caveman skills: extra-compressed answers when you ask for them',
  'i-have-adhd': 'i-have-adhd: skimmable, action-first formatting for every answer',
  dcp: 'DCP: prunes old context on OpenCode 1.x (AGPL-3.0)',
  codeburn: 'Codeburn: usage and cost report across agents, run with npx',
  'copilot-usage': 'Copilot usage: credits left in the OpenCode sidebar and /copilot-usage, read with gh, no model request (needs gh login; off with --outbound off)',
  gsd: 'GSD Core: spec-driven workflow skills and agents (large install)',
  'lean-migrate': 'lean-migrate skill: guides the OpenCode 1.x to 2.x upgrade through --upgrade-agent opencode (dry run first)',
  coordinate: 'Coordinate skill: playbook, session prompt and watcher to run several agents in separate git worktrees',
  autoskills: 'AutoSkills: picks skills per project, run with npx (CC BY-NC 4.0: non-commercial use only)',
};

// Read before isolate() points HOME at --home.
const REAL_HOME = os.homedir();

function parseArgs(argv) {
  const o = {
    command: 'install', dryRun: false, yes: false, agents: null, tools: null, privacy: null, profile: null,
    lang: null, home: os.homedir(), exec: true, adhdAlways: null, ponytailMode: null, shell: null,
    networkPreset: null, networkFlags: {}, gh: null, bun: null, terminals: null, app: true, core: true,
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
      case '--no-core': o.core = false; break;
      case '--terminal': o.terminals = parseTerminal(next()); break;
      case '--bun': o.bun = true; break;
      case '--no-bun': o.bun = false; break;
      case '--no-app': o.app = false; break;
      case '--privacy': o.privacy = next(); fromPrivacy(o.privacy); break;
      case '--gh': o.gh = true; break;
      case '--no-gh': o.gh = false; break;
      case '--json': o.json = true; break;
      case '--feedback-draft': o.command = 'feedback'; break;
      case '--failed-command': o.failedCommand = next(); break;
      case '--feedback-kind': o.feedbackKind = next(); break;
      case '--network': o.networkPreset = onOff(a, next()); break;
      case '--telemetry': o.networkFlags.telemetry = onOff(a, next()); break;
      case '--auto-update': o.networkFlags.autoUpdate = onOff(a, next()); break;
      case '--outbound': o.networkFlags.outbound = onOff(a, next()); break;
      case '--profile': o.profile = next(); break;
      case '--lang': o.lang = next(); break;
      case '--home': o.home = path.resolve(next()); break;
      // realpath: the state dir is keyed by this path, and /var and /private/var are one folder on macOS.
      case '--project': o.project = fs.realpathSync(path.resolve(next())); break;
      case '--migrate': o.migrate = next(); if (o.migrate !== 'auto' && !MIGRATE_SOURCES.includes(o.migrate)) throw new Error(`unknown --migrate source "${o.migrate}" (available: ${[...MIGRATE_SOURCES, 'auto'].join(', ')})`); break;
      case '--no-exec': o.exec = false; break;
      case '--shell': o.shell = next(); if (!['default', 'git-bash'].includes(o.shell)) throw new Error('--shell takes default or git-bash'); break;
      case '--adhd-always': o.adhdAlways = true; break;
      case '--ponytail-mode': o.ponytailMode = next(); break;
      case '--update': o.command = 'update'; break;
      case '--uninstall': o.command = 'uninstall'; break;
      case '--doctor': o.command = 'doctor'; break;
      case '--adopt': o.command = 'adopt'; break;
      case '--upgrade-agent': o.command = 'upgrade-agent'; o.upgradeAgent = next(); if (o.upgradeAgent !== 'opencode') throw new Error('--upgrade-agent takes opencode'); break;
      case '--undo': o.undo = true; break;
      case '--keep-backup': o.keepBackup = true; break;
      case '--confirm-removals': o.confirmRemovals = true; break;
      case '--usage': o.command = 'usage'; break;
      case '--skip-agents': case '--no-admin': break; // defaults in v1: agents are never installed, nothing needs admin
      case '--help': case '-h': o.command = 'help'; break;
      case '--version': o.command = 'version'; break;
      default: throw new Error(`unknown option ${a} (see --help)`);
    }
  }
  if (!o.core && o.tools) o.tools = o.tools.filter((t) => !MINIMAL_TOOLS.includes(t));
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
  --no-core              Leave out ${MINIMAL_TOOLS.join(' and ')}; install only the --tools you list
  --privacy standard|strict  Same as --network on / --network off
  --network on|off       Preset for telemetry, auto-updates and other outbound calls
  --telemetry on|off, --auto-update on|off, --outbound on|off
                         One category; overrides the preset
  --profile <name>       Model profile for OpenCode (see profiles/)
  --lang en|es           Language for rules and replies
  --terminal warp|orca|both|none
                         Agent integrations for a terminal you already have (default: the detected ones;
                         ignored with --project)
  --gh / --no-gh         Install GitHub CLI (gh) if it is missing (default: on; you run gh auth login yourself)
  --feedback-draft       After a failed install: read the error on stdin, print a redacted issue draft as JSON
                         (--feedback-kind update: the text is a finding from an update, not an error)
                         ({"offer":false} when the network preset forbids it). Needs --failed-command <text>;
                         pass --network on|off when nothing is installed yet. Files nothing.
  --json                 With --dry-run or --doctor: print one JSON object on stdout (messages go to stderr)
  --no-app               Do not install the Antigravity app (the CLI is still installed when missing)
  --bun / --no-bun       Install Bun for Context Mode (default: on; faster JS, TypeScript)
  --project <dir>        Write the shared team files into one repository
                         (AGENTS.md, .github/, .vscode/mcp.json, .cursor/)
  --migrate <from|auto>  Copy rules, agents, skills, prompts and MCP servers from another harness
                         (${MIGRATE_SOURCES.join(', ')}) to --agents. With --project, from and to the repository.
                         Never moves or overwrites; MCP env and header values are not copied; hooks are only listed
  --adhd-always          Turn on i-have-adhd for every answer
  --ponytail-mode lite|full|ultra|off
  --shell default|git-bash  OpenCode on Windows: set its shell to Git Bash when found (default: git-bash;
                         never overwrites a shell you set yourself; "default" opts out)
  --update               Re-apply with your saved choices
  --uninstall            Undo everything lean-agents changed
  --doctor               Check the install
  --adopt                List what a hand-built machine already has (MCPs, hooks, plugins, skills, npm copies),
                         classify each (managed, user, stale, duplicate, drift, wrong-node) and print the planned
                         actions; changes nothing (with --json: one JSON object). Always pass --home to try it
  --adopt --yes          Apply it: back up, re-register managed MCPs on one Node, verify, undo by itself on a failure
  --confirm-removals     With --adopt --yes and no terminal: also remove old npm copies, a duplicate skill folder and
                         hand-made stopgaps (all backed up; on a terminal a menu asks instead)
  --keep-backup          Keep the backup after a verified --adopt --yes (--adopt --undo needs it to restore bytes)
  --upgrade-agent opencode  Dry run: classify the OpenCode 1.x config as managed, translatable to 2.x or manual and print the
                         translation table; changes nothing (with --json: one JSON object). Apply and --undo come later
  --undo                 With --adopt: restore what the last --adopt --yes changed
  --version              Print the lean-agents version
  --usage                Print the Copilot credits left (one gh call, no model request)
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
// Where the engine may write: home, the project, and the config dirs envDir() accepts.
const writeRoots = (o) => [o.home, o.project, configHome(o.home), envDir(o.home, 'COPILOT_HOME', null)].filter(Boolean);
function readState(home) {
  const f = path.join(stateDir(home), 'state.json');
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null;
}

// LEAN_AGENTS_NODE fakes the Node version, so tests do not depend on the host.
const NODE_VERSION = process.env.LEAN_AGENTS_NODE ?? process.versions.node;
// [tool, pin] pairs whose pin declares an engines.node range lean-agents runs on a matching Node (wired in prereqCommands, gsd.mjs, claude.mjs and copilot-cli.mjs).
const NODE_TOOLS = [['context-mode', 'context-mode'], ['gsd', 'gsd-core']];

// Migration copies files only: no tools, terminals, network or model questions.
async function chooseMigration(o, p) {
  if (!o.agents) {
    // Antigravity has no project scope: never auto-pick it for --project.
    const found = Object.keys(detectAgents()).filter((a) => MIGRATE_TARGETS.includes(a) && !(o.project && a === 'antigravity'));
    if (!found.length) throw new Error('no target agent found on PATH: pass --agents');
    o.agents = found;
  }
  for (const a of o.agents) if (!MIGRATE_TARGETS.includes(a)) throw new Error(`cannot migrate to "${a}" (available: ${MIGRATE_TARGETS.join(', ')})`);
  if (o.agents.includes('opencode-v1') && o.agents.includes('opencode-v2')) throw new Error('opencode-v1 and opencode-v2 write the same config files: pick one');
  Object.assign(o, { tools: [], terminals: [], network: preset('on'), privacy: 'standard', unverified: {}, notes: [], gh: false, bun: false, lang: 'en', profile: null });
  return p;
}

async function choose(o, saved) {
  const p = await prompter(o.yes);
  if (o.migrate) return chooseMigration(o, p);
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
    o.tools = saved?.tools ?? (o.core ? [...MINIMAL_TOOLS] : []);
    if (!saved) {
      const offered = [...OPTIONAL_TOOLS, ...OPT_IN_TOOLS].filter((t) => t !== 'dcp' || o.agents.includes('opencode-v1'));
      const items = offered.map((t) => ({ value: t, label: t, hint: TOOL_INFO[t].replace(/^[^:]+: /, ''), ask: `Add ${TOOL_INFO[t]}?` }));
      const message = o.core ? `Optional tools (${MINIMAL_TOOLS.join(' and ')} are always included)` : 'Tools (--no-core: nothing else is added)';
      o.tools.push(...await p.multi({ message, items, defaults: [] }));
    }
  }
  if (!o.core) o.tools = o.tools.filter((t) => !MINIMAL_TOOLS.includes(t));
  const known = [...MINIMAL_TOOLS, ...OPTIONAL_TOOLS, ...OPT_IN_TOOLS];
  const unknown = o.tools.filter((t) => !known.includes(t));
  if (unknown.length) throw new Error(`unknown tools: ${unknown.join(', ')} (available: ${known.join(', ')})`);
  if (!o.agents.includes('opencode-v1')) o.tools = o.tools.filter((t) => t !== 'dcp');
  // The saved choice keeps Context Mode, so --update installs it once Node is new enough.
  o.chosenTools = o.tools;
  // Tools whose Node range the active Node fails run on an nvm Node of their own, or are skipped with one line.
  const needs = Object.fromEntries(NODE_TOOLS.filter(([tool]) => o.tools.includes(tool)).map(([tool, pin]) => [tool, { node: nodeRange(pin) }]));
  const nvm = findNvm({ env: process.env, home: o.home, platform: process.platform, realHome: REAL_HOME });
  o.nvm = nvm;
  const resolved = resolveToolNodes({ pins: needs, active: NODE_VERSION, nvm, latest: (major) => nvmLatest(nvm, major, { run: quiet }) });
  for (const s of resolved.skipped) console.log(s.line);
  o.tools = o.tools.filter((t) => !resolved.skipped.some((s) => s.tool === t));
  o.toolNode = resolved.toolNode && { ...resolved.toolNode, nvmDir: nvm.dir };
  if (o.toolNode && o.agents.includes('claude') && o.tools.includes('context-mode')) console.log('Context Mode on Claude Code runs as an MCP server on its own Node: its hooks and skills (the plugin) are not installed.');
  if (o.project) o.terminals = [];
  else if (!o.terminals) {
    // Terminals are never installed, only detected; nothing found means no question.
    const found = detectTerminals(o.home, { system: o.home === REAL_HOME });
    o.terminals = saved ? saved.terminals ?? [] : found;
    if (!saved && found.length) {
      const items = found.map((t) => ({ value: t, label: t, ask: `Add the ${t} agent integration?` }));
      o.terminals = await p.multi({ message: 'Terminals found: add their agent integrations', items, defaults: found });
    }
  }
  await chooseNetwork(o, saved, p);
  if (o.network.outbound === 'off' && o.tools.includes('copilot-usage')) {
    console.log('copilot-usage skipped: it calls api.github.com, which --outbound off blocks.');
    o.tools = o.tools.filter((t) => t !== 'copilot-usage');
  }
  await chooseUnverified(o, saved, p);
  o.gh ??= saved?.gh ?? (!which('gh') && yesNo(await p.ask('Install GitHub CLI (gh)? You log in yourself afterwards', 'y')));
  if (o.tools.includes('copilot-usage') && !o.gh && !which('gh')) console.log('copilot-usage needs gh to read your credits: install it yourself (https://cli.github.com/) and run gh auth login.');
  if (o.tools.includes('context-mode') && !o.project) o.bun ??= saved?.bun ?? (bunPresent(o.home) || yesNo(await p.ask('Install Bun so Context Mode runs faster?', 'y')));
  o.lang ??= saved?.lang ?? (await p.select({ ask: 'Language for rules and replies (en/es)?', message: 'Language for rules and replies', options: [{ value: 'en', label: 'English' }, { value: 'es', label: 'Español' }], def: 'en' }));
  if (o.agents.some((a) => a.startsWith('opencode')) && !o.profile) {
    const profiles = ['github-copilot', 'vertex-gemini', 'anthropic-api', 'opencode-go', 'openai-api', 'none'];
    o.profile = saved?.profile ?? (await p.select({ ask: `OpenCode model profile (${profiles.join(', ')})?`, message: 'OpenCode model profile', options: profiles.map((v) => ({ value: v })), def: 'none' }));
  }
  if (o.profile === 'none') o.profile = null;
  if (o.tools.includes('i-have-adhd')) o.adhdAlways ??= saved?.adhdAlways ?? yesNo(await p.ask('Use i-have-adhd on every answer?', 'y'));
  if (o.tools.includes('ponytail')) o.ponytailMode ??= saved?.ponytailMode ?? (await p.select({ ask: 'Ponytail default mode (lite/full/ultra/off)?', message: 'Ponytail default mode', options: ['lite', 'full', 'ultra', 'off'].map((v) => ({ value: v })), def: 'lite' }));
  // On by default, never asked: --shell default opts out.
  o.shell ??= saved?.shell ?? 'git-bash';
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

function migrationPlan(o) {
  const scope = o.project ? 'project' : 'user';
  const base = o.project ?? o.home;
  const names = o.migrate === 'auto' ? detectSources(base, scope, o.agents) : [o.migrate];
  const r = migratePlan({ sources: names.map((n) => readSource(n, base, scope)), targets: o.agents, base, scope, stateDir: stateDir(o.home) });
  const planned = plan(r.actions, writeRoots(o));
  return { planned, commands: r.commands, migration: { ...r, rows: finishRows(r.rows, planned, o.exec), base, names } };
}

function buildPlan(o) {
  if (o.migrate) return migrationPlan(o);
  if (o.project) {
    const r = projectPlan(ROOT, o.project, o);
    return { planned: plan(r.actions, writeRoots(o), readState(o.home)?.files), commands: r.commands };
  }
  o.prior = readState(o.home)?.commands ?? [];
  const core = useToolNode(loadCore(ROOT), o.toolNode, o.nvm);
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
  commands.push(...leanUpdateCommands(o.agents));
  if (o.tools.includes('coordinate')) commands.push(...coordinateCommands(o.agents));
  if (o.tools.includes('lean-migrate')) commands.push(...leanMigrateCommands(o.agents));
  commands.push(...terminalCommands({ terminals: o.terminals, agents: o.agents, network: o.network, system: o.home === REAL_HOME }));
  actions.push(...gitBashActions({ home: o.home, terminals: o.terminals, agents: o.agents }));
  if (o.tools.includes('gsd')) {
    const r = gsdPlan(ROOT, o.home, o);
    actions.push(...r.actions);
    commands.push(...r.commands);
  }
  if (o.bun && o.network.telemetry === 'off') {
    actions.push({ kind: 'block', toml: true, path: path.join(o.home, '.bunfig.toml'), body: 'telemetry = false' });
  }
  return { planned: plan(actions, writeRoots(o), readState(o.home)?.files), commands };
}

// `behind`: tools whose pinned version is newer than the installed one (--update); their installs run even when the binary is there.
function prereqCommands(o, behind = new Set()) {
  const pm = packageManager();
  const out = [];
  const tn = o.toolNode;
  if (tn?.install) out.push({ tool: 'node', desc: `install Node ${tn.install} with nvm (your default Node stays as it is)`, run: [nvmInstallArgv(tn.install)], undo: [], env: nvmEnv(tn.nvmDir) });
  for (const t of [...o.tools, ...(o.gh ? ['gh'] : [])]) {
    if (t === 'context-mode' && tn) {
      const prefix = ['--prefix', tn.dir];
      out.push({ tool: t, desc: `install context-mode on Node ${tn.version}`, run: [[tn.node, tn.npmCli, 'install', '-g', ...prefix, npmSpec('context-mode')]], undo: [[tn.node, tn.npmCli, 'uninstall', '-g', ...prefix, 'context-mode']], skipIfExists: path.join(tn.modules, 'context-mode', 'package.json'), env: toolEnv(tn) });
      continue;
    }
    const p = prereqFor(t, pm);
    if (!p || (which(p.bin) && !behind.has(t))) continue;
    if (p.install) out.push({ tool: t, desc: `install ${p.bin}`, run: p.install, undo: [], optional: t === 'gh' });
    else out.push({ tool: t, desc: `${p.bin} is missing: install it from ${p.manual}`, run: [], undo: [], manual: true, optional: t === 'gh' });
  }
  if (o.agents.includes('antigravity')) {
    for (const c of antigravityPrereqs(pm, process.platform, o.home, o.app)) {
      if (c.note) console.log(c.desc);
      else out.push({ tool: 'antigravity', undo: [], ...c });
    }
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

function printMigration(o, m, commands) {
  const rel = (p) => (p.startsWith(o.home) ? `~${p.slice(o.home.length)}` : p.startsWith(m.base) ? `.${p.slice(m.base.length)}` : p);
  console.log(`\nlean-agents migration: ${m.names.join(', ')} -> ${o.agents.join(', ')}${o.project ? ` (project ${o.project})` : ''}`);
  console.log(formatTable(m.rows, rel));
  if (m.env.length) console.log(`\nSet these env vars before you start your agents (values are never copied): ${m.env.join(', ')}`);
  if (m.headers.length) console.log(`Add these MCP headers by hand: ${m.headers.join('; ')}`);
  if (commands.some((c) => c.run.length)) console.log('\nCommands:');
  for (const c of commands) for (const argv of c.run) console.log(`  $ ${argv.join(' ')}`);
  console.log('');
}

// Agents parse this instead of scraping the text plan. Paths use ~ so no home directory leaks.
function printJson(o, planned, commands, migration, behind) {
  const rel = (t) => (t.startsWith(o.home + path.sep) || t === o.home ? `~${t.slice(o.home.length)}` : t);
  const inText = (t) => t.split(o.home).join('~');
  const plan = {
    agents: o.agents, tools: o.tools, privacy: o.privacy, lang: o.lang, profile: o.profile ?? null, terminals: o.terminals,
    gh: !!o.gh, bun: !!o.bun, network: o.network, migrate: migration ? migration.names : null,
    files: planned.map((f) => ({ status: f.status, path: rel(f.path), note: f.note ?? null })),
    commands: commands.map((c) => ({ desc: inText(c.desc), agent: c.agent ?? null, run: c.run.map((a) => a.map(inText)) })),
    ...(behind && { behind }),
  };
  process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
}

function printPlan(o, planned, commands) {
  console.log(`\nlean-agents plan for ${o.agents.join(', ') || 'no agents'}`);
  if (o.project) console.log(`  project: ${o.project}`);
  console.log(`  tools: ${o.tools.join(', ') || 'none'} | privacy: ${o.privacy} | lang: ${o.lang} | profile: ${o.profile ?? 'none'}`);
  if (o.terminals.length) console.log(`  terminals: ${o.terminals.join(', ')}`);
  if (o.network.telemetry === 'off') for (const n of terminalPrivacyNotes(o.terminals, { orcaEnvSet: orcaEnvSet({ system: o.home === REAL_HOME }) })) console.log(`  ${n}`);
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
  if (o.json && !o.yes) throw new Error('--json needs --yes: the menus would write questions to stdout');
  const saved = o.command === 'update' ? readState(o.home) : null;
  if (o.command === 'update' && !saved) throw new Error('nothing to update: lean-agents is not installed');
  if (o.command === 'update' && saved.options.migrateOnly) throw new Error('nothing to update: only --migrate ran here');
  const p = await choose(o, saved?.options);
  const { planned, commands: agentCommands, migration } = buildPlan(o);
  if (migration && !migration.rows.length) { p.close(); console.log('Nothing to migrate: no rules, agents, skills, prompts, MCP servers or hooks found.'); return; }
  const behind = new Set((saved ? behindPins(saved) : []).map((b) => pinTool(b.tool)));
  const commands = [...(o.exec ? prereqCommands(o, behind) : []), ...agentCommands];
  const noGit = migration ? null : gitHint(packageManager());
  if (noGit) console.log(noGit);
  if (o.json) {
    if (!o.dryRun) throw new Error('--json needs --dry-run (or --doctor)');
    p.close();
    return printJson(o, planned, commands, migration, saved ? behindPins(saved) : undefined);
  }
  if (migration) printMigration(o, migration, o.exec ? commands : []);
  else printPlan(o, planned, commands);
  if (saved && behindPins(saved).length) console.log('Pins that will change (old -> new):');
  if (saved) for (const b of behindPins(saved)) console.log(`${b.tool}: ${b.installed} -> ${b.pinned}`);
  if (o.dryRun) { p.close(); console.log('Dry run: nothing was changed.'); return; }
  if (!yesNo(await p.ask('Apply these changes?', 'y'))) { p.close(); console.log('Cancelled.'); return; }
  p.close();
  const ui = p.menus ? await menuProgress() : null;
  Object.assign(process.env, childEnv(o.network));

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = path.join(stateDir(o.home), 'backups', stamp);
  const files = apply(planned, backupDir, o.home, writeRoots(o));
  const ran = [];
  let failed = 0;
  if (o.exec) {
    for (const [i, c] of commands.entries()) {
      // gh is on by default, so having no installer for it (no brew or winget) must not fail the run.
      if (c.manual) { console.log(`! ${c.desc}`); if (!c.optional) failed++; continue; }
      const there = (c.skipIfExists && exists(c.skipIfExists)) || (c.skipIfOutput && quiet(c.skipIfOutput.cmd).ok);
      if (there) {
        if (!behind.has(c.tool)) continue;
        // Installed at an older pin: undo it, then add it again at the new pin.
        if (!c.undo.every((argv) => run(argv, { dryRun: false, log: console.log, env: c.env }))) {
          console.log(`  ! could not remove the old ${c.desc}; left as it is. Fix it by hand, then --update.`);
          failed++;
          continue;
        }
      }
      if (ui) ui.step(i + 1, commands.length, c.desc);
      else console.log(`- ${c.desc}`);
      const ok = c.run.every((argv) => run(argv, { dryRun: false, log: console.log, env: c.env }));
      if (ui) ui.result(ok || c.optional, c.desc);
      else if (!ok && !c.optional) console.log(`  ! failed: ${c.desc}. Run the command above by hand, then --doctor.`);
      // An optional step (Bun) that fails only means Context Mode runs on Node; nothing to undo.
      if (!ok && c.optional) { console.log(c.tool === 'gh' ? '! gh install failed; install it yourself (--no-gh skips it).' : c.tool === 'lean-update' ? '! lean-update skill failed to install; run the command above by hand later.' : '! Bun install failed; Context Mode will run on Node.'); continue; }
      if (!ok) failed++;
      ran.push({ desc: c.desc, ok, undo: c.undo, ...(c.env && { env: c.env }) });
    }
  }
  const previous = readState(o.home);
  const state = {
    version: JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version,
    installedAt: previous?.installedAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    pins: pinVersions(),
    options: o.migrate ? previous?.options ?? { migrateOnly: true, agents: o.agents, tools: [], privacy: o.privacy, network: o.network, gh: false, terminals: [], unverified: {}, lang: 'en', profile: null, adhdAlways: false, ponytailMode: null, bun: false, shell: 'git-bash' } : { agents: o.agents, tools: o.chosenTools ?? o.tools, privacy: o.privacy, network: o.network, gh: o.gh, terminals: o.terminals, unverified: o.unverified, lang: o.lang, profile: o.profile, adhdAlways: o.adhdAlways, ponytailMode: o.ponytailMode, bun: o.bun, shell: o.shell },
    ...(o.toolNode && { toolNode: { version: o.toolNode.version, installedByLean: !!o.toolNode.install || (previous?.toolNode?.version === o.toolNode.version && !!previous.toolNode.installedByLean) } }),
    files: [...(previous?.files ?? []), ...files],
    // A command that ran again replaces its earlier record, so --uninstall undoes it once.
    commands: [...(previous?.commands ?? []).filter((c) => !ran.some((r) => r.desc === c.desc)), ...ran],
  };
  privateDir(stateDir(o.home), stateDir(o.home));
  writePrivate(path.join(stateDir(o.home), 'state.json'), `${JSON.stringify(state, null, 2)}\n`);
  if (failed) {
    console.log(`\n${failed} step(s) failed; see the lines marked ! above. Backups: ${backupDir}`);
    ui?.summary('Summary', [`${failed} of ${commands.length} commands failed`, `Backups: ${backupDir}`], false);
    process.exitCode = 1;
    return;
  }
  console.log(`\nDone. Backups: ${backupDir}`);
  if (o.project) return console.log('Next: review and commit these files. Each teammate runs the installer once for the tools (rtk, context-mode, ...).');
  console.log('Next: restart your agents, log in to your providers, then run --doctor.');
  const shell = shellNotice();
  if (shell) console.log(shell.text);
  const todo = stillNeeded({ home: o.home, terminals: o.terminals, agents: o.agents });
  if (todo.length) console.log(`Still needed from you:\n${todo.map((t) => `  - ${t.text}`).join('\n')}`);
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
        if (!run(argv, { dryRun: false, log: console.log, env: c.env })) {
          console.log('  ! failed. Run the command above by hand.');
          process.exitCode = 1;
        }
      }
    }
  }
  if (state.toolNode?.installedByLean) console.log(`Kept Node v${state.toolNode.version} (lean-agents never removes a Node); remove it with \`nvm uninstall ${state.toolNode.version}\`.`);
  const report = undo(state.files, writeRoots(o));
  for (const [what, file] of report) console.log(`  ${what.padEnd(20)} ${file}`);
  if (report.some(([what]) => what === 'left (symlink)')) console.log('  ! Paths marked "left (symlink)" were not touched; remove our lines there by hand.');
  fs.renameSync(path.join(stateDir(o.home), 'state.json'), path.join(stateDir(o.home), `state.uninstalled-${Date.now()}.json`));
  // Backups are the only undo for edits we cannot revert, so they stay unless the user says yes (--yes keeps them).
  const backups = path.join(stateDir(o.home), 'backups');
  const q = await prompter(o.yes);
  const drop = fs.existsSync(backups) && yesNo(await q.ask(`Delete backups in ${backups}?`, 'n'));
  q.close();
  if (drop) dropBackups(backups);
  console.log(drop ? 'Uninstalled. Backups deleted.' : `Uninstalled. Backups are kept in ${backups}.`);
}

// The agent files the issue itself, and only after the user said yes; this only drafts.
function feedback(o) {
  if (!o.failedCommand) throw new Error('--feedback-draft needs --failed-command <text>');
  const state = readState(o.home);
  const network = { ...(o.networkPreset ? preset(o.networkPreset) : fromPrivacy(o.privacy) ?? state?.options.network ?? {}), ...o.networkFlags };
  const versions = { 'lean-agents': JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version, node: NODE_VERSION };
  const draft = draftIssue({ network, home: [o.home, os.homedir()], versions, command: o.failedCommand, error: fs.readFileSync(0, 'utf8'), kind: o.feedbackKind });
  process.stdout.write(`${JSON.stringify(draft ?? { offer: false })}\n`);
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  // A repository gets files only: tools and agents stay per user.
  if (o.project && o.agents?.length && !o.migrate) throw new Error('--project writes repository files only: run --agents in a separate install');
  if (o.project) { project = o.project; if (!o.migrate) { o.agents = []; o.exec = false; } }
  // --json keeps stdout for the one JSON object; every message goes to stderr.
  if (o.json) console.log = console.error;
  isolate(o.home);
  shareProxy();
  if (o.command === 'help') return console.log(HELP);
  if (o.command === 'version') return console.log(JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version);
  if (o.command === 'doctor') return process.exit(doctor({ home: o.home, state: readState(o.home), exec: o.exec, nodeVersion: NODE_VERSION, json: o.json }) ? 0 : 1);
  if (o.command === 'upgrade-agent') {
    if (o.undo || (o.yes && !o.dryRun)) throw new Error('--upgrade-agent opencode apply and --undo are not in this release yet; it only lists (dry run)');
    const env = process.env;
    const inv = await inventory({ home: o.home, env, realHome: REAL_HOME });
    const bin = which('opencode');
    const r = upgradeInventory(inv, { home: o.home, binary: { path: bin, version: bin && o.exec ? binVersion('opencode') : null } });
    if (o.json) process.stdout.write(`${JSON.stringify(r, null, 2)}\n`); else console.log(formatUpgrade(r));
    return process.exit(0);
  }
  if ((o.undo || o.keepBackup || o.confirmRemovals) && o.command !== 'adopt') throw new Error('--undo, --keep-backup and --confirm-removals go with --adopt');
  if (o.command === 'adopt') {
    // Removals outside the JSON edits need a yes: a menu on a terminal, --confirm-removals without one.
    const tty = process.stdin.isTTY && process.stdout.isTTY && !o.json;
    const p = o.yes && !o.confirmRemovals && tty ? await prompter(false) : null;
    const confirm = o.confirmRemovals ? async () => true : p ? async (q) => yesNo(await p.ask(q, 'n')) : async () => false;
    const ok = await adopt({ home: o.home, json: o.json, realHome: REAL_HOME, yes: o.yes, dryRun: o.dryRun, undo: o.undo, keepBackup: o.keepBackup, exec: o.exec, confirm, stateDir: stateDir(o.home) });
    p?.close();
    return process.exit(ok ? 0 : 1);
  }
  if (o.command === 'usage') {
    const network = { ...(o.networkPreset ? preset(o.networkPreset) : fromPrivacy(o.privacy) ?? readState(o.home)?.options.network ?? {}), ...o.networkFlags };
    return console.log(network.outbound === 'off' ? 'usage skipped: outbound calls are off (no request to api.github.com)' : copilotUsage());
  }
  if (o.command === 'feedback') return feedback(o);
  if (o.command === 'uninstall') return uninstall(o);
  return install(o);
}

main().catch((e) => {
  console.error(`lean-agents: ${e.message}`);
  process.exit(1);
});
