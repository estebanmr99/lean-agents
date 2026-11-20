// Warp and Orca: detect the app, then plan the agent integrations for a user who already has it.
// The terminal apps themselves are never installed.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { which, quiet } from './system.mjs';
import { hasProxy } from './network.mjs';
import { skillSource, skillsCli, PINS } from './pins.mjs';
import { fileURLToPath } from 'node:url';

const VERIFY = fileURLToPath(new URL('./verify-sha256.mjs', import.meta.url));

export const TERMINALS = ['warp', 'orca'];
// Skills CLI agent ids; VS Code Copilot reads ~/.copilot/skills like Copilot CLI.
const ORCA_SKILL_AGENT = { claude: 'claude-code', 'opencode-v1': 'opencode', 'opencode-v2': 'opencode', 'copilot-cli': 'github-copilot', 'vscode-copilot': 'github-copilot', cursor: 'cursor', antigravity: 'antigravity-cli' };
// Orca's hooks POST status to 127.0.0.1; Windows curl sends loopback to the proxy unless NO_PROXY lists it.
const LOOPBACK = ['localhost', '127.0.0.1', '::1'];
const ORCA_TELEMETRY_ENV = ['DO_NOT_TRACK', 'ORCA_TELEMETRY_DISABLED'];
const ps = (script) => ['powershell', '-NoProfile', '-NonInteractive', '-Command', script];

// `platform` and `env` are parameters so tests can fake an OS without touching the machine.
export function detectTerminals(home, { platform = process.platform, env = process.env, system = true } = {}) {
  const has = (...paths) => paths.some((p) => p && fs.existsSync(p));
  const found = [];
  // `system` is false for a run with --home: it looks only inside it, so a throwaway HOME behaves the same on every machine.
  const apps = platform === 'darwin' ? [path.join(home, 'Applications'), ...(system ? ['/Applications'] : [])] : [];
  const local = platform === 'win32' && system ? env.LOCALAPPDATA : null;
  // PATH lookups are system-wide, so they follow `system` too. Linux `orca` is the GNOME screen reader: not a signal.
  // Windows install folders under Programs: VERIFY.
  const onPath = (bin) => system && which(bin);
  if (has(...apps.map((d) => path.join(d, 'Warp.app')), local && path.join(local, 'Programs', 'Warp')) || onPath('warp-terminal')) found.push('warp');
  if (has(...apps.map((d) => path.join(d, 'Orca.app')), local && path.join(local, 'Programs', 'Orca')) || (platform !== 'linux' && onPath('orca'))) found.push('orca');
  return found;
}

// --terminal value to a list; "both" and "none" are shorthands.
export function parseTerminal(v) {
  if (v === 'both') return [...TERMINALS];
  if (v === 'none') return [];
  if (TERMINALS.includes(v)) return [v];
  throw new Error('--terminal takes warp, orca, both or none');
}

