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
| Context Mode | `npm install -g context-mode` | `claude plugin marketplace add mksglu/context-mode` then `claude plugin install context-mode@context-mode` | MCP: `"mcp": { "servers": { "context-mode": { "type": "local", "command": ["npx", "-y", "context-mode"] } } }` |
| Serena | `brew install uv` / `winget install astral-sh.uv` | `claude mcp add --scope user serena -- uvx -p 3.13 --from git+https://github.com/oraios/serena serena start-mcp-server --context claude-code --project-from-cwd` | same command with `--context ide` under `mcp.servers.serena` |
| Playwright | Node.js | `claude mcp add --scope user playwright -- npx -y @playwright/mcp@latest` | `mcp.servers.playwright` |
| Ponytail | — | `claude plugin marketplace add DietrichGebert/ponytail` then `claude plugin install ponytail@ponytail` | `"plugins": ["@dietrichgebert/ponytail"]` |
| i-have-adhd | — | `claude plugin marketplace add ayghri/i-have-adhd` then `claude plugin install i-have-adhd@i-have-adhd`; `touch ~/.claude/.i-have-adhd-always` | `git clone https://github.com/ayghri/i-have-adhd ~/.config/opencode/vendor/i-have-adhd`, loader `~/.config/opencode/plugins/i-have-adhd.ts`, `touch ~/.config/opencode/.i-have-adhd-always` |
| Caveman | Node.js | `npx skills add JuliusBrussee/caveman --skill caveman caveman-compress caveman-stats -a claude-code -g -y` | `npx skills add JuliusBrussee/caveman --skill caveman caveman-compress caveman-stats -a opencode -g -y` |

OpenCode 1 uses the same commands and files, with these config differences:

- `plugin` instead of `plugins`, and `mcp.<name>` instead of `mcp.servers.<name>`.
- Context Mode is a plugin, never MCP: `"plugin": ["context-mode"]` plus `npm install -g context-mode`.
- DCP (optional): `"plugin": ["@tarquinen/opencode-dcp@latest"]` and `~/.config/opencode/dcp.jsonc` with `compress.minContextLimit` at 50% and `compress.maxContextLimit` at 80% of your context window.

Windows without winget: download `rtk-x86_64-pc-windows-msvc.zip` from the [RTK releases](https://github.com/rtk-ai/rtk/releases) and extract it into `%USERPROFILE%\tools\rtk`. `install.ps1` adds that folder to your user PATH; open a new terminal afterwards.

Copilot CLI and Antigravity CLI:

| Tool | Copilot CLI | Antigravity CLI |
| --- | --- | --- |
| Rules | Paste `core/AGENTS.md` into `~/.copilot/copilot-instructions.md` | Copy to `~/.gemini/config/rules/` |
| Subagents | `~/.copilot/agents/<name>.agent.md` | `~/.gemini/config/agents/<name>.md` with `subagent: true` |
| RTK | `rtk init -g --copilot` | `rtk init -g --agent antigravity` |
| Context Mode | `copilot plugin install mksglu/context-mode:configs/copilot-cli` | `agy plugin install https://github.com/mksglu/context-mode/tree/main/configs/antigravity-cli` |
| Serena, Playwright | `mcpServers` in `~/.copilot/mcp-config.json`, with `"type": "local"` and `"tools": ["*"]` | `mcpServers` in `~/.gemini/config/mcp_config.json` |
| Caveman | `npx skills add JuliusBrussee/caveman --skill caveman caveman-compress caveman-stats -a github-copilot -g -y` | Same with `-a antigravity-cli` |

Opt-in tools: `npx -y @opengsd/gsd-core@latest --copilot --global` (also `--claude`, `--opencode`, `--antigravity`), and `npx autoskills` inside a project.

Add `.serena/` to your global git ignore (`~/.config/git/ignore`).

## 5. Strict privacy

See [privacy.md](privacy.md).
