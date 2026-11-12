# Manual install

Everything the installer does, by hand. Use this if you only want one piece, or to review what the installer will do. Paths use `~` (Windows: `%USERPROFILE%`).

## 1. Rules

Copy `core/AGENTS.md` to `~/.config/lean-agents/AGENTS.md`, replacing `{{LANG_RULE}}` with "Always reply in English." and removing the other placeholders.

- **Claude Code:** add `@~/.config/lean-agents/AGENTS.md` to `~/.claude/CLAUDE.md`.
- **OpenCode 1 and 2:** add the absolute path of that file to `instructions` in `~/.config/opencode/opencode.jsonc`.

## 2. Subagents

Copy each file in `core/agents/` and set the model for its tier.

- **Claude Code:** `~/.claude/agents/<name>.md` with `name`, `description`, `model: haiku|sonnet|opus` and, for read-only agents, `tools: Read, Grep, Glob`.
- **OpenCode 1 and 2:** `~/.config/opencode/agents/<name>.md` with `description`, `mode: subagent`, `model: provider/model-id` and `permission` (`edit: deny` for read-only agents).

## 3. Settings

Claude Code `~/.claude/settings.json`:

```json
{ "env": { "BASH_MAX_OUTPUT_LENGTH": "15000", "CLAUDE_AUTOCOMPACT_PCT_OVERRIDE": "80" } }
```

OpenCode 2 `~/.config/opencode/opencode.jsonc`:

```jsonc
{
  "default_agent": "plan",
  "compaction": { "auto": true, "buffer": 40000 }
}
```

OpenCode 1 uses `"compaction": { "auto": true, "reserved": 40000 }`.

## 4. Tools

| Tool | Install | Claude Code | OpenCode 2 |
| --- | --- | --- | --- |
| RTK | `brew install rtk` / `winget install rtk-ai.rtk` | `rtk init -g` | `rtk init -g --opencode` |
| Context Mode | `npm install -g context-mode@2.1.4` | `claude plugin marketplace add mksglu/context-mode` then `claude plugin install context-mode@context-mode` | MCP: `"mcp": { "servers": { "context-mode": { "type": "local", "command": ["npx", "-y", "context-mode"] } } }` |
| Serena | `brew install uv` / `winget install astral-sh.uv` | `claude mcp add --scope user serena -- uvx -p 3.13 --from git+https://github.com/oraios/serena serena start-mcp-server --context claude-code --project-from-cwd` | same command with `--context ide` under `mcp.servers.serena` |
| Playwright | Node.js | `claude mcp add --scope user playwright -- npx -y @playwright/mcp@0.0.83` | `mcp.servers.playwright` |
| Ponytail | — | `claude plugin marketplace add DietrichGebert/ponytail` then `claude plugin install ponytail@ponytail` | `"plugins": ["@dietrichgebert/ponytail"]` |
| i-have-adhd | — | `claude plugin marketplace add ayghri/i-have-adhd` then `claude plugin install i-have-adhd@i-have-adhd`; `touch ~/.claude/.i-have-adhd-always` | `git clone https://github.com/ayghri/i-have-adhd ~/.config/opencode/vendor/i-have-adhd`, loader `~/.config/opencode/plugins/i-have-adhd.ts`, `touch ~/.config/opencode/.i-have-adhd-always` |
| Caveman | Node.js | `npx skills@1.7.4 add JuliusBrussee/caveman#v4.0.1 --skill caveman caveman-compress caveman-stats -a claude-code -g -y` | `npx skills@1.7.4 add JuliusBrussee/caveman#v4.0.1 --skill caveman caveman-compress caveman-stats -a opencode -g -y` |

OpenCode 1 uses the same commands and files, with these config differences:

- `plugin` instead of `plugins`, and `mcp.<name>` instead of `mcp.servers.<name>`.
- Context Mode is a plugin, never MCP: `"plugin": ["context-mode"]` plus `npm install -g context-mode@2.1.4`.
- DCP (optional): `"plugin": ["@tarquinen/opencode-dcp@3.2.0"]` and `~/.config/opencode/dcp.jsonc` with `compress.minContextLimit` at 50% and `compress.maxContextLimit` at 80% of your context window.