// Commands only: OpenCode plugin entries go into the OpenCode adapter's own json edit, because two
// json actions on one file would each start from the unedited text.
// `system` is false for --home runs: Windows user env changes are real-machine only.
export function terminalCommands({ home, terminals = [], installTerminals = [], agents = [], network = {}, platform = process.platform, env = process.env, system = true, readEnv = readWindowsEnv }) {
  const commands = [];
  
  const arch = platform === 'darwin' ? process.arch : 'x64';
  const warpPin = PINS['warp-app'];
  const orcaPin = PINS['orca-app'];
  const canInstall = system && (platform === 'darwin' || platform === 'win32');

  if (canInstall && installTerminals.includes('warp')) {
    if (platform === 'darwin') {
      commands.push({
        tool: 'warp',
        desc: 'Install Warp app',
        skipIfExists: [path.join(home, 'Applications', 'Warp.app'), '/Applications/Warp.app'],
        run: [['bash', '-c', 'if command -v brew >/dev/null 2>&1; then brew install --cask warp; else echo "Error: Homebrew is required to install Warp on macOS. Please install Warp manually from https://warp.dev" >&2; exit 1; fi']],
        undo: [['bash', '-c', 'if command -v brew >/dev/null 2>&1; then brew uninstall --cask warp; fi']],
      });
    } else if (platform === 'win32') {
      const url = warpPin.url['windows-x64'];
      const sha = warpPin.sha256['windows-x64'];
      const exe = path.join(os.tmpdir(), 'warp-installer.exe');
      const local = env.LOCALAPPDATA;
      commands.push({
        tool: 'warp',
        desc: 'Install Warp app',
        skipIfExists: [`${local}\\Programs\\Warp`],
        run: [
          ['curl', '-fsSL', '-o', exe, url],
          ['node', VERIFY, exe, sha],
          [exe, '/CURRENTUSER', '/VERYSILENT']
        ],
        always: [
          ps(`if (Test-Path "${exe}") { Remove-Item "${exe}" }`)
        ],
        // Inno Setup cancels silently while Warp runs and relaunches from %TEMP%; refuse, then wait for it.
        undo: [ps(`$u = "$env:LOCALAPPDATA\\Programs\\Warp\\unins000.exe"; if (-not (Test-Path $u)) { exit 0 }; if (Get-Process -Name warp -ErrorAction SilentlyContinue) { Write-Error 'Warp is running: close it, then run --uninstall again'; exit 1 }; $p = Start-Process -FilePath $u -ArgumentList '/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART' -Wait -PassThru; for ($i = 0; $i -lt 30 -and (Test-Path $u); $i++) { Start-Sleep 2 }; if (Test-Path $u) { Write-Error "Warp uninstaller exit code $($p.ExitCode)"; exit 1 }`)],
      });
    }
  }

  if (canInstall && installTerminals.includes('orca')) {
    if (platform === 'darwin') {
      const key = arch === 'arm64' ? 'darwin-arm64' : 'darwin-x64';
      const url = orcaPin.url[key];
      const sha = orcaPin.sha256[key];
      const script = `set -e
DIR=$(mktemp -d)
MOUNT="$DIR/mount"
MOUNTED=0
cleanup() {
  if [ "$MOUNTED" -eq 1 ]; then
    hdiutil detach "$MOUNT" -force >/dev/null 2>&1 || true
  fi
  rm -rf "$DIR"
}
trap cleanup EXIT
curl -fsSL -o "$DIR/orca.dmg" "${url}"
node "${VERIFY}" "$DIR/orca.dmg" "${sha}"
hdiutil attach -nobrowse -readonly -mountpoint "$MOUNT" "$DIR/orca.dmg"
MOUNTED=1
mkdir -p "${home}/Applications"
ditto "$MOUNT/Orca.app" "${home}/Applications/Orca.app"
`;
      commands.push({
        tool: 'orca',
        desc: 'Install Orca app',
        skipIfExists: [path.join(home, 'Applications', 'Orca.app'), '/Applications/Orca.app'],
        run: [
          ['bash', '-c', script]
        ],
        undo: [['rm', '-rf', path.join(home, 'Applications', 'Orca.app')]],
      });
    } else if (platform === 'win32') {
      const url = orcaPin.url['windows-x64'];
      const sha = orcaPin.sha256['windows-x64'];
      const exe = path.join(os.tmpdir(), 'orca-installer.exe');
      const local = env.LOCALAPPDATA;
      commands.push({
        tool: 'orca',
        desc: 'Install Orca app',
        skipIfExists: [`${local}\\Programs\\Orca`],
        run: [
          ['curl', '-fsSL', '-o', exe, url],
          ['node', VERIFY, exe, sha],
          [exe, '/currentuser', '/S']
        ],
        always: [
          ps(`if (Test-Path "${exe}") { Remove-Item "${exe}" }`)
        ],
        // The NSIS uninstaller relaunches itself from %TEMP% and returns at once: wait until it has removed itself.
        undo: [ps(`$u = "$env:LOCALAPPDATA\\Programs\\Orca\\Uninstall Orca.exe"; if (-not (Test-Path $u)) { exit 0 }; Start-Process -FilePath $u -ArgumentList '/S' -Wait; for ($i = 0; $i -lt 60 -and (Test-Path $u); $i++) { Start-Sleep 2 }; if (Test-Path $u) { Write-Error 'Orca uninstaller did not finish in 120 s'; exit 1 }`)],
      });
    }
  }

  if (terminals.includes('warp') && agents.includes('claude')) {
    commands.push({
      tool: 'warp',
      desc: 'Warp plugin for Claude Code (needs jq)',
      run: [['claude', 'plugin', 'marketplace', 'add', 'warpdotdev/claude-code-warp'], ['claude', 'plugin', 'install', 'warp@claude-code-warp']],
      undo: [['claude', 'plugin', 'uninstall', 'warp@claude-code-warp']],
    });
  }
  if (terminals.includes('orca')) {
    const as = [...new Set(agents.map((a) => ORCA_SKILL_AGENT[a]).filter(Boolean))];
    if (as.length) {
      commands.push({
        tool: 'orca',
        desc: 'Orca skill orca-cli',
        run: [['npx', '-y', skillsCli(), 'add', skillSource('orca-cli'), '--skill', 'orca-cli', '-a', ...as, '-g', '-y']],
        undo: [['npx', '-y', skillsCli(), 'remove', 'orca-cli', '-g', '-y']],
      });
    }
    if (platform === 'win32' && system) commands.push(...orcaWindowsCommands({ network, env, readEnv }));
  }
  return commands;
}

