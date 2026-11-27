#!/usr/bin/env node
// lean-agents engine: plan, apply, update, uninstall and doctor.
// `npx lean-agents` runs this file; install.sh / install.ps1 make sure Node and a verified release exist, then call it.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import tty from 'node:tty';
import { fileURLToPath } from 'node:url';
import { parse as parseJsonc } from 'jsonc-parser';
import { plan, apply, undo, describe, tilde, sha, userHash, managedUserHash, writePrivate, privateDir, dropBackups, renameRetry } from './lib/fsops.mjs';
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
import { version as binVersion, versionFull, gitHint, detectAgents, packageManager, prereqFor, antigravityPrereqs, cursorAppPrereqs, bunInstall, bunPathCommand, bunPresent, rtkInstall, which, run, quiet, exists, isolate, configHome, envDir } from './lib/system.mjs';
import { doctor } from './lib/doctor.mjs';
import { preflight, formatPreflight } from './lib/preflight.mjs';
import { probePlugins } from './lib/plugin-health.mjs';
import { adopt, inventory, saveState } from './lib/adopt.mjs';
import { planPrereqs, pendingPrereqs, everythingAgents, undoArgv, nvmDirExistedBefore } from './lib/prereqs.mjs';
import { upgradeInventory, formatUpgrade, nextRtkStep } from './lib/upgrade.mjs';
import { backupOpencode, backupLayout, listProcesses, opencodeRunning, opencodePids, runningBlocker, serviceStopRow, OPENCODE_RUNNING } from './lib/opencode-backup.mjs';
import { readBackupStamp } from './lib/backup-stamp.mjs';
import { isActive, failAt, applyPreflight, verifyBackup, configDrift, createSteps, makeCtx, runApply, runUndo, restoreData } from './lib/opencode-upgrade.mjs';
import { planOpencode1, installOpencode1, removeOpencode1, layout as opencode1Layout } from './lib/opencode1.mjs';
import { posixPathBlock } from './lib/shell-path.mjs';
import { agentLifecycle, agentTable, upgradeCommands, undoPlan, undoUpgrades, agentOf, agentStamps, VSCODE_NOTE, AGENT_CLIS } from './lib/agent-lifecycle.mjs';
import { copilotUsage } from './lib/copilot-usage.mjs';
import { draftIssue, addFiledIssue } from './lib/feedback.mjs';
import { buildSummary } from './lib/summary-data.mjs';
import { loginRows } from './lib/logins.mjs';
import { renderSummary, canOffer, openArgv } from './lib/summary-html.mjs';
import { redactText } from './lib/redact.mjs';
import { planUpdate, appUpdateRows, appAdoptQuestion, appAdoptHint, appAdoptAction, changelogNotes, formatUpdatePlan } from './lib/update-plan.mjs';
import { PINS, pinVersions, behindPins, pinTool, nodeRange, npmSpec, rtkPin, rtkTooOld } from './lib/pins.mjs';
import { findNvm, installedNodes, nodeFloorFix, resolveToolNodes, nvmLatest, nvmInstallArgv, nvmEnv, toolEnv, satisfies, compare } from './lib/node-runtime.mjs';
import { leanUpdateCommands, coordinateCommands, leanMigrateCommands } from './lib/lean-update.mjs';
import { canUseMenus, menuPrompter, menuProgress } from './lib/ui.mjs';
import { CATEGORIES, preset, onOff, fromPrivacy, privacyOf, childEnv, shareProxy, proxyReport } from './lib/network.mjs';
import { unverifiedItems, notesFile } from './lib/unverified.mjs';
import { detectTerminals, TERMINALS, parseTerminal, terminalCommands, installedAppVersions, appUpdateTarget, appRunning, terminalPrivacyNotes, orcaEnvSet, gitBashActions, stillNeeded, shellNotice } from './lib/terminals.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ADAPTERS = { claude: claudeAdapter, 'opencode-v1': opencodeV1Adapter, 'opencode-v2': opencodeV2Adapter, 'copilot-cli': copilotAdapter, antigravity: antigravityAdapter };
// Agents whose models do not depend on --profile.
const FIXED_PROFILE = { claude: 'claude-subscription', 'copilot-cli': 'github-copilot', antigravity: 'antigravity' };
Object.assign(ADAPTERS, { 'vscode-copilot': vscodeCopilotAdapter, cursor: cursorAdapter });
FIXED_PROFILE['vscode-copilot'] = 'github-copilot';
// Extensions cannot be installed silently without admin policy, so the user installs it.
const CODE_MODE_NOTE = 'Claude Code Code Mode is experimental (Claude Code 2.1.323 or newer, interactive terminal only, a direct Anthropic subscription or Console login; not Vertex, Bedrock or a gateway). Remote Control, Claude in Chrome, computer use and the VS Code panel do not work while it is on; RTK and Context Mode do. A session started with it resumes only with it on; --uninstall turns it off';
// Code Mode needs Claude Code 2.1.323+; lean-agents installs the pinned version, so say when the pin is older.
const codeModeNote = () => `${CODE_MODE_NOTE}${compare(PINS['claude-code'].version, '2.1.323') < 0 ? `. The pinned Claude Code ${PINS['claude-code'].version} is older than 2.1.323: the setting is written now and takes effect once the pin moves` : ''}`;
const EXTENSION_NOTE = 'install the Playwright Extension yourself from https://chromewebstore.google.com/detail/playwright-extension/mmlmfjhmonkocbjadbfplnigmagldckm . Each session asks you to approve the connection; optional auto-approve: docs/browser-extension.md';
const MINIMAL_TOOLS = ['rtk', 'context-mode'];
const OPTIONAL_TOOLS = ['serena', 'playwright', 'ponytail', 'caveman', 'i-have-adhd', 'dcp', 'codeburn', 'copilot-usage'];
// Asked for one by one and never part of --all-tools.
const OPT_IN_TOOLS = ['gsd', 'autoskills', 'playwright-extension', 'coordinate', 'lean-migrate', 'code-mode'];
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
  'code-mode': 'Claude Code Code Mode (experimental): Claude runs tool calls from small scripts; needs a direct Anthropic login, sessions started with it resume only with it on',
  autoskills: 'AutoSkills: picks skills per project, run with npx (CC BY-NC 4.0: non-commercial use only)',
};

// Read before isolate() points HOME at --home.
const REAL_HOME = os.homedir();

function parseArgs(argv) {
  const o = {
    command: 'install', dryRun: false, yes: false, agents: null, tools: null, privacy: null, profile: null,
    lang: null, home: os.homedir(), exec: true, adhdAlways: null, ponytailMode: null, shell: null,
    networkPreset: null, networkFlags: {}, gh: null, bun: null, terminals: null, app: true, cursorApp: false, core: true,
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
      case '--everything': o.everything = true; break;
      case '--no-core': o.core = false; break;
      case '--terminal': o.terminals = parseTerminal(next()); break;
      case '--install-terminal': o.installTerminals = parseTerminal(next()); break;
      case '--bun': o.bun = true; break;
      case '--no-bun': o.bun = false; break;
      case '--no-app': o.app = false; break;
      case '--cursor-app': o.cursorApp = true; break;
      case '--privacy': o.privacy = next(); fromPrivacy(o.privacy); break;
      case '--gh': o.gh = true; break;
      case '--no-gh': o.gh = false; break;
      case '--json': o.json = true; break;
      case '--verbose': o.verbose = true; break;
      case '--probe-plugins': o.probePlugins = true; break;
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
      case '--add-tools': o.command = 'update'; o.addTools = list(next()); break;
      case '--uninstall': o.command = 'uninstall'; break;
      case '--doctor': o.command = 'doctor'; break;
      case '--preflight': o.command = 'preflight'; break;
      case '--summary': o.command = 'summary'; break;
      case '--no-open': o.noOpen = true; break;
      case '--filed-issue': (o.filedIssues ??= []).push(next()); break;
      case '--adopt': o.command = 'adopt'; break;
      case '--upgrade-agent': o.command = 'upgrade-agent'; o.upgradeAgent = next(); if (!['opencode', 'vscode-copilot'].includes(o.upgradeAgent)) throw new Error('--upgrade-agent takes opencode or vscode-copilot'); break;
      case '--undo': o.undo = true; break;
      case '--keep-backup': o.keepBackup = true; break;
      case '--backup': o.backup = true; break;
      case '--opencode1': o.opencode1 = true; break;
      case '--confirm-removals': o.confirmRemovals = true; break;
      case '--install-agent': case '--uninstall-agent': o.command = 'agent'; o.agentMode = a.slice(2, -6); o.agentList = list(argv[i + 1]?.startsWith('--') ? '' : next() ?? ''); if (!o.agentList.length) throw new Error(`${a} needs an agent list (claude, opencode-v2, copilot-cli, cursor, antigravity, vscode-copilot)`); break;
      case '--usage': o.command = 'usage'; break;
      case '--skip-agents': case '--no-admin': console.error(`! ${a} does nothing (agents are never installed, nothing needs admin) and will be removed in the next release.`); break;
      case '--help': case '-h': o.command = 'help'; break;
      case '--version': o.command = 'version'; break;
      default: throw new Error(`unknown option ${a} (see --help)`);
    }
  }
  if (o.everything && !o.migrate) {
    // Preset for a fresh machine: every default is taken, so the plan is the only question.
    o.tools ??= [...MINIMAL_TOOLS, ...OPTIONAL_TOOLS];
    o.gh ??= true;
    o.bun ??= true;
    o.lang ??= 'en';
    o.profile ??= 'none';
    o.ponytailMode ??= 'lite';
    o.adhdAlways ??= true;
  }
  if (!o.core && o.tools) o.tools = o.tools.filter((t) => !MINIMAL_TOOLS.includes(t));
  return o;
}