Windows without winget: download `rtk-x86_64-pc-windows-msvc.zip` from the [RTK releases](https://github.com/rtk-ai/rtk/releases) and extract it into `%USERPROFILE%\tools\rtk`. `install.ps1` adds that folder to your user PATH; open a new terminal afterwards.

Copilot CLI and Antigravity CLI:

| Tool | Copilot CLI | Antigravity CLI |
| --- | --- | --- |
| Rules | Paste `core/AGENTS.md` into `~/.copilot/copilot-instructions.md` | Copy to `~/.gemini/config/rules/` |
| Subagents | `~/.copilot/agents/<name>.agent.md` | `~/.gemini/config/agents/<name>.md` with `subagent: true` |
| RTK | `rtk init -g --copilot` | `rtk init -g --agent antigravity` |
| Context Mode | `npm install -g context-mode@2.1.4`, then the `copilot mcp add` step from `context-mode setup --print copilot-cli` | not supported by Context Mode 2 |
| Serena, Playwright | `mcpServers` in `~/.copilot/mcp-config.json`, with `"type": "local"` and `"tools": ["*"]` | `mcpServers` in `~/.gemini/config/mcp_config.json` |
| Caveman | `npx skills@1.7.4 add JuliusBrussee/caveman#v4.0.1 --skill caveman caveman-compress caveman-stats -a github-copilot -g -y` | Same with `-a antigravity-cli` |

Opt-in tools: `npx -y @opengsd/gsd-core@1.18.0 --copilot --global` (also `--claude`, `--opencode`, `--antigravity`), and `npx autoskills` inside a project.

Add `.serena/` to your global git ignore (`~/.config/git/ignore`).

## 5. Strict privacy

See [privacy.md](privacy.md).

## 6. Detect what is installed (read-only)

Works with or without `state.json`; the `lean-update` skill runs exactly these commands. None of them writes a file. A non-zero exit, or a missing file, means the tool is not installed.

| Tool | Command | Read |
| --- | --- | --- |
| Claude Code | `claude --version` | first number |
| Claude plugins (Context Mode, Ponytail, i-have-adhd) | `claude plugin list` | `Version:` under each name |
| OpenCode | `opencode --version` | first number |
| OpenCode plugins, MCP servers, rules | `opencode debug config` | `plugin`/`plugins` entries (with `@version`), `mcp` keys |
| RTK | `rtk --version` | second word |
| Context Mode (npm) | `npm ls -g context-mode --depth=0 --json` | `dependencies.context-mode.version` |
| Serena (Claude Code) | `node -e "const j=JSON.parse(require('fs').readFileSync(require('os').homedir()+'/.claude.json','utf8'));console.log(j.mcpServers?.serena?.args?.join(' '))"` | the `--from` ref; Serena is not pinned, so it follows the git ref |
| Serena runner | `uvx --version` | second word |
| Playwright MCP (Claude Code) | `node -e "const j=JSON.parse(require('fs').readFileSync(require('os').homedir()+'/.claude.json','utf8'));console.log(j.mcpServers?.playwright?.args?.join(' '))"` | the `@playwright/mcp@x.y.z` argument |
| Skills (Caveman, i-have-adhd, lean-update, ...) | `node -e "const l=JSON.parse(require('fs').readFileSync(require('os').homedir()+'/.agents/.skill-lock.json','utf8'));for(const [n,s] of Object.entries(l.skills)) console.log(n,s.source,s.ref)"` | `ref` is the installed tag (verified with skills 1.7.4, 2026-11-06) |
| Skills CLI | `npm ls -g skills --depth=0 --json` | `dependencies.skills.version`; `npx` runs use the pinned version, so this may be absent |

### One Node per tool, one folder per skill

- **Tool Node policy (with nvm).** Run every tool whose pin needs a newer Node than the one on your PATH (`engines.node` in `core/pins.json`: Context Mode and GSD need 24) on one Node that meets it, and register it by absolute path: `<nvm dir>/versions/node/v24.x.y/bin/node <that Node's lib/node_modules>/context-mode/cli.mjs server` (Windows: `%NVM_HOME%\v24.x.y\node.exe`). Install the package into that Node (`npm i -g --prefix <that Node's folder> context-mode@<pin>`). Do not register a link that follows `nvm use` (`$NVM_DIR/current`, `C:\nodejs`), a bare `node` or `npx` (first `node` on PATH; npm starts package bins with it), or an absolute `npx` (its script also runs the first `node` on PATH): any of them quietly runs the wrong Node after the next `nvm use`.
- **Check it.** `lean-agents --doctor` lists `node for <client> mcp <name>` per entry and marks `error` when the Node is below the tool's range; `--doctor --json` adds `nodes`.
- **A skill lives in one folder.** Keep each skill in one of the folders an agent reads (`~/.agents/skills` for OpenCode, Cursor and Copilot; `~/.claude/skills` for Claude Code), not in two: OpenCode reads both and its load order is not documented. `--doctor` lists a skill found in two folders of one agent as `duplicate skill <name>` (`--json`: `skills`), says whether the copies differ, and names no winner. It deletes nothing. Orca installs its own skills in both folders on purpose.

Compare each result with `core/pins.json` at the latest release: `https://raw.githubusercontent.com/estebanmr99/lean-agents/<tag>/core/pins.json`. With the engine, `lean-agents --doctor --json` does the same and lists `behind`.

## 7. Back up before changing, delete after

One folder, only the files that will change, under the OS temp dir. Remove it once `--doctor` passes (keep it, and say where, when it does not).

```sh
B="${TMPDIR:-/tmp}/lean-agents-backup-$(date +%Y%m%d-%H%M%S)"; mkdir -p "$B"
# for each file P (absolute path) you are about to change:
mkdir -p "$B$(dirname "$P")" && cp -p "$P" "$B$P"
# after the update and a passing --doctor:
rm -rf "$B"
```