// One Windows env value from the User or Machine scope (null when unset); plan time only, read-only.
function readWindowsEnv(scope, name) {
  const r = quiet(ps(`[Console]::Out.Write([Environment]::GetEnvironmentVariable('${name}','${scope}'))`));
  return r.ok && r.out.trim() ? r.out.trim() : null;
}

function orcaWindowsCommands({ network, env, readEnv }) {
  const commands = [];
  if (network.telemetry === 'off') {
    for (const name of ORCA_TELEMETRY_ENV) {
      commands.push({
        tool: 'orca',
        desc: `Orca telemetry off: ${name}=1 in your Windows user env (restart Orca)`,
        run: [ps(`[Environment]::SetEnvironmentVariable('${name}','1','User')`)],
        undo: [ps(`[Environment]::SetEnvironmentVariable('${name}',$null,'User')`)],
        // A value you already set is yours: never overwritten, never undone.
        skipIfOutput: { cmd: ps(`if (-not ([Environment]::GetEnvironmentVariable('${name}','User') -or [Environment]::GetEnvironmentVariable('${name}','Machine'))) { exit 1 }`) },
      });
    }
  }
  if (hasProxy(env)) {
    // Scopes decide, not this shell: a value set only in the current session is not persisted anywhere.
    const user = readEnv('User', 'NO_PROXY');
    const machine = readEnv('Machine', 'NO_PROXY');
    const have = (user ?? machine ?? '').split(',').map((x) => x.trim());
    const missing = LOOPBACK.filter((h) => !have.includes(h));
    if (missing.length) {
      const list = missing.map((h) => `'${h}'`).join(',');
      const get = (scope) => `[Environment]::GetEnvironmentVariable('NO_PROXY','${scope}')`;
      commands.push({
        tool: 'orca',
        desc: `NO_PROXY: add ${missing.join(', ')} to your Windows user env so Orca status hooks skip the proxy (restart Orca)`,
        // A user value shadows the machine one, so without a user value the machine value is the starting point.
        run: [ps(`$v=${get('User')}; if (-not $v) { $v=${get('Machine')} }; $l=@($v -split ',' | Where-Object { $_ }); foreach ($h in @(${list})) { if ($l -notcontains $h) { $l += $h } }; [Environment]::SetEnvironmentVariable('NO_PROXY', ($l -join ','), 'User')`)],
        // Drops only our entries. With no user value before, the var was ours: remove it once nothing but the machine value is left.
        undo: [ps(`$l=@(${get('User')} -split ',' | Where-Object { $_ -and @(${list}) -notcontains $_ }); ${user ? '' : `$l=@($l | Where-Object { @(${get('Machine')} -split ',') -notcontains $_ }); `}[Environment]::SetEnvironmentVariable('NO_PROXY', $(if ($l.Count) { $l -join ',' } else { $null }), 'User')`)],
      });
    }
  }
  return commands;
}