const HELP = `Usage: lean-agents [options]

  --dry-run              Show every file change and command; change nothing
  --yes                  Accept defaults without asking
  --everything           Fresh-machine preset: plan the prerequisites (Homebrew, nvm, Node 24, uv, RTK, Bun) and Claude Code +
                         OpenCode 2 with every optional tool, show one plan, ask once (--yes accepts; --dry-run --json prints it)
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
  --install-terminal warp|orca|both
                         Install the terminal app and its agent integrations (macOS: Warp requires brew)
  --gh / --no-gh         Install GitHub CLI (gh) if it is missing (default: on; you run gh auth login yourself)
  --feedback-draft       After a failed install: read the error on stdin, print a redacted issue draft as JSON
                         (--feedback-kind update: the text is a finding from an update, not an error)
                         ({"offer":false} when the network preset forbids it). Needs --failed-command <text>;
                         pass --network on|off when nothing is installed yet. Files nothing.
  --no-exec              Run no external command (no installs, no version probes); --uninstall refuses it when commands need undoing
  --probe-plugins        With --doctor or --adopt: start a short-lived opencode serve (throwaway state dir, loopback) and check a plugin's command registers
  --verbose              Print every command's own output (default: one line per step, the output goes to a log under the state dir; the log can hold tool output, keep it private)
  --json                 With --dry-run, --doctor, --preflight or --yes: print one JSON object on stdout (messages go to stderr)
  --no-app               Do not install the Antigravity app (the CLI is still installed when missing)
  --cursor-app           With Cursor: also install the Cursor app when missing (brew or winget; opt-in)
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
  --add-tools a,b        --update that also adds these tools to your saved ones (agents, profile and the rest kept)
  --update --undo [--yes]
                         Put each agent CLI that --update upgraded back on the version it had before its first upgrade
                         (plan first, then a confirm; a failed step is reported and the rest run). --uninstall leaves
                         upgraded agent CLIs alone; use --uninstall-agent for ones lean-agents installed
  --uninstall            Undo everything lean-agents changed
  --doctor               Check the install
  --preflight            Read-only: old or duplicate copies of each agent CLI and tool on PATH, a tool below its minimum version, a terminal
                         that started before a PATH change, tools under several nvm Nodes, too little disk for the OpenCode 1.x backup, a running
                         OpenCode, and the OpenCode MCP server names (yours as <user-mcp-N>); one fix line each, exit 1 when something blocks setup (with --json: one JSON object;
                         with --no-exec no version is probed)
  --summary              Write the summary page (summary.html in the state dir; --uninstall removes it) and ask before opening it.
                         --filed-issue "item=issue url" records an issue you filed; --no-open only prints the path
  --adopt                List what a hand-built machine already has (MCPs, hooks, plugins, skills, npm copies),
                         classify each (managed, user, stale, duplicate, drift, wrong-node) and print the planned
                         actions; changes nothing (with --json: one JSON object). Always pass --home to try it
  --adopt --yes          Apply it: back up, re-register managed MCPs on one Node, verify, undo by itself on a failure
  --confirm-removals     With --adopt --yes and no terminal: also remove old npm copies, a duplicate skill folder and
                         hand-made stopgaps (all backed up; on a terminal a menu asks instead)
  --keep-backup          Keep the backup after a verified --adopt --yes (--adopt --undo needs it to restore bytes)
  --upgrade-agent opencode  Dry run: classify the OpenCode 1.x config as managed, translatable to 2.x or manual and print the
                         translation table; changes nothing (with --json: one JSON object)
  --upgrade-agent opencode --yes
                         Apply, after --backup --yes made a verified backup: opencode1, install OpenCode 2, translate the
                         config, add DCP. Steps are journaled in state.json; a failed step undoes the finished ones
  --upgrade-agent opencode --undo [--yes]
                         Back to 1.x: undo each step, move the 2.x db aside, copy the frozen copy back. Never deletes the
                         backup or the frozen copy. Plan first; --yes does it
  --upgrade-agent opencode --backup [--dry-run|--yes]
                         Permanent sha256-checked backup of the OpenCode 1.x sessions and config, then a frozen copy for
                         opencode1; the live data is only read. Plan first (the default); --yes copies. Refuses while
                         OpenCode runs or free space is under 2 x size + 1 GB
  --upgrade-agent opencode --opencode1 [--dry-run|--yes]
                         After --backup: copy the OpenCode 1.x binary next to the frozen copy and add opencode1, which runs
                         1.x on that copy only (XDG_DATA_HOME + XDG_STATE_HOME), to PATH. --uninstall removes it
  --undo                 With --adopt: restore what the last --adopt --yes changed
  --upgrade-agent vscode-copilot
                         Report only: VS Code owns the Copilot extension; --update refreshes the files lean-agents wrote
  --install-agent a,b / --uninstall-agent a,b
                         Install (claude, opencode-v2, copilot-cli, cursor, antigravity) or remove the agent CLIs
                         lean-agents itself installed; plan first, --yes to run. Never OpenCode 1.x.
                         vscode-copilot: configure or remove only the files lean-agents wrote (VS Code owns the extension)
  --version              Print the lean-agents version
  --usage                Print the Copilot credits left (one gh call, no model request)
`;

const NO_INPUT = 'no terminal to ask on: pass --yes to accept the defaults, or --dry-run with --agents and --tools to preview';
const DRY_RUN_HINT = 'to apply from a non-interactive shell, add --yes';

// #548: the input prompter() reads from. Piped stdin (curl ... | bash) on a real terminal must still ask, on /dev/tty.
function ttyInput() {
  if (process.stdin.isTTY) return process.stdin;
  // Test hook, guarded like LEAN_TEST_FAIL_AT: CI has no pty. '1' pretends a terminal exists, '0' pretends none.
  const fake = process.env.LEAN_AGENTS_TEST === '1' ? process.env.LEAN_TTY : undefined;
  if (fake === '1') return process.stdin;
  if (fake === '0') return null;
  try { return new tty.ReadStream(fs.openSync(process.platform === 'win32' ? 'CONIN$' : '/dev/tty', 'r')); } catch { return null; }
}
// The same probe the early no-tty check and the dry-run hint use, so both agree with prompter().
function hasTty() {
  const input = ttyInput();
  if (input && input !== process.stdin) input.destroy();
  return Boolean(input);
}

async function prompter(yes) {
  if (yes) return { ask: async (_q, def) => def, select: async ({ def }) => def, multi: async ({ defaults }) => defaults, close() {} };
  const input = ttyInput() ?? process.stdin;
  if (canUseMenus(input)) return menuPrompter(input);
  const rl = readline.createInterface({ input, output: process.stdout });
  // Never fall back to the default answer here: nobody approved these changes.
  const noInput = () => new Error(NO_INPUT);
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
  // --everything answers every question with its default; install() asks the one plan question.
  // A dry run without a terminal writes nothing, so it previews the defaults instead of failing (#393).
  const p = await prompter(o.yes || o.everything || (o.dryRun && !process.stdin.isTTY));
  if (o.migrate) return chooseMigration(o, p);
  if (!o.agents && o.everything) {
    const team = everythingAgents({ platform: process.platform, project: !!o.project, detected: process.platform === 'win32' ? detectAgents() : {} }); // detection only matters for the Windows team preset
    o.agents = team.agents;
    if (team.skipped.length) o.agentNotes = [`not found, skipped: ${team.skipped.join(', ')} (install them, then rerun --everything)`];
  }
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
  if (o.addTools) o.tools = [...new Set([...o.tools, ...o.addTools])];
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
  o.deferred = resolved.skipped.map((s) => s.tool);
  o.toolNode = resolved.toolNode && { ...resolved.toolNode, nvmDir: nvm.dir };
  if (o.toolNode && o.agents.includes('claude') && o.tools.includes('context-mode')) console.log('Context Mode on Claude Code runs as an MCP server on its own Node: its hooks and skills (the plugin) are not installed.');
  // The flag itself, before the saved choice fills o.installTerminals in below.
  const requestedTerminals = o.installTerminals ? [...o.installTerminals] : [];
  o.adoptedTerminals = [...new Set([...(saved?.adoptedTerminals ?? []), ...(o.adoptedTerminals ?? [])])];
  o.declinedTerminals = [...new Set([...(saved?.declinedTerminals ?? []), ...(o.declinedTerminals ?? [])])];
  if (o.project) {
    o.terminals = [];
    o.installTerminals = [];
  } else if (!o.terminals) {
    const found = detectTerminals(o.home, { system: o.home === REAL_HOME });
    o.terminals = saved ? saved.terminals ?? [] : found;
    o.installTerminals = o.installTerminals ?? saved?.installTerminals ?? [];
    if (!saved) {
      const askIntegrate = found.map((t) => ({ value: t, label: `${t} integration (app already installed)`, ask: `Add the ${t} agent integration?` }));
      const missing = TERMINALS.filter((t) => !found.includes(t));
      const askInstall = (o.home === REAL_HOME && (process.platform === 'darwin' || process.platform === 'win32'))
        ? missing.map((t) => ({ value: t, label: `Install ${t} + integration`, ask: `Install the ${t} app and its agent integration?` }))
        : [];
      
      if (askIntegrate.length || askInstall.length) {
        const picked = await p.multi({
          message: 'Terminals (Warp, Orca)',
          items: [...askIntegrate, ...askInstall],
          defaults: found,
        });
        
        o.installTerminals = [...new Set([...o.installTerminals, ...picked.filter(t => missing.includes(t))])];
        o.terminals = [...new Set([...picked, ...o.installTerminals])];
      } else {
        o.terminals = [...new Set([...o.terminals, ...o.installTerminals])];
      }
    } else {
      o.terminals = [...new Set([...o.terminals, ...o.installTerminals])];
    }
  } else {
    o.installTerminals = o.installTerminals ?? saved?.installTerminals ?? [];
    o.terminals = [...new Set([...o.terminals, ...o.installTerminals])];
  }
  if (o.command === 'update' && !o.project) {
    // Keep the apps this install manages and add the ones --install-terminal asks for now.
    o.installTerminals = [...new Set([...(saved?.installTerminals ?? []), ...requestedTerminals])];
    o.terminals = [...new Set([...o.terminals, ...o.installTerminals])];
    // An explicit --install-terminal overrides an earlier "no".
    o.declinedTerminals = o.declinedTerminals.filter((a) => !requestedTerminals.includes(a));
    const apps = installedAppVersions({ home: o.home, platform: process.platform, system: o.home === REAL_HOME, run: o.exec ? quiet : () => ({ ok: false, out: '' }) });
    const rows = appUpdateRows({ pins: PINS, installed: apps, managed: saved?.installTerminals ?? [], platform: process.platform });
    // --dry-run never asks: it plans adoptions, and non-interactively the hint names the flag.
    // Test-only (LEAN_AGENTS_TEST=1): FORCE_ASK answers the adoption question even with --yes.
    const canAsk = (!o.yes || (process.env.LEAN_AGENTS_TEST === '1' && process.env.LEAN_AGENTS_TEST_FORCE_ASK === '1')) && !o.everything && !o.dryRun;
    // Test-only (LEAN_AGENTS_TEST=1): answer the adoption question without a terminal, so engine tests can prove a "no".
    const testAnswers = process.env.LEAN_AGENTS_TEST === '1' && process.env.LEAN_AGENTS_TEST_APP_ANSWERS ? process.env.LEAN_AGENTS_TEST_APP_ANSWERS.split(',') : [];
    for (const row of rows) {
      if (row.action === 'update') continue;
      const action = appAdoptAction({ row, requested: requestedTerminals, declined: o.declinedTerminals, canAsk });
      const answer = action === 'ask' ? (testAnswers.length ? testAnswers.shift() : await p.ask(appAdoptQuestion(row), 'n')) : null;
      // A user-installed app: adopt it only on a yes, or when --install-terminal names it. Undo then leaves it alone.
      if (action === 'adopt' || (action === 'ask' && yesNo(answer))) {
        o.installTerminals = [...new Set([...o.installTerminals, row.app])];
        o.adoptedTerminals = [...new Set([...o.adoptedTerminals, row.app])];
        row.action = 'update';
        row.reason = null;
      } else {
        if (action === 'ask') o.declinedTerminals = [...new Set([...o.declinedTerminals, row.app])];
        // Same channel as the other update notes, so --json stdout stays one JSON object.
        (o.json ? console.error : console.log)(appAdoptHint(row));
      }
    }
    for (const row of rows) {
      if (row.action !== 'update' || row.app !== 'orca') continue;
      const target = appUpdateTarget({
        home: o.home, app: 'orca', platform: process.platform, system: o.home === REAL_HOME,
        running: o.exec && o.home === REAL_HOME && appRunning({ app: 'orca' }),
      });
      if (target.blocked) {
        row.action = 'held';
        row.reason = target.blocked;
      } else if (target.path) {
        o.appPaths = { ...o.appPaths, orca: target.path };
      }
    }
    o.appRows = rows;
    o.appUpdates = rows.filter((r) => r.action === 'update').map((r) => r.app);
  }
  if (o.installTerminals?.length) {
    const isReal = o.home === REAL_HOME;
    const isSupported = process.platform === 'darwin' || process.platform === 'win32';
    if (!isReal || !isSupported) {
      for (const t of o.installTerminals) {
        const reason = !isReal ? 'temp home' : `unsupported platform ${process.platform}`;
        console.log(`! ${t} app: not installed (${reason})`);
      }
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
    // Reuse the saved profile when OpenCode was already set up (`none` is saved as null); ask only when OpenCode is new (#489).
    o.profile = saved?.agents?.some((a) => a.startsWith('opencode')) ? saved.profile ?? 'none' : (await p.select({ ask: `OpenCode model profile (${profiles.join(', ')})?`, message: 'OpenCode model profile', options: profiles.map((v) => ({ value: v })), def: 'none' }));
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
  let perCategory = null;
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
      perCategory = base;
    } else throw new Error(`network takes off, on or choose, not "${a}"`);
  }
  o.network = { ...(base ?? preset('on')), ...o.networkFlags };
  // Updates the user asked for (flag, per-category menu, or the saved choice) keep the agent's own updater; a plain "on" preset does not.
  o.keepUpdater = o.network.autoUpdate === 'on' && (o.networkFlags.autoUpdate === 'on' || perCategory?.autoUpdate === 'on' || (!o.networkPreset && !!saved?.keepUpdater));
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

function buildPlan(o, every = null) {
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
  const warnings = [];
  for (const agent of o.agents) {
    const profile = loadProfile(ROOT, FIXED_PROFILE[agent] ?? o.profile);
    const r = ADAPTERS[agent]({ home: o.home, core, profile, opts: o, rules, adhdCommand: adhdCommand(o.home), rulesPath: rulesPath.split(path.sep).join('/') });
    actions.push(...r.actions);
    commands.push(...r.commands.map((c) => ({ ...c, agent })));
    warnings.push(...(r.warnings ?? []));
  }
  commands.push(...leanUpdateCommands(o.agents));
  if (o.tools.includes('coordinate')) commands.push(...coordinateCommands(o.agents));
  if (o.tools.includes('lean-migrate')) commands.push(...leanMigrateCommands(o.agents));
  commands.push(...terminalCommands({ home: o.home, terminals: o.terminals, installTerminals: o.installTerminals, updateApps: o.appUpdates, adoptedTerminals: o.adoptedTerminals, appPaths: o.appPaths, agents: o.agents, network: o.network, system: o.home === REAL_HOME, platform: process.platform }));
  actions.push(...gitBashActions({ home: o.home, terminals: o.terminals, agents: o.agents }));
  if (o.tools.includes('gsd')) {
    const r = gsdPlan(ROOT, o.home, o);
    actions.push(...r.actions);
    commands.push(...r.commands);
  }
  if (o.bun && o.network.telemetry === 'off') {
    actions.push({ kind: 'block', toml: true, path: path.join(o.home, '.bunfig.toml'), body: 'telemetry = false' });
  }
  actions.push(...posixPathActions(o, every));
  return { planned: plan(actions, writeRoots(o), readState(o.home)?.files), commands, warnings };
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
    if (t === 'rtk' && !p.install && process.platform === 'linux') {
      const r = rtkInstall(o.home, stateDir(o.home), process.platform, process.arch);
      if (r) { out.push({ ...r, bin: 'rtk' }); continue; }
    }
    if (p.install) out.push({ tool: t, desc: `install ${p.bin}`, run: p.install, undo: [], optional: t === 'gh', bin: p.bin });
    else out.push({ tool: t, desc: `${p.bin} is missing: install it from ${p.manual}`, run: [], undo: [], manual: true, optional: t === 'gh', bin: p.bin });
  }
  if (o.agents.includes('antigravity')) {
    for (const c of antigravityPrereqs(pm, process.platform, o.home, o.app)) {
      if (c.note) console.log(c.desc);
      else out.push({ tool: 'antigravity', undo: [], ...c });
    }
  }
  if (o.agents.includes('cursor') && o.cursorApp) {
    for (const c of cursorAppPrereqs(pm, process.platform, o.home)) {
      if (c.note) console.log(c.desc);
      else out.push({ tool: 'cursor-app', ...c });
    }
  }
  if (o.bun && o.tools.includes('context-mode') && process.platform !== 'linux' && !which('bun') && bunPresent(o.home)) {
    if (process.platform === 'win32') out.push(bunPathCommand(o.home));
    else console.log('! Bun is in ~/.bun/bin but not on PATH; Context Mode needs it on PATH here. Add that folder to PATH.');
  }
  if (o.bun && o.tools.includes('context-mode') && !bunPresent(o.home)) {
    const b = bunInstall(o.home, stateDir(o.home), process.platform, pm);
    if (b) out.push(b);
    else if (!o.everything) console.log('! Bun needs Homebrew here: install it from https://bun.com/docs/installation. Context Mode will run on Node.'); // --everything: the planner installs Homebrew, then Bun
  }
  return out;
}