// Git Bash's bash.exe absolute path, found under the standard install folders; null off Windows or not found.
// MSYSTEM alone (a shell started from Git Bash) carries no path, so it is not a source here.
export function gitBashPath({ platform = process.platform, env = process.env } = {}) {
  if (platform !== 'win32') return null;
  const roots = [env.ProgramFiles, env['ProgramFiles(x86)'], env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'Programs')];
  for (const d of roots) {
    if (!d) continue;
    const p = path.join(d, 'Git', 'bin', 'bash.exe');
    if (fs.existsSync(p)) return p;
  }
  return null;
}

// Git Bash on Windows: a shell started from it, or the standard install folders.
function gitBashPresent({ platform, env }) {
  if (platform !== 'win32') return false;
  return Boolean(env.MSYSTEM) || Boolean(gitBashPath({ platform, env }));
}

// Which shell the agent will use on Windows, and what breaks without Git Bash. null off Windows.
export function shellNotice({ platform = process.platform, env = process.env } = {}) {
  if (platform !== 'win32') return null;
  if (gitBashPresent({ platform, env })) return { ok: true, text: 'Windows shell: Git Bash found. RTK and bash-style commands can run there.' };
  return { ok: false, text: 'Windows shell: Git Bash not found, so agents fall back to PowerShell or cmd.exe. RTK rewrites and bash-style commands then fail or are skipped, output is not compressed (more tokens) and the rules\' POSIX examples do not apply. Fix: install Git for Windows (winget install Git.Git), then run --doctor.' };
}

// Marked ~/.bashrc block for Git Bash. Entries are appended at run time, so the user's own NO_PROXY is kept.
export function gitBashActions({ home, terminals, agents, platform = process.platform, env = process.env }) {
  if (!gitBashPresent({ platform, env })) return [];
  const lines = [];
  if (agents.includes('cursor')) {
    lines.push(
      '# Cursor CLI hooks are denied under Git Bash unless MSYSTEM and SHELL are empty.',
      "alias agent='MSYSTEM= SHELL= agent.cmd'",
      "alias cursor-agent='MSYSTEM= SHELL= cursor-agent.cmd'",
    );
  }
  if (terminals.includes('orca') && hasProxy(env)) {
    lines.push(
      '# Orca status hooks call 127.0.0.1 with curl: keep loopback off the proxy.',
      `for h in ${LOOPBACK.join(' ')}; do`,
      '  case ",$NO_PROXY," in *",$h,"*) ;; *) NO_PROXY="${NO_PROXY:+$NO_PROXY,}$h" ;; esac',
      '  case ",$no_proxy," in *",$h,"*) ;; *) no_proxy="${no_proxy:+$no_proxy,}$h" ;; esac',
      'done',
      'export NO_PROXY no_proxy',
    );
  }
  return lines.length ? [{ kind: 'block', toml: true, path: path.join(home, '.bashrc'), body: lines.join('\n') }] : [];
}