// The agents --everything configures whose CLI is missing and that --install-agent can install. Not recorded in state.json:
// agents.json records them, and --uninstall-agent removes them, like a separate --install-agent run.
function everythingCliInstalls(o, gitPending) {
  const table = agentTable({ home: o.home, platform: process.platform, dir: stateDir(o.home), realHome: REAL_HOME, gitBash: gitPending ? 'bash.exe' : undefined });
  return o.agents.filter((a) => AGENT_CLIS[a] && table[a] && !table[a].manual && !which(AGENT_CLIS[a])).map((a) => ({
    desc: `install the ${AGENT_CLIS[a]} CLI (${table[a].method}${table[a].version ? ` ${table[a].version}` : ''})`, run: [], undo: [], lifecycle: a, bins: table[a].bins,
  }));
}

// --everything: the planner's steps as engine commands. Probes the machine here; the planner itself stays pure.
function everythingPrereqs(o, saved) {
  const mac = process.platform === 'darwin';
  const has = {
    brew: !!which('brew'), winget: !!which('winget'), uv: !!which('uv'), rtk: !!which('rtk'), jq: !!which('jq'), bun: bunPresent(o.home), git: !!which('git'),
    clt: mac && quiet(['xcode-select', '-p']).ok, nvm: !!o.nvm, apt: !!which('apt-get'), sudo: !!which('sudo'), unzip: !!which('unzip'),
  };
  const steps = planPrereqs({
    nvmDirExisted: nvmDirExistedBefore(saved?.commands, fs.existsSync(path.join(o.home, '.nvm'))),
    platform: process.platform, arch: process.arch, home: o.home, tmp: stateDir(o.home), execPath: process.execPath, has, root: process.getuid?.() === 0,
    nodeActive: NODE_VERSION, nvmNodes: o.nvm ? installedNodes(o.nvm).map((n) => n.version) : [],
    proxyEnv: proxyReport().map((l) => l.split('=')[0]), done: (saved?.commands ?? []).filter((c) => c.ok && c.resumeKey).map((c) => c.resumeKey),
    needsGit: true, terminals: o.terminals, agents: o.agents,
  });
  const commands = pendingPrereqs(steps).map((s) => s.commands.length
    ? { tool: s.id === 'node-24' ? 'node' : s.id, desc: `prerequisite: ${s.label}`, run: s.commands, undo: s.undo ?? [], optional: s.id === 'bun', resumeKey: s.resumeKey, ...(s.id === 'node-24' && o.nvm && { env: nvmEnv(o.nvm.dir) }) }
    : { tool: s.id, desc: `${s.label} is missing: install it from ${s.manual}`, run: [], undo: [], manual: true, optional: true, resumeKey: s.resumeKey });
  return { steps, commands };
}

function printPrereqs(steps, exec) {
  console.log('\nPrerequisites (installed first, only what is missing; your own Node stays the default):');
  for (const s of steps) console.log(`  - ${s.label}: ${s.skipIf ? `skipped (${s.skipIf})` : s.commands.length ? 'will install' : `install it yourself: ${s.manual}`} | ${s.why}`);
  if (!exec) console.log('  (--no-exec: not run)');
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
function printJson(o, planned, commands, migration, behind, prereqs, update) {
  const rel = (t) => (t.startsWith(o.home + path.sep) || t === o.home ? `~${t.slice(o.home.length)}` : t);
  const inText = (t) => t.split(o.home).join('~');
  const plan = {
    agents: o.agents, tools: o.tools, privacy: o.privacy, lang: o.lang, profile: o.profile ?? null, terminals: o.terminals,
    ...(o.everything && { afterNvm: o.deferred ?? [], agentNotes: o.agentNotes ?? [] }), gh: !!o.gh, bun: !!o.bun, network: o.network, migrate: migration ? migration.names : null,
    files: planned.map((f) => ({ status: f.status, path: rel(f.path), note: f.note ?? null })),
    commands: commands.map((c) => ({ desc: inText(c.desc), agent: c.agent ?? null, run: [...c.run, ...(c.always ?? [])].map((a) => a.map(inText)) })),
    ...(behind && { behind }),
    ...(update && { update }),
    ...(prereqs && { prereqs: prereqs.map((s) => ({ id: s.id, label: s.label, why: s.why, status: s.skipIf ? 'skip' : s.commands.length ? 'install' : 'manual', skipIf: s.skipIf, manual: s.manual ?? null })) }),
  };
  process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
}

// One JSON object on stdout after a real apply (--json --yes). Field names are a contract: see docs/install-json.md.
function printApplied(o, files, commands, errors) {
  // The home becomes ~; any other absolute path (a --project dir, node's own) is masked like the files are.
  const inText = (t) => t.split(o.home).join('~').replace(/(^|[\s'"=(])(?:\/|[A-Za-z]:[\\/])[^\s'")]*/g, '$1<outside-home>');
  // Never an absolute path: --project files live outside the home.
  const rel = (t) => { const r = path.relative(o.home, t); return r === '..' || r.startsWith(`..${path.sep}`) || path.isAbsolute(r) ? '<outside-home>' : r.split(path.sep).join('/') || '.'; };
  process.stdout.write(`${JSON.stringify({
    ok: errors.length === 0,
    files: files.map((f) => rel(f.path)),
    commands: commands.map((c) => ({ ...c, desc: inText(c.desc), ...(c.run && { run: c.run.map((a) => a.map(inText)) }) })),
    errors: errors.map(inText),
    version: JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version,
  }, null, 2)}\n`);
}

function printPlan(o, planned, commands, behind = new Set()) {
  console.log(`\nlean-agents plan for ${o.agents.join(', ') || 'no agents'}`);
  if (o.project) console.log(`  project: ${o.project}`);
  for (const n of o.agentNotes ?? []) console.log(`  agents ${n}`);
  console.log(`  tools: ${o.tools.join(', ') || 'none'} | privacy: ${o.privacy} | lang: ${o.lang} | profile: ${o.profile ?? 'none'}`);
  if (o.terminals.length) console.log(`  terminals: ${o.terminals.join(', ')}`);
  if (o.network.telemetry === 'off') for (const n of terminalPrivacyNotes(o.terminals, { orcaEnvSet: orcaEnvSet({ system: o.home === REAL_HOME }) })) console.log(`  ${n}`);
  if (o.everything && o.deferred?.length) console.log(`  after nvm: run lean-agents --update to add ${o.deferred.join(', ')} (they need Node 24, which the prerequisites install under nvm)`);
  if (o.tools.includes('context-mode')) console.log(`  bun: ${o.bun ? `on${bunPresent(o.home) ? ' (already installed)' : ''}` : 'off'}`);
  console.log(`  network: ${CATEGORIES.map((c) => `${c} ${o.network[c]}`).join(', ')}`);
  const owned = o.agents.filter((a) => /^(claude|copilot-cli|opencode-v[12])$/.test(a));
  if (o.network.autoUpdate === 'on' && !o.keepUpdater && owned.length) console.log(`  auto-update: ${owned.join(', ')} keep their own updater off because --update owns updates (--auto-update on leaves it alone)`);
  const net = proxyReport();
  if (net.length) console.log(`  proxy and CA (passed to every command): ${net.join(' ')}`);
  if (o.tools.includes('playwright-extension')) console.log(`  signed-in browser: ${EXTENSION_NOTE}`);
  if (o.tools.includes('code-mode') && o.agents.includes('claude')) console.log(`  code mode: ${codeModeNote()}`);
  if (o.notes.length) console.log(`  your notes for undocumented settings (saved, never applied): ${o.notes.map((n) => path.basename(n.path, '.md')).join(', ')}`);
  console.log('');
  console.log('Files:');
  console.log(describe(planned, o.home, !o.verbose));
  if (commands.length) {
    console.log('\nCommands:');
    for (const c of commands) {
      // Same check as the run below: an install already there at its pin is skipped, so do not list its commands.
      const there = !behind.has(c.tool) && ((c.skipIfExists && exists(c.skipIfExists)) || (o.exec && c.skipIfOutput && quiet(c.skipIfOutput.cmd).ok));
      console.log(`  - ${c.desc}${c.agent ? ` (${c.agent})` : ''}${there ? ': already there, skipped' : ''}`);
      if (there) continue;
      for (const argv of [...c.run, ...(c.always ?? [])]) console.log(`      $ ${tilde(argv.join(' '), o.home)}`);
    }
  }
  console.log('');
}

// --update: rows `tool: installed -> pin` plus the shipped CHANGELOG sections after the installed lean-agents version.
function updateInfo(o, saved) {
  const agentsFile = path.join(stateDir(o.home), 'agents.json');
  let owned = [];
  try { owned = Object.keys(JSON.parse(fs.readFileSync(agentsFile, 'utf8')).agents ?? {}); } catch { /* absent or unreadable: no agent is ours */ }
  // --no-exec runs no external command, not even a version probe: the agent rows then show nothing installed.
  let installed = { claude: null, opencode: null, copilot: null };
  if (o.exec) {
    // A scratch HOME: `opencode --version` writes a log under HOME, and a dry run must leave --home untouched.
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'lean-probe-'));
    const env = { HOME: scratch, USERPROFILE: scratch };
    const probe = (b) => versionFull(b, ['--version'], env);
    installed = { claude: probe('claude'), opencode: probe('opencode'), copilot: probe('copilot') };
    fs.rmSync(scratch, { recursive: true, force: true });
  }
  // planUpdate compares numeric versions; the raw string (pre-release tag kept) is what an undo reinstalls.
  const numeric = Object.fromEntries(Object.entries(installed).map(([b, v]) => [b, v?.replace(/-.*/, '') ?? null]));
  const raw = { 'claude-code': installed.claude, 'opencode-v2': installed.opencode, 'copilot-cli': installed.copilot };
  const rows = planUpdate({ saved, pins: PINS, owned, installed: numeric }).map((r) => (r.action === 'update' && raw[r.tool] ? { ...r, raw: raw[r.tool] } : r));
  rows.push(...(o.appRows ?? []));
  const log = path.join(ROOT, 'CHANGELOG.md');
  const current = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
  return { rows, notes: changelogNotes(fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '', saved.version ?? '0.0.0', current) };
}

// The folders an --everything run installs into, as one marked rc block (#335). Folders already on PATH are left out.
function posixPathActions(o, every) {
  if (process.platform === 'win32') return [];
  // A plain --tools rtk run on Linux installs into ~/.local/bin too (#411).
  const localRtk = !every && process.platform === 'linux' && o.tools.includes('rtk') && !packageManager() && !which('rtk') && Boolean(rtkInstall(o.home, stateDir(o.home), process.platform, process.arch));
  if (!every && !localRtk) return [];
  const pending = new Set(pendingPrereqs(every?.steps ?? []).map((s) => s.id));
  const dirs = localRtk ? ['.local/bin'] : [
    ...(o.agents.includes('claude') || pending.has('uv') || pending.has('rtk') ? ['.local/bin'] : []),
    ...(o.agents.includes('opencode-v2') ? ['.opencode/bin'] : []),
  ];
  const brew = pending.has('homebrew') ? (process.arch === 'arm64' ? '/opt/homebrew' : '/usr/local') : null;
  const privateNode = process.execPath.startsWith(path.join(o.home, '.config', 'lean-agents', 'node') + path.sep);
  return posixPathBlock({ home: o.home, platform: process.platform, envPath: process.env.PATH, dirs, brew, privateNode, shell: process.env.SHELL });
}

async function install(o) {
  if (o.json && !o.yes) throw new Error('--json needs --yes: the menus would write questions to stdout');
  const saved = o.command === 'update' ? readState(o.home) : null;
  if (o.command === 'update' && !saved) {
    let found = false;
    try { found = (await inventory({ home: o.home, env: process.env, realHome: REAL_HOME })).items.length > 0; } catch { /* the plain message below */ }
    throw new Error(`nothing to update: lean-agents is not installed${found ? '; run --adopt --yes, then install (--everything --yes)' : ''}`);
  }
  if (o.command === 'update' && saved.options.migrateOnly) throw new Error(`nothing to update: only ${saved.adoptOnly ? '--adopt' : '--migrate'} ran here; install first (--everything --yes)`);
  // #548: the plan and release notes must not print before the one message that stops a non-interactive run.
  if (!o.yes && !o.dryRun && !hasTty()) throw new Error(NO_INPUT);
  // #548: remember the service state before any command of this run (the probes included), to stop it only if we started it.
  const trackService = o.exec && !o.dryRun;
  let opencodeBefore = null;
  if (trackService) { try { opencodeBefore = new Set(opencodePids()); } catch { /* cannot list: never stop what may be the user's */ } }
  const p = await choose(o, saved?.options);
  // A plain re-run starts fresh: say so when it changes the saved agents or profile (#304, seen on a real PC).
  const prior = o.command !== 'update' && !o.json && !o.project && !o.migrate && !o.adopt ? readState(o.home)?.options : null;
  const same = (a, b) => [...a].sort().join() === [...b].sort().join();
  const profile = (v) => (v === 'none' ? null : v ?? null);
  if (prior?.agents && (!same(prior.agents, o.agents) || profile(prior.profile) !== profile(o.profile))) {
    console.log(`Note: your saved setup is ${prior.agents.join(', ')} with profile ${prior.profile ?? 'none'}; this run changes it. To keep it, use --update, or --add-tools a,b to add tools.`);
  }
  const every = o.everything && !o.migrate ? everythingPrereqs(o, readState(o.home)) : null;
  const { planned, commands: agentCommands, migration, warnings = [] } = buildPlan(o, every);
  if (migration && !migration.rows.length) { p.close(); console.log('Nothing to migrate: no rules, agents, skills, prompts, MCP servers or hooks found.'); return o.json && printApplied(o, [], [], []); }
  for (const w of warnings) (o.json ? console.error : console.log)(tilde(w, o.home));
  const behind = new Set((saved ? behindPins(saved) : []).map((b) => pinTool(b.tool)));
  // The planner owns these installs; the per-tool ones below would repeat them.
  const owned = new Set(pendingPrereqs(every?.steps ?? []).map((s) => (s.id === 'node-24' ? 'node' : s.id)));
  const update = saved && (o.dryRun || o.exec) ? updateInfo(o, saved) : null;
  const upgrades = update && o.exec ? upgradeCommands({ rows: update.rows, home: o.home, dir: stateDir(o.home), realHome: REAL_HOME, stamps: agentStamps(stateDir(o.home)) }) : [];
  const commands = [...(o.exec ? [...every?.commands ?? [], ...prereqCommands(o, behind).filter((c) => !owned.has(c.tool))] : []), ...agentCommands, ...upgrades];
  // --everything on a fresh machine: install the agent CLIs it configures (the --install-agent path), after the prerequisites.
  const cliInstalls = every && o.exec ? everythingCliInstalls(o, pendingPrereqs(every.steps).some((s) => s.id === 'git')) : [];
  commands.splice(commands.length - agentCommands.length - upgrades.length, 0, ...cliInstalls);

  if (o.exec) {
    const missing = new Map();
    for (const c of commands) {
      if (c.agent && AGENT_CLIS[c.agent] && !cliInstalls.some((x) => x.lifecycle === c.agent)) {
        const cli = AGENT_CLIS[c.agent];
        if ((c.run ?? []).some((argv) => argv[0] === cli) && !which(cli)) {
          if (!missing.has(cli)) missing.set(cli, { agent: c.agent, steps: [] });
          missing.get(cli).steps.push(c.desc);
        }
      }
    }
    if (missing.size > 0) {
      for (const [cli, info] of missing) {
        const others = o.agents.filter((a) => a !== info.agent).join(',') || 'none';
        const warn = `! the ${cli} CLI is not on PATH: ${info.steps.length} steps need it (${info.steps.join(', ')}). Install it first (--install-agent ${info.agent}), or leave it out with --agents ${others}`;
        if (o.json) console.error(warn);
        else console.log(warn);
      }
      if (!o.dryRun) {
        stopStartedOpenCode(o, opencodeBefore);
        p.close();
        console.log('nothing changed');
        process.exitCode = 1;
        return;
      }
    }
  }

  // #467: an rtk below the pinned min fails the rtk steps; skip them and say how to update instead.
  const rtkV = o.exec && commands.some((c) => c.tool === 'rtk') && which('rtk') ? binVersion('rtk') : null;
  if (rtkTooOld(rtkV)) {
    const skipped = commands.filter((c) => c.tool === 'rtk' && (c.run ?? []).some((argv) => argv[0] === 'rtk'));
    for (const c of skipped) commands.splice(commands.indexOf(c), 1);
    const how = rtkUpdateHow();
    const warn = `! rtk ${rtkV} (${which('rtk')}) is older than ${rtkPin().min}, which lean-agents needs: skipped ${skipped.length} RTK steps (${skipped.map((c) => c.desc).join(', ')}). Update rtk (${how}), make it first on PATH, then run --update`;
    if (o.json) console.error(warn);
    else console.log(warn);
  }

  const running = o.command === 'update' && o.exec ? runningBlocker(commands) : null;
  if (running && !o.dryRun) { p.close(); console.error(`! ${running}`); (o.json ? console.error : console.log)('nothing changed'); process.exitCode = 1; return; }
  if (running) (o.json ? console.error : console.log)(`! blocker: ${running}`); // --json keeps stdout JSON
  const noGit = migration ? null : gitHint(packageManager());
  if (noGit) console.log(noGit);
  if (o.json && o.dryRun) {
    p.close();
    return printJson(o, planned, commands, migration, saved ? behindPins(saved) : undefined, every?.steps, update ?? undefined);
  }
  if (migration) printMigration(o, migration, o.exec ? commands : []);
  else {
    if (every) printPrereqs(every.steps, o.exec);
    printPlan(o, planned, commands, behind);
  }
  if (update) { const text = formatUpdatePlan(update.rows, update.notes, !o.verbose); if (text) console.log(text); }
  else if (saved) {
    if (behindPins(saved).length) console.log('Pins that will change (old -> new):');
    for (const b of behindPins(saved)) console.log(`${b.tool}: ${b.installed} -> ${b.pinned}`);
  }
  if (o.dryRun) {
    p.close();
    console.log('Dry run: nothing was changed.');
    if (!hasTty()) console.log(DRY_RUN_HINT);
    return;
  }
  // The one question of --everything: the choose() prompter answers by default, so ask on a real one.
  const q = o.everything && !o.yes ? await prompter(false) : p;
  if (q !== p) p.close();
  try { if (!yesNo(await q.ask('Apply these changes?', 'y'))) { console.log('Cancelled.'); return; } } finally { q.close(); }
  // A Homebrew that this run installs is not on this process's PATH yet.
  if (every && process.platform === 'darwin' && pendingPrereqs(every.steps).some((s) => s.id === 'homebrew')) process.env.PATH = `/opt/homebrew/bin${path.delimiter}/usr/local/bin${path.delimiter}${process.env.PATH ?? ''}`;
  // Linux: uv and rtk installers put binaries in ~/.local/bin, which only a new shell may have on PATH.
  const localRtk = !every && process.platform === 'linux' && o.tools.includes('rtk') && !packageManager() && !which('rtk');
  if (process.platform === 'linux' && (localRtk || (every && pendingPrereqs(every.steps).some((s) => s.id === 'uv' || s.id === 'rtk')))) process.env.PATH = `${path.join(o.home, '.local', 'bin')}${path.delimiter}${process.env.PATH ?? ''}`;
  // winget --scope user puts command links (uv, rtk, jq) and Git.Git's git.exe here, and on the saved user PATH, which only new terminals see (nightly fresh-machine, 2026-11-20).
  if (every && process.platform === 'win32' && pendingPrereqs(every.steps).some((s) => s.commands.some((argv) => argv[0] === 'winget'))) {
    // Both: winget resolves the profile folder, which differs from LOCALAPPDATA when USERPROFILE is overridden (CI). An elevated shell gets Git under Program Files.
    const locals = [...new Set([path.join(o.home, 'AppData', 'Local'), process.env.LOCALAPPDATA].filter(Boolean))];
    const gitMachine = process.env.ProgramFiles ? [path.join(process.env.ProgramFiles, 'Git', 'cmd')] : [];
    process.env.PATH = [...locals.flatMap((l) => [path.join(l, 'Microsoft', 'WinGet', 'Links'), path.join(l, 'Programs', 'Git', 'cmd')]), process.env.PATH ?? '', ...gitMachine].join(path.delimiter); // Program Files last: only a fallback
  }
  const ui = q.menus ? await menuProgress() : null;
  Object.assign(process.env, childEnv(o.network));

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = path.join(stateDir(o.home), 'backups', stamp);
  // Quiet by default: each step's output goes to one log per run (#491); --verbose and --json keep it on the terminal.
  // The log can hold tool output: owner-only dir and file. If it cannot be created, fall back to the terminal.
  let logFile = o.verbose || o.json ? null : path.join(stateDir(o.home), 'logs', `${stamp}.log`);
  if (logFile) {
    try {
      fs.mkdirSync(path.dirname(logFile), { recursive: true, mode: 0o700 });
      if (process.platform !== 'win32') fs.chmodSync(path.dirname(logFile), 0o700);
      fs.closeSync(fs.openSync(logFile, 'a', 0o600));
    } catch (e) { console.log(`! cannot write the step log (${e.code ?? e.message}); showing every command's output instead.`); logFile = null; }
  }
  const tail = [];
  const showFailure = (c) => console.log(`${redactText(tail.slice(-20).map((l) => `    ${l}`).join('\n'), { home: o.home })}\n  ! failed: ${c.desc}. full output: ${tilde(logFile, o.home)}${c.optional && c.tool === 'lean-update' ? '; install it later with --update' : ''}`);
  const total = logFile && o.exec ? commands.filter((c) => !c.manual && !(c.bin && !behind.has(c.tool) && which(c.bin)) && (behind.has(c.tool) || !((c.skipIfExists && exists(c.skipIfExists)) || (c.skipIfOutput && quiet(c.skipIfOutput.cmd).ok)))).length : 0;
  let step = 0;
  const stepLine = (c, ok) => console.log(redactText(`[${step}/${Math.max(total, step)}] ${c.desc} ${ok ? '✓' : '✗'}`, { home: o.home }));
  const previous = readState(o.home);
  const files = [];
  const ran = [];
  let failed = 0;
  // Saved as the run goes, so an error or a killed command still leaves a state --uninstall can undo.
  // Resume stamps only matter for an interrupted run; once everything finished they would hide a later removal.
  let finished = false;
  // Content hash per tracked file (this run's and earlier runs'), so a command's own edits can be told from the user's (#470).
  const tracked = () => [...(previous?.files ?? []), ...files];
  const snap = () => new Map(tracked().map((f) => [f.path, fs.existsSync(f.path) && fs.statSync(f.path).isFile() ? sha(fs.readFileSync(f.path, 'utf8')) : null]));
  // A file that changed while one of our commands ran (rtk init, plugin installs) counts as ours: new hash, so --doctor stays ok.
  const refreshHashes = (before) => { for (const [p, h] of snap()) if (h !== null && h !== before.get(p)) for (const f of tracked()) if (f.path === p) { f.hash = h; if (Array.isArray(f.ignore) && f.ignore.every((e) => Array.isArray(e?.path))) { const u = userHash(fs.readFileSync(p, 'utf8'), f.ignore); if (u) f.userHash = u; } } };
  // A stored hash from before #470 predates our own commands' edits: refresh the user-only hash for every tracked JSON
  // file whose plan knows the key paths our commands write, even when nothing changed in this run (#492). Only when the
  // file is exactly our planned JSON plus the ignored plugin keys; anything else stays flagged so --doctor shows an edit.
  const refreshUserHashes = () => {
    for (const p of planned) {
      if (p.kind !== 'json' || !p.userHash || !fs.existsSync(p.path)) continue;
      const f = tracked().filter((e) => e.path === p.path).at(-1);
      if (!f) continue;
      const managed = [...(p.edits ?? []).map((e) => e.path), ...(f.applied ?? []).map((e) => e.path)];
      const u = userHash(fs.readFileSync(p.path, 'utf8'), p.ignore);
      if (u !== p.userHash || managedUserHash(p.after, p.ignore, managed) !== p.userHash) continue;
      f.ignore = p.ignore;
      f.userHash = u;
    }
  };
  const save = () => {
    const state = {
      version: JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version,
      installedAt: previous?.installedAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      pins: pinVersions(),
      options: o.migrate ? previous?.options ?? { migrateOnly: true, agents: o.agents, tools: [], privacy: o.privacy, network: o.network, gh: false, terminals: [], installTerminals: [], adoptedTerminals: [], declinedTerminals: [], unverified: {}, lang: 'en', profile: null, adhdAlways: false, ponytailMode: null, bun: false, shell: 'git-bash' } : { agents: o.agents, tools: o.chosenTools ?? o.tools, privacy: o.privacy, network: o.network, keepUpdater: !!o.keepUpdater, gh: o.gh, terminals: o.terminals, installTerminals: o.installTerminals, adoptedTerminals: o.adoptedTerminals ?? [], declinedTerminals: o.declinedTerminals ?? [], unverified: o.unverified, lang: o.lang, profile: o.profile, adhdAlways: o.adhdAlways, ponytailMode: o.ponytailMode, bun: o.bun, shell: o.shell },
      ...(o.toolNode && { toolNode: { version: o.toolNode.version, installedByLean: !!o.toolNode.install || (previous?.toolNode?.version === o.toolNode.version && !!previous.toolNode.installedByLean) } }),
      files: [...(previous?.files ?? []), ...files],
      ...(previous?.opencode1 && { opencode1: previous.opencode1 }),
      // --adopt --undo reads this; `adoptOnly` is not carried, so --update works after the install.
      ...(previous?.adopt && { adopt: previous.adopt }),
      ...(previous?.upgrade && { upgrade: previous.upgrade }),
      // A command that ran again replaces its earlier record, so --uninstall undoes it once.
      commands: [...(previous?.commands ?? []).filter((c) => !ran.some((r) => r.desc === c.desc)), ...ran].map(({ resumeKey, ...c }) => (finished ? c : { ...c, ...(resumeKey && { resumeKey }) })),
    };
    privateDir(stateDir(o.home), stateDir(o.home));
    writePrivate(path.join(stateDir(o.home), 'state.json'), `${JSON.stringify(state, null, 2)}\n`);
  };
  // #548: stop the service this run started even when a command throws.
  let serviceStopped = false;
  const stopOnce = () => { if (serviceStopped) return; serviceStopped = true; stopStartedOpenCode(o, opencodeBefore); };
  try {
    let applied = false;
    try { apply(planned, backupDir, o.home, writeRoots(o), files); applied = true; refreshUserHashes(); } catch (e) {
      if (o.json) printApplied(o, files, [], [e.message]);
      throw e;
    } finally { if (applied || files.length) save(); }
    const report = [];
    const errors = [];
    if (o.exec) {
      const noCli = new Set(); // agents whose CLI install failed above: their steps would only fail again
      for (const [i, c] of commands.entries()) {
        if (noCli.has(c.agent) && (c.run ?? []).some((argv) => argv[0] === AGENT_CLIS[c.agent])) { console.log(`  skipped: ${c.desc} (no ${AGENT_CLIS[c.agent]} CLI)`); continue; }
        // gh is on by default, so having no installer for it (no brew or winget) must not fail the run.
        // Planned before the prerequisites ran: --everything may have installed it since (macOS: brew's uv brings uvx). Not for --update's behind tools.
        if (c.bin && !behind.has(c.tool) && which(c.bin)) continue;
        if (c.manual) { console.log(`! ${c.desc}`); if (!c.optional) { failed++; errors.push(c.desc); } continue; }
        const there = (c.skipIfExists && exists(c.skipIfExists)) || (c.skipIfOutput && quiet(c.skipIfOutput.cmd).ok);
        if (there) {
          if (!behind.has(c.tool)) continue;
          // Installed at an older pin: undo it, then add it again at the new pin.
          tail.length = 0;
          if (!c.undo.every((argv) => run(undoArgv(argv), { dryRun: false, log: (l) => console.log(tilde(l, o.home)), env: c.env, json: o.json, logFile, tail }))) {
            if (logFile) console.log(redactText(tail.slice(-20).map((l) => `    ${l}`).join('\n'), { home: o.home }));
            console.log(`  ! could not remove the old ${c.desc}; left as it is.${logFile ? ` full output: ${tilde(logFile, o.home)}.` : ''} Fix it by hand, then --update.`);
            failed++;
            errors.push(`could not remove the old ${c.desc}`);
            continue;
          }
        }
        step++;
        if (ui) ui.step(i + 1, commands.length, c.desc);
        else if (!logFile) console.log(`- ${c.desc}`);
        if (c.lifecycle) {
          await agentLifecycle({ mode: 'install', agents: [c.lifecycle], home: o.home, realHome: REAL_HOME, stateDir: stateDir(o.home), dryRun: false, exec: true, yes: true, ask: async (_q, def) => def, yesNo, logFile });
          const bin = c.bins.find((b) => fs.existsSync(b));
          // The installer's PATH change reaches new terminals only: put its folder first here so the agent's steps below find it.
          if (bin) process.env.PATH = `${path.dirname(bin)}${path.delimiter}${process.env.PATH ?? ''}`;
          else { failed++; errors.push(c.desc); noCli.add(c.lifecycle); }
          if (logFile && !ui) { stepLine(c, !!bin); if (!bin) console.log(`  ! failed: ${c.desc}. full output: ${tilde(logFile, o.home)}`); }
          report.push({ desc: c.desc, ok: !!bin, exit: null });
          if (ui) ui.result(!!bin, c.desc);
          continue;
        }
        // Recorded before it runs, so a command killed midway can still be undone.
        const rec = { desc: c.desc, ok: false, undo: c.undo, ...(c.reinstall && { from: c.from, owner: c.owner, reinstall: c.reinstall, reinstallAlways: c.reinstallAlways }), ...(c.env && { env: c.env }), ...(c.resumeKey && { resumeKey: c.resumeKey }) };
        ran.push(rec);
        save();
        const codes = [];
        const before = snap();
        tail.length = 0;
        const out = (l) => console.log(tilde(l, o.home));
        const ok = c.run.every((argv) => { tail.length = 0; return run(argv, { dryRun: false, log: out, env: c.env, json: o.json, codes, logFile, tail }); });
        for (const argv of c.always ?? []) run(argv, { dryRun: false, log: out, env: c.env, json: o.json, logFile, tail });
        if (logFile && !ui) stepLine(c, ok);
        if (logFile && !ok && !ui) showFailure(c);
        else if (logFile && !ok) console.log(redactText(tail.slice(-20).map((l) => `    ${l}`).join('\n'), { home: o.home }));
        refreshHashes(before);
        report.push({ desc: c.desc, ok, exit: codes.at(-1) ?? null });
        if (!ok && !c.optional) errors.push(c.desc);
        if (ui) ui.result(ok || c.optional, c.desc);
        else if (!ok && !c.optional && !logFile) console.log(`  ! failed: ${c.desc}. Run the command above by hand, then --doctor.`);
        // An optional step (Bun) that fails only means Context Mode runs on Node; nothing to undo.
        if (!ok && c.optional) { if (!(logFile && c.tool === 'lean-update')) console.log(c.tool === 'gh' ? '! gh install failed; install it yourself (--no-gh skips it).' : c.tool === 'lean-update' ? '! lean-update skill failed to install; run the command above by hand later.' : '! Bun install failed; Context Mode will run on Node.'); ran.pop(); save(); continue; }
        if (!ok) failed++;
        rec.ok = ok;
        save();
      }
    }
    if (failed) {
      console.log(`\n${failed} step(s) failed; see the lines marked ! above. Backups: ${backupDir}`);
      ui?.summary('Summary', [`${failed} of ${commands.length} commands failed`, `Backups: ${backupDir}`], false);
      process.exitCode = 1;
      return o.json && printApplied(o, files, report, errors);
    }
    finished = true;
    save();
    if (o.json) printApplied(o, files, report, errors);
    console.log(`\nDone. Backups: ${backupDir}`);
    if (!o.project) await summaryPage(o, { updated: o.command === 'update' ? report.filter((r) => r.ok).map((r) => r.desc) : [] });
    if (o.project) return console.log('Next: review and commit these files. Each teammate runs the installer once for the tools (rtk, context-mode, ...).');
    console.log('Next: restart your agents, log in to your providers, then run --doctor.');
    const shell = shellNotice();
    if (shell) console.log(shell.text);
    const rc = files.find((f) => f.id === 'path');
    if (rc) console.log(`Open a new terminal (or run: . ${rc.path}) so the new PATH takes effect.`);
    const todo = stillNeeded({ home: o.home, terminals: o.terminals, agents: o.agents });
    if (todo.length) console.log(`Still needed from you:\n${todo.map((t) => `  - ${t.text}`).join('\n')}`);
    if (o.tools.includes('playwright-extension')) console.log(`Signed-in browser: ${EXTENSION_NOTE}`);
    if (o.tools.includes('code-mode') && o.agents.includes('claude')) console.log(`Code Mode: ${codeModeNote()}`);
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
  } finally { stopOnce(); }
}

// --update --undo (#278): each agent CLI goes back to the version it had before the first upgrade lean-agents ran.
// Plan first; the answer (or --yes) runs it. A failed step is reported and the rest still run; --uninstall never does this.
// It also moves our own extraKnownMarketplaces ref back through the recorded json edit (#546): only that key, so user
// or `claude plugin` changes made since stay.
// The current value at a JSON key path, or undefined when the file or key is gone.
function readPathValue(file, keyPath) {
  try {
    let v = parseJsonc(fs.readFileSync(file, 'utf8'), [], { allowTrailingComma: true });
    for (const k of keyPath) v = v?.[k];
    return v;
  } catch { return undefined; }
}

function marketplaceRestore(S) {
  const entries = (S?.files ?? []).filter((f) => (f.applied ?? []).some((e) => e.marketplace));
  if (!entries.length) return [];
  // One restore per marketplace: across runs the first edit holds the user's original ref and the last holds ours.
  const byName = new Map();
  for (const f of entries) {
    for (const e of f.applied ?? []) {
      if (!e.marketplace) continue;
      const g = byName.get(e.marketplace) ?? { path: f.path, edits: [] };
      g.edits.push(e);
      byName.set(e.marketplace, g);
    }
  }
  const restores = [];
  for (const [marketplace, g] of byName) {
    const edit = { ...g.edits.at(-1), previous: g.edits[0].previous };
    // Already reverted, or the user changed it since: it is not ours to move back.
    if (JSON.stringify(readPathValue(g.path, edit.path)) !== JSON.stringify(edit.value)) continue;
    restores.push({ path: g.path, marketplace, edit });
  }
  return restores;
}

async function undoAgentUpgrades(o) {
  const S = readState(o.home);
  const stamps = agentStamps(stateDir(o.home));
  const todo = undoPlan(S?.commands ?? [], stamps);
  const restore = marketplaceRestore(S);
  if (!todo.length && !restore.length) { console.log('nothing to undo: no agent CLI upgrade or marketplace pin move by lean-agents is recorded'); return true; }
  console.log('lean-agents --update --undo plan (the oldest saved version per agent):');
  for (const c of todo) {
    console.log(`  - ${agentOf(c)}: back to ${c.from}`);
    for (const argv of [...c.reinstall, ...(c.reinstallAlways ?? [])]) console.log(`      $ ${argv.join(' ')}`);
  }
  for (const r of restore) console.log(`  - ${tilde(r.path, o.home)}: marketplace ref ${r.edit.value} -> ${r.edit.previous ?? '(none)'}`);
  if (o.dryRun) { console.log('Dry run: nothing was changed.'); return true; }
  let ok = true;
  if (todo.length) {
    if (!o.exec) { console.log('--no-exec: nothing was run. Not done.'); return false; }
    if (!o.yes && !(process.stdin.isTTY && process.stdout.isTTY)) { console.log('No terminal to ask on: --yes runs it. Not done.'); return false; }
    const p = await prompter(o.yes);
    try { if (!yesNo(await p.ask('Reinstall these versions?', o.yes ? 'y' : 'n'))) { console.log('Cancelled.'); return true; } } finally { p.close(); }
    Object.assign(process.env, childEnv(S.options.network));
    const { ok: agentsOk, restored } = undoUpgrades(todo, {}, stamps);
    ok = agentsOk;
    // A restored agent's records are spent; a failed one keeps them so the next --update --undo retries it.
    S.commands = S.commands.filter((c) => !(c.reinstall && restored.has(agentOf(c))));
    S.updatedAt = new Date().toISOString();
    writePrivate(path.join(stateDir(o.home), 'state.json'), `${JSON.stringify(S, null, 2)}\n`);
  }
  if (restore.length) {
    if (!o.yes && !(process.stdin.isTTY && process.stdout.isTTY)) { console.log('No terminal to ask on: --yes restores the marketplace ref. Not done.'); return false; }
    const p = await prompter(o.yes);
    let go;
    try { go = yesNo(await p.ask('Restore the marketplace ref?', o.yes ? 'y' : 'n')); } finally { p.close(); }
    if (!go) { console.log('Cancelled.'); return ok; }
    // One undo entry per file, carrying every marketplace edit for it.
    const files = new Map();
    for (const r of restore) {
      const g = files.get(r.path) ?? { path: r.path, kind: 'json', applied: [], hash: sha(fs.readFileSync(r.path, 'utf8')) };
      g.applied.push(r.edit);
      files.set(r.path, g);
    }
    const report = new Map(undo([...files.values()], writeRoots(o)).map(([status, p]) => [p, status]));
    for (const r of restore) console.log(`- ${report.get(r.path)} ${tilde(r.path, o.home)} (${r.marketplace} marketplace ref ${r.edit.previous ?? '(none)'})`);
  }
  return ok;
}

// The state of a machine where only an upgrade step ran (nothing else installed yet).
const blankState = () => ({ version: JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version, installedAt: new Date().toISOString(), pins: {}, options: { agents: [], tools: [], terminals: [], unverified: {}, gh: false, lang: 'en', profile: null, network: {} }, files: [], commands: [] });

// The 1.x config the verified backup saved: opencode1 runs on a copy of it, not on the live (2.x) config.
const snapshot1x = (home) => { const st = readBackupStamp(home); return st ? path.join(st.dir, 'config') : null; };

// `opencode1` (P4). The state is saved after every step, so an error midway still leaves something --uninstall can undo.
function sideBySide(o) {
  const p = planOpencode1({ home: o.home, exec: o.exec, configSnapshot: snapshot1x(o.home) });
  if (!p.ok) { console.log(`refused, nothing changed:\n${p.problems.map((x) => `  - ${x}`).join('\n')}`); return false; }
  const win = process.platform === 'win32';
  console.log(`${o.dryRun || !o.yes ? 'dry run: would set up' : 'setting up'} opencode1 (OpenCode ${p.version}, from ${p.source})`);
  console.log(`  binary copy: ${p.binary}\n  shim:        ${p.actions[0].path}\n  PATH:        ${win ? `user PATH (HKCU) gets ${p.pathDir}` : `${p.actions.slice(1).map((a) => a.path).join(', ')} gets a marked block`}`);
  console.log(`  1.x reads and writes only ${opencode1Layout(o.home).frozen} and its own config copy in ${opencode1Layout(o.home).config}; the live data and config are not touched`);
  if (o.dryRun || !o.yes) { console.log('dry run: nothing was written'); return true; }
  const previous = readState(o.home);
  const files = [];
  const save = (record) => {
    const state = previous ?? blankState();
    privateDir(stateDir(o.home), stateDir(o.home));
    writePrivate(path.join(stateDir(o.home), 'state.json'), `${JSON.stringify({ ...state, updatedAt: new Date().toISOString(), files: [...state.files, ...files], opencode1: record }, null, 2)}\n`);
  };
  const ts = new Date().toISOString().replace(/\D/g, '');
  installOpencode1(p, { home: o.home, roots: [...writeRoots(o), opencode1Layout(o.home).root], backupDir: path.join(stateDir(o.home), 'backups', ts), apply, files, onRecord: save });
  console.log('done: run `opencode1 --version` in a new terminal. `--uninstall` removes it; the backup and the frozen copy stay.');
  return true;
}

// `--upgrade-agent opencode --yes` / `--undo` (#80 part 2, P6). The journal is state.json `upgrade`; the steps are in lib/opencode-upgrade.mjs.
function upgradeDeps(o, S, save, extra) {
  const ts = new Date().toISOString().replace(/\D/g, '');
  const rulesPath = path.join(stateDir(o.home), 'AGENTS.md');
  // The adapter's file and JSON actions only: its commands (npx skill installs, git clones) are not run by an upgrade.
  const adapterFor = (tools) => {
    const saved = S.options ?? {};
    const opts = { tools, network: saved.network ?? {}, keepUpdater: !!saved.keepUpdater, terminals: [], platform: process.platform, env: process.env, shell: 'default', ponytailMode: saved.ponytailMode ?? 'lite', adhdAlways: false };
    const r = opencodeV2Adapter({ home: o.home, core: loadCore(ROOT), profile: null, opts, rulesPath: rulesPath.split(path.sep).join('/') });
    if (r.commands.length) console.log(`  ${r.commands.length} adapter command(s) not run by the upgrade; --update runs them`);
    // No rules file (lean-agents never installed the rules here): do not point `instructions` at a missing file.
    return fs.existsSync(rulesPath) ? r : { ...r, actions: r.actions.map((a) => (a.kind === 'json' ? { ...a, edits: a.edits.filter((e) => e.path[0] !== 'instructions') } : a)) };
  };
  const lifecycle = (mode) => agentLifecycle({ mode, fromUpgrade: true, agents: ['opencode-v2'], home: o.home, realHome: REAL_HOME, stateDir: stateDir(o.home), dryRun: false, exec: o.exec, yes: true, ask: async (_q, def) => def, yesNo });
  const d = {
    home: o.home, platform: process.platform, log: console.log, state: S, save, roots: writeRoots(o), which,
    tools: { config: (S.options?.tools ?? []).filter((t) => t !== 'dcp'), dcp: ['dcp'] },
    adapterFor, backupDir: (name) => path.join(stateDir(o.home), 'backups', `${ts}-${name}`),
    manual: agentTable({ home: o.home, platform: process.platform, dir: stateDir(o.home), realHome: REAL_HOME })['opencode-v2'].manual,
    plan1: () => planOpencode1({ home: o.home, exec: o.exec, configSnapshot: snapshot1x(o.home) }),
    install1: (p, files, onRecord) => installOpencode1(p, { home: o.home, roots: [...writeRoots(o), opencode1Layout(o.home).root], backupDir: path.join(stateDir(o.home), 'backups', `${ts}-opencode1`), apply, files, onRecord }),
    installAgent: () => lifecycle('install'),
    uninstallAgent: () => lifecycle('uninstall'),
    ...extra,
  };
  return d;
}

// Temp file then rename: a kill midway never leaves a truncated state.json (it holds the journal --undo needs).
function saveJournalState(o, S) {
  S.updatedAt = new Date().toISOString();
  const dir = stateDir(o.home);
  privateDir(dir, dir);
  const file = path.join(dir, 'state.json');
  writePrivate(`${file}.tmp`, `${JSON.stringify(S, null, 2)}\n`);
  renameRetry(`${file}.tmp`, file);
}

const refuse = (problems) => { console.log(`refused, nothing changed:\n${problems.map((x) => `  - ${x}`).join('\n')}`); return false; };

// #548: one visible command row, only when this run started the OpenCode 2 service; a failure is a warning, not a crash.
function stopStartedOpenCode(o, before) {
  if (!o.exec || o.dryRun) return;
  const row = serviceStopRow({ before, agents: o.agents });
  if (!row) return;
  const say = o.json ? console.error : console.log; // --json keeps stdout for the one JSON object
  say(`- ${row.desc}`);
  const ok = run(row.run[0], { dryRun: false, log: (l) => say(tilde(l, o.home)), json: o.json });
  say(ok
    ? 'lean-agents stopped the OpenCode 2 background service its commands started.'
    : '! lean-agents could not stop the OpenCode 2 background service its commands started: run `opencode service stop` by hand.');
}

// How to update rtk with the package manager at hand (the #467 skip warning and the upgrade plan share it).
const rtkUpdateHow = () => {
  const pm = packageManager();
  return pm === 'brew' ? 'brew upgrade rtk' : pm === 'winget' ? 'winget upgrade --id rtk-ai.rtk -e' : prereqFor('rtk', pm).manual;
};
// rtk as the upgrade plan sees it. Not probed without exec (dry runs, tests): the plan then assumes a usable rtk.
const rtkForUpgrade = (o) => {
  if (!o.exec) return { state: 'ok' };
  if (!which('rtk')) return { state: 'missing', how: rtkUpdateHow() };
  const version = binVersion('rtk');
  return rtkTooOld(version) ? { state: 'old', version, how: rtkUpdateHow() } : { state: 'ok', version };
};

async function applyUpgrade(o) {
  const fail = failAt();
  const S = readState(o.home) ?? blankState();
  const stamp = readBackupStamp(o.home);
  const { problems, baseline } = applyPreflight({ home: o.home, stamp, upgrade: S.upgrade, exec: o.exec, list: listProcesses, opencodeRunning });
  if (problems.length) return refuse(problems);
  const save = () => saveJournalState(o, S);
  const inv = upgradeInventory(await inventory({ home: o.home, env: process.env, realHome: REAL_HOME }), { home: o.home, tools: S.options?.tools ?? [], rtk: rtkForUpgrade(o) });
  const steps = createSteps(upgradeDeps(o, S, save, { inv, stamp }));
  S.upgrade = { backup: stamp.dir, baseline };
  const ctx = makeCtx({ home: o.home, stamp, journal: S.upgrade });
  console.log(`applying the OpenCode upgrade: verified backup ${stamp.dir} (${stamp.sessions} sessions)`);
  const ok = await runApply({ steps, journal: S.upgrade, save, ctx, fail, restore: () => restoreData({ home: o.home, backupDir: stamp.dir }) });
  if (!ok) { process.exitCode = 1; return false; }
  console.log('done. Start OpenCode 2 once: it migrates the live session db (the backup and the frozen copy hold the 1.x state). `opencode1` runs 1.x on the frozen copy.\n`--upgrade-agent opencode --undo --yes` goes back to 1.x; the backup and the frozen copy are never deleted.');
  const next = nextRtkStep(inv);
  if (next) console.log(next);
  return true;
}

async function undoUpgrade(o) {
  const S = readState(o.home);
  const journal = S?.upgrade;
  if (!isActive(journal)) { console.log('nothing to undo: no OpenCode upgrade is active (the backup and the frozen copy are kept either way)'); return true; }
  const L = backupLayout(o.home, 'x');
  // The journal names the backup folder: only one inside lean-agents' own backups folder is used.
  if (typeof journal.backup !== 'string' || path.dirname(journal.backup) !== path.dirname(L.backup) || !/^opencode1-sessions-\d{8}T\d{6}Z$/.test(path.basename(journal.backup)) || !Array.isArray(journal.steps)) return refuse([`the journal names a backup outside ${path.dirname(L.backup)}: not used`]);
  const stamp = { dir: journal.backup, frozen: L.frozen };
  const todo = journal.steps.filter((s) => s.status !== 'undone').reverse().map((s) => s.id);
  console.log(`undo: ${todo.length ? todo.join(', ') : 'no step left to undo'}, then the 1.x data comes back from ${L.frozen} (the 2.x db is moved aside, never deleted)`);
  if (o.dryRun || !o.yes) { console.log('dry run: nothing was changed (--yes does it)'); return true; }
  const problems = [];
  try { if (opencodeRunning(listProcesses())) problems.push(OPENCODE_RUNNING); } catch (e) { problems.push(`cannot list the running processes (${String(e.message).split('\n')[0]}): not safe to continue`); }
  const bad = verifyBackup(stamp.dir);
  if (bad.length) problems.push(`the backup does not match its manifest (${bad[0]}): not used; see ${path.join(stamp.dir, 'RESTORE.md')}`);
  if (!o.exec) problems.push('--no-exec: undo may run the OpenCode 2 uninstall and a `--version` probe');
  if (problems.length) return refuse(problems);
  const save = () => saveJournalState(o, S);
  const steps = createSteps(upgradeDeps(o, S, save, { stamp, inv: { items: [] } }));
  const ctx = makeCtx({ home: o.home, stamp, journal });
  const ok = await runUndo({ steps, journal, save, ctx, restore: () => restoreData({ home: o.home, backupDir: stamp.dir }) });
  if (!ok) { process.exitCode = 1; return false; }
  const drift = configDrift(L, stamp.dir);
  if (drift.length) console.log(`! these config files differ from the 1.x snapshot in the backup (left as they are): ${drift.join(', ')}`);
  const kept2x = journal.steps?.find((x) => x.id === 'install2x')?.kept2x;
  console.log(`undone: OpenCode 1.x data${kept2x ? ' is back; OpenCode 2 stays (see the ! line above)' : ' and binary are back'}. The backup (${stamp.dir}) and the frozen copy (${L.frozen}) are kept.`);
  return true;
}

// --uninstall after an applied upgrade: undo the files the opencode1, config and dcp steps wrote (same entry undo as --undo, roots
// checked there). No 1.x restore, no 2.x uninstall, no data restore: the journal is archived right after.
async function revertUpgradeFiles(o, S) {
  const steps = createSteps(upgradeDeps(o, S, () => {}, { stamp: {}, inv: { items: [] } }));
  const recs = Array.isArray(S.upgrade.steps) ? S.upgrade.steps : [];
  for (const rec of [...recs].reverse()) {
    const step = ['opencode1', 'config', 'dcp'].includes(rec?.id) && rec.status !== 'undone' ? steps.find((x) => x.id === rec.id) : null;
    if (step) await step.undo(rec, null);
  }
}

// The finish-step page (#181): an owned file in the state dir (--uninstall removes it). Returns its path, or null when nothing was written.
async function summaryPage(o, { updated = [] } = {}) {
  const state = readState(o.home);
  if (!state) return null;
  const rows = [];
  doctor({ home: o.home, state, exec: o.exec, nodeVersion: NODE_VERSION, collect: rows });
  const network = state.options.network ?? o.network;
  const lang = o.lang ?? state.options.lang ?? 'en';
  const model = buildSummary({
    state, rows, updated, home: [o.home, os.homedir()], lang,
    applied: { ok: true, version: state.version, files: state.files.map((f) => f.path), commands: state.commands.map((c) => ({ desc: c.desc, ok: c.ok })), errors: [] },
    logins: loginRows({ agents: state.options.agents, gh: !!state.options.gh, exec: o.exec, outbound: network.outbound }),
  });
  const file = path.join(stateDir(o.home), 'summary.html');
  const content = renderSummary({ model, filed: state.filedIssues, network, home: [o.home, os.homedir()] });
  const [planned] = plan([{ kind: 'file', path: file, content }], writeRoots(o), state.files);
  if (planned.status === 'skip') { console.log(`Summary page not written: ${file} ${planned.note}.`); return null; }
  const [entry] = apply([planned], path.join(stateDir(o.home), 'backups', 'summary'), o.home, writeRoots(o));
  if (entry) {
    // A rewrite keeps the first record (created, backup), so --uninstall still removes the file.
    const first = state.files.find((f) => f.path === file);
    state.files = [...state.files.filter((f) => f !== first), { ...entry, ...(first && { created: first.created, backup: first.backup }) }];
    writePrivate(path.join(stateDir(o.home), 'state.json'), `${JSON.stringify(state, null, 2)}\n`);
  }
  console.log(`Summary page: ${file}`);
  if (canOffer({ noOpen: o.noOpen, yes: o.yes, json: o.json, tty: process.stdin.isTTY && process.stdout.isTTY })) {
    const p = await prompter(false);
    try { if (yesNo(await p.ask('Open it in your browser?', 'n'))) quiet(openArgv(process.platform, file), 15000); } finally { p.close(); }
  }
  return file;
}

// --summary: rebuild the page from state.json, after recording the issues the verify prompt filed (--filed-issue "item=url").
async function summaryCommand(o) {
  const state = readState(o.home);
  if (!state) { console.log('lean-agents is not installed: nothing to summarize.'); process.exitCode = 1; return; }
  if (o.filedIssues?.length) {
    const home = [o.home, os.homedir()];
    for (const f of o.filedIssues) {
      const at = f.lastIndexOf('=');
      if (at < 1) throw new Error('--filed-issue takes "item=issue url"');
      state.filedIssues = addFiledIssue(state.filedIssues, { item: f.slice(0, at), title: f.slice(0, at), url: f.slice(at + 1) }, { home });
    }
    writePrivate(path.join(stateDir(o.home), 'state.json'), `${JSON.stringify(state, null, 2)}\n`);
  }
  if (!(await summaryPage(o))) process.exitCode = 1;
}

async function uninstall(o) {
  const state = readState(o.home);
  if (!state) { console.log('lean-agents is not installed.'); return; }
  // A settled upgrade (`applied` never moves on by itself) must not block --uninstall for a user who stays on 2.x. Any other live
  // status is a half-done apply or undo: finish it with --undo first. --uninstall archives the journal, so --undo is gone after it.
  const up = state.upgrade;
  if (isActive(up) && up.status !== 'applied') throw new Error(`an OpenCode upgrade is ${up.status}: run --upgrade-agent opencode --undo first (it restores your 1.x data), then --uninstall`);
  if (isActive(up)) {
    const kept = typeof up.backup === 'string' ? `the 1.x backup (${up.backup}, see RESTORE.md in it)` : 'the 1.x backup';
    console.log(`! the OpenCode 2 upgrade stays: --uninstall does not go back to 1.x, and its journal is archived, so --undo is no longer available afterwards.\n  Removed: what the upgrade added (the opencode1 shim and PATH block, the managed 2.x config and DCP edits).\n  Kept: your data (the live 2.x sessions), ${kept}, the frozen copy and the OpenCode 2 install. To go back to 1.x, run --upgrade-agent opencode --undo --yes first.`);
  }
  const p = await prompter(o.yes);
  console.log(`This restores ${state.files.length} files and undoes ${state.commands.length} commands.`);
  if (o.dryRun) {
    for (const c of [...state.commands].reverse()) {
      if (c.undo?.length) console.log(`  - undo: ${c.desc}${c.agent ? ` (${c.agent})` : ''}`);
    }
  }
  if (o.dryRun || !yesNo(await p.ask('Uninstall?', o.yes ? 'y' : 'n'))) { p.close(); console.log('Nothing changed.'); return; }
  p.close();
  if (!o.exec && state.commands.length) throw new Error('--no-exec cannot undo the commands this install ran; run --uninstall without it');
  const failed = new Map();
  if (o.exec) {
    for (const c of [...state.commands].reverse()) {
      const bad = (c.undo ?? []).filter((argv) => !run(undoArgv(argv), { dryRun: false, log: console.log, env: c.env }));
      if (bad.length) {
        if (c.ok === false) {
          console.log('  (it did not finish, so there may be nothing to remove)');
        } else {
          console.log('  ! failed. Run the command above by hand.');
          process.exitCode = 1;
          failed.set(c, bad);
        }
      }
    }
  }
  if (state.toolNode?.installedByLean) console.log(`Kept Node v${state.toolNode.version} (lean-agents never removes a Node); remove it with \`nvm uninstall ${state.toolNode.version}\`.`);
  if (isActive(up)) await revertUpgradeFiles(o, state);
  const report = undo(state.files, writeRoots(o));
  if (state.opencode1) report.push(...removeOpencode1(state.opencode1, { home: o.home }));
  for (const [what, file] of report) console.log(`  ${what.padEnd(20)} ${file}`);
  if (report.some(([what]) => what === 'left (symlink)')) console.log('  ! Paths marked "left (symlink)" were not touched; remove our lines there by hand.');
  const stateFile = path.join(stateDir(o.home), 'state.json');
  if (failed.size) {
    // Files are already restored; keep only the failed undo argvs, so a second --uninstall retries them.
    const commands = state.commands.filter((c) => failed.has(c)).map((c) => ({ ...c, undo: failed.get(c) }));
    writePrivate(stateFile, `${JSON.stringify({ ...state, files: [], commands, opencode1: undefined, upgrade: undefined }, null, 2)}\n`);
    console.log(`Not finished: ${failed.size} undo command(s) failed and stay recorded. Fix the cause (or run them by hand), then run --uninstall again.`);
    return;
  }
  fs.rmSync(path.join(stateDir(o.home), 'logs'), { recursive: true, force: true }); // the per-run step logs (#491)
  renameRetry(stateFile, path.join(stateDir(o.home), `state.uninstalled-${Date.now()}.json`));
  if (state.adopt) {
    saveState(stateDir(o.home), state.adopt);
    console.log('  kept: the --adopt record; undo it with --adopt --undo');
  }
  // Backups are the only undo for edits we cannot revert, so they stay unless the user says yes (--yes keeps them).
  const backups = path.join(stateDir(o.home), 'backups');
  const q = await prompter(o.yes);
  const drop = fs.existsSync(backups) && yesNo(await q.ask(`Delete backups in ${backups}?`, 'n'));
  q.close();
  if (drop) dropBackups(backups);
  console.log(drop ? 'Uninstalled. Backups deleted.' : `Uninstalled. Backups are kept in ${backups}.`);
}

// --install-agent / --uninstall-agent vscode-copilot: the engine's own install, and an undo scoped to this adapter's files.
function vscodeHooks(o) {
  const configured = () => !!readState(o.home)?.options.agents.includes('vscode-copilot');
  const configure = () => {
    const saved = readState(o.home);
    // Tools and terminals stay as chosen before (none on a first run): this verb adds the agent only, so it asks nothing about them.
    return install({ ...o, command: 'install', yes: o.yes || o.dryRun, agents: [...new Set([...(saved?.options.agents ?? []), 'vscode-copilot'])], tools: o.tools ?? saved?.options.tools ?? [], terminals: o.terminals ?? saved?.options.terminals ?? [] });
  };
  const uninstallScoped = async () => {
    const state = readState(o.home);
    const core = loadCore(ROOT);
    const planned = vscodeCopilotAdapter({ home: o.home, core, profile: loadProfile(ROOT, FIXED_PROFILE['vscode-copilot']), opts: state.options, rules: '', adhdCommand: adhdCommand(o.home) });
    const mine = new Set(planned.actions.map((a) => a.path));
    const files = state.files.filter((f) => mine.has(f.path));
    const commands = state.commands.filter((c) => c.agent === 'vscode-copilot');
    console.log(`This restores ${files.length} files and undoes ${commands.length} commands, all written for vscode-copilot.`);
    if (o.dryRun) {
      for (const c of [...commands].reverse()) {
        if (c.undo?.length) console.log(`  - undo: ${c.desc}${c.agent ? ` (${c.agent})` : ''}`);
      }
    }
    const p = await prompter(o.yes);
    const ok = !o.dryRun && yesNo(await p.ask('Remove the vscode-copilot config?', o.yes ? 'y' : 'n'));
    p.close();
    if (!ok) { console.log('Nothing changed.'); return; }
    if (!o.exec && commands.length) throw new Error('--no-exec cannot undo the commands this install ran; run it without --no-exec');
    for (const c of o.exec ? [...commands].reverse() : []) {
      for (const argv of c.undo ?? []) if (!run(undoArgv(argv), { dryRun: false, log: console.log, env: c.env })) { console.log('  ! failed. Run the command above by hand.'); process.exitCode = 1; }
    }
    for (const [what, file] of undo(files, writeRoots(o))) console.log(`  ${what.padEnd(20)} ${file}`);
    const file = path.join(stateDir(o.home), 'state.json');
    writePrivate(file, `${JSON.stringify({ ...state, options: { ...state.options, agents: state.options.agents.filter((a) => a !== 'vscode-copilot') }, files: state.files.filter((f) => !mine.has(f.path)), commands: state.commands.filter((c) => c.agent !== 'vscode-copilot') }, null, 2)}\n`);
    console.log('vscode-copilot: removed. Your other config and the extension were not touched.');
  };
  return { configured, install: configure, uninstall: uninstallScoped };
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

// Below the engines floor, read-only paths still report; anything that writes or runs commands stops.
function checkNodeFloor(o) {
  const floor = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).engines.node;
  // LEAN_AGENTS_NODE may fake a lower version for tests, never a higher one (#229).
  // A malformed or prerelease override (`abc`, `22.20.0-rc.1`) is cleaned or ignored (#235).
  const fake = (process.env.LEAN_AGENTS_NODE ?? '').replace(/-.*/, '');
  const override = /^v?\d+(\.\d+){0,2}$/.test(fake) ? fake.replace(/^v/, '').split('.').concat('0', '0').slice(0, 3).join('.') : null;
  const running = [process.versions.node, override].find((v) => v && !satisfies(v, floor));
  if (!running) return;
  const readOnly = ['help', 'version', 'doctor', 'preflight', 'usage', 'feedback'].includes(o.command) || (o.command === 'upgrade-agent' && !o.yes) || o.dryRun || (o.command === 'adopt' && !o.yes && !o.undo);
  const allow = process.env.LEAN_AGENTS_ALLOW_OLD_NODE === '1';
  const nvm = findNvm({ env: process.env, home: os.homedir(), platform: process.platform, realHome: REAL_HOME });
  const nodes = nvm ? installedNodes(nvm) : [];
  const fix = nodeFloorFix(floor, nodes);
  console.error(`lean-agents: Node ${running} is older than ${floor.replace(/^>=/, '')}, which lean-agents needs. Fix: ${fix}, or run install.sh.${readOnly || allow ? '' : ' Set LEAN_AGENTS_ALLOW_OLD_NODE=1 to run anyway.'}`);
  if (!readOnly && !allow) process.exit(1);
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  checkNodeFloor(o);
  // A repository gets files only: tools and agents stay per user.
  if (o.project && o.agents?.length && !o.migrate) throw new Error('--project writes repository files only: run --agents in a separate install');
  if (o.project) { project = o.project; if (!o.migrate) { o.agents = []; o.exec = false; } }
  // --json keeps stdout for the one JSON object; every message goes to stderr.
  if (o.json) console.log = console.error;
  isolate(o.home);
  shareProxy();
  if (o.command === 'help') return console.log(HELP);
  if (o.command === 'version') return console.log(JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version);
  if (o.command === 'preflight') {
    const report = preflight({ home: o.home, exec: o.exec });
    process.stdout.write(`${formatPreflight(report, { home: o.home, json: o.json })}\n`);
    return process.exit(report.ok ? 0 : 1);
  }
  if (o.command === 'doctor') {
    const state = readState(o.home);
    const probe = o.probePlugins && state?.options.agents.some((a) => a.startsWith('opencode')) ? await probePlugins(o.home) : [];
    return process.exit(doctor({ home: o.home, state, exec: o.exec, nodeVersion: NODE_VERSION, json: o.json, probe, probed: !!o.probePlugins }) ? 0 : 1);
  }
  if (o.command === 'upgrade-agent' && o.upgradeAgent === 'vscode-copilot') {
    if (o.backup || o.opencode1 || o.undo) throw new Error('--upgrade-agent vscode-copilot takes no other flags');
    console.log(`vscode-copilot: ${VSCODE_NOTE}\nNothing to upgrade here. To refresh the files lean-agents wrote (rules, agents, mcp.json), run --update.`);
    return;
  }
  if (o.command === 'upgrade-agent') {
    if (o.backup) {
      if (o.undo) throw new Error('--upgrade-agent opencode --backup has no --undo: the backup is permanent and lean-agents never deletes it');
      const r = backupOpencode({ home: o.home, dryRun: o.dryRun || !o.yes });
      return process.exit(r.ok ? 0 : 1);
    }
    if (o.opencode1) {
      if (o.undo) throw new Error('--upgrade-agent opencode --opencode1 has no --undo yet: run --uninstall');
      return process.exit(sideBySide(o) ? 0 : 1);
    }
    if (o.undo) return process.exit((await undoUpgrade(o)) ? 0 : 1);
    if (o.yes && !o.dryRun) return process.exit((await applyUpgrade(o)) ? 0 : 1);
    const env = process.env;
    const inv = await inventory({ home: o.home, env, realHome: REAL_HOME });
    const bin = which('opencode');
    // With --home elsewhere, `opencode --version` would still run the real agent (it writes logs): report it as not probed.
    const norm = (p) => (process.platform === 'win32' ? path.resolve(p).toLowerCase() : path.resolve(p));
    const own = norm(o.home) === norm(REAL_HOME);
    const binVer = bin && o.exec ? (own ? binVersion('opencode') : 'not probed (--home)') : null;
    const r = upgradeInventory(inv, { home: o.home, binary: { path: bin, version: binVer }, tools: readState(o.home)?.options?.tools ?? [], rtk: rtkForUpgrade(o) });
    if (o.json) process.stdout.write(`${JSON.stringify(r, null, 2)}\n`); else console.log(formatUpgrade(r));
    return process.exit(0);
  }
  if (o.backup) throw new Error('--backup goes with --upgrade-agent opencode');
  if (o.command === 'update' && o.undo && o.json) throw new Error('--update --undo has no --json output: the plan and the results are text');
  if (o.command === 'update' && o.undo) return process.exit((await undoAgentUpgrades(o)) ? 0 : 1);
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
  if (o.command === 'agent') {
    const p = await prompter(o.yes);
    try { return await agentLifecycle({ mode: o.agentMode, agents: o.agentList, home: o.home, realHome: REAL_HOME, stateDir: stateDir(o.home), dryRun: o.dryRun, exec: o.exec, yes: o.yes, ask: p.ask, yesNo, vscode: vscodeHooks(o) }); } finally { p.close(); }
  }
  if (o.command === 'feedback') return feedback(o);
  if (o.command === 'summary') return summaryCommand(o);
  if (o.command === 'uninstall') return uninstall(o);
  return install(o);
}

main().catch((e) => {
  console.error(`lean-agents: ${e.message}`);
  process.exit(1);
});