// Manual steps lean-agents cannot script: printed after install and by --doctor.
// `check` (when present) says whether a step is already done.
export function stillNeeded({ home, terminals, agents, platform = process.platform, env = process.env, exec = false, readEnv = readWindowsEnv }) {
  const out = [];
  if (agents.includes('cursor')) {
    out.push({ text: 'Cursor: run `agent login` once (CLI) and sign in to the Cursor app; `agent mcp login <server>` for any MCP server that needs OAuth.' });
    out.push({ text: 'Cursor: paste your global rules into Cursor Settings > Rules > User Rules (there is no file for them); --project writes team rules instead.' });
    if (hasProxy(env)) out.push({ text: 'Cursor behind a proxy: export HTTP_PROXY, HTTPS_PROXY and NODE_USE_ENV_PROXY=1 in your shell profile (lean-agents never writes proxy values).' });
  }
  if (terminals.includes('orca')) {
    if (platform === 'win32') {
      out.push({ text: 'Orca: click "Install CLI & Skills" in Orca to put `orca` on PATH (%LOCALAPPDATA%\\Programs\\Orca\\resources\\bin).', check: exec ? () => Boolean(which('orca')) : undefined });
    }
    if (platform === 'win32' && hasProxy(env)) {
      // Orca hands its own env to every terminal and Bun (OpenCode) reads proxy vars once, so a NO_PROXY added later needs an Orca restart.
      out.push({
        text: 'Orca behind a proxy: the Windows user NO_PROXY must list localhost, 127.0.0.1 and ::1, and Orca must be restarted after you change it (an Orca started earlier keeps the old value: status posts go to the proxy and fail with 403).',
        check: exec ? () => LOOPBACK.every((h) => (readEnv('User', 'NO_PROXY') ?? readEnv('Machine', 'NO_PROXY') ?? '').split(',').map((x) => x.trim()).includes(h)) : undefined,
      });
    }
    // Mod+P is Ctrl+P on Windows; the rebind is the owner's report from the Windows work PC (#78).
    if (platform === 'win32') out.push({ text: 'Orca: Ctrl+P opens Orca\'s worktree quick-open, so OpenCode never sees it. To keep Ctrl+P for OpenCode, put {"platforms":{"win32":{"worktree.quickOpen":["Ctrl+Shift+P"]}}} in ~/.orca/keybindings.json (lean-agents never edits that file).' });
    out.push(
      { text: 'Orca: the first launch turns on agent status hooks, which write into ~/.claude/settings.json and ~/.cursor/hooks.json (Settings > Agents > Agent status hooks). --uninstall leaves them alone.', check: () => orcaHooksFound(home).length > 0 },
      { text: 'Orca: Settings > Agents > Agent permissions may start agents in Yolo mode; pick Manual if you expect approval prompts.' },
      { text: 'Orca: Settings > Session History > "Search inside sessions" indexes the full text of every agent chat on this machine; it is on by default.' },
      { text: 'Orca: restart Orca after env changes, then start a fresh agent tab (restored tabs keep the old env).' },
    );
  }
  return out;
}

// Orca hook entries found in other agents' configs, for --doctor.
const ORCA_HOOK = /[\\/]\.orca[\\/]agent-hooks|orca-agent-hook|ORCA_AGENT_HOOK/i;
export function orcaHooksFound(home) {
  return [path.join(home, '.claude', 'settings.json'), path.join(home, '.cursor', 'hooks.json')].filter((f) => {
    if (!fs.existsSync(f)) return false;
    let text;
    try { text = fs.readFileSync(f, 'utf8'); } catch { return false; }
    // On Windows Orca writes the Cursor hook as a PowerShell -EncodedCommand (UTF-16LE base64).
    const decoded = [...text.matchAll(/-EncodedCommand\s+([A-Za-z0-9+/=]+)/gi)].map((m) => Buffer.from(m[1], 'base64').toString('utf16le'));
    return [text, ...decoded].some((t) => ORCA_HOOK.test(t));
  });
}

// True when an Orca opt-out is already set (Windows real home only). Reads process.env only: on Windows
// it carries the User and Machine vars from login, and spawning PowerShell here would touch USERPROFILE on a dry run.
export function orcaEnvSet({ platform = process.platform, system = true, env = process.env } = {}) {
  if (platform !== 'win32' || !system) return false;
  return ORCA_TELEMETRY_ENV.some((name) => Boolean(env[name]));
}

// Printed with the all-off network preset; app settings stay the user's.
export function terminalPrivacyNotes(terminals, { orcaEnvSet = false } = {}) {
  const notes = [];
  if (terminals.includes('warp')) notes.push('Warp telemetry: set `[privacy] telemetry_enabled = false` in its settings.toml (the free plan may need it on for AI)');
  if (terminals.includes('orca') && !orcaEnvSet) notes.push('Orca telemetry: set DO_NOT_TRACK=1 where Orca starts, or turn off Settings > Privacy > Share anonymous usage data');
  return notes;
}
