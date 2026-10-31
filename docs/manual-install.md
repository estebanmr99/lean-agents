# Manual install

Everything the installer does, by hand. Use this if you only want one piece, or to review what the installer will do. Paths use `~` (Windows: `%USERPROFILE%`).

## 1. Rules

Copy `core/AGENTS.md` to `~/.config/lean-agents/AGENTS.md`, replacing `{{LANG_RULE}}` with "Always reply in English." and removing the other placeholders.

- **Claude Code:** add `@~/.config/lean-agents/AGENTS.md` to `~/.claude/CLAUDE.md`.
- **OpenCode 2:** add the absolute path of that file to `instructions` in `~/.config/opencode/opencode.jsonc`.

## 2. Subagents

Copy each file in `core/agents/` and set the model for its tier.

- **Claude Code:** `~/.claude/agents/<name>.md` with `name`, `description`, `model: haiku|sonnet|opus` and, for read-only agents, `tools: Read, Grep, Glob`.
- **OpenCode 2:** `~/.config/opencode/agents/<name>.md` with `description`, `mode: subagent`, `model: provider/model-id` and `permission` (`edit: deny` for read-only agents).

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

## 4. Tools

| Tool | Install | Claude Code | OpenCode 2 |
| --- | --- | --- | --- |
| RTK | `brew install rtk` / `winget install rtk-ai.rtk` | `rtk init -g` | `rtk init -g --opencode` |
| Context Mode | `npm install -g context-mode` | `claude plugin marketplace add mksglu/context-mode` then `claude plugin install context-mode@context-mode` | MCP: `"mcp": { "servers": { "context-mode": { "type": "local", "command": ["npx", "-y", "context-mode"] } } }` |
| Serena | `brew install uv` / `winget install astral-sh.uv` | `claude mcp add --scope user serena -- uvx -p 3.13 --from git+https://github.com/oraios/serena serena start-mcp-server --context claude-code --project-from-cwd` | same command with `--context ide` under `mcp.servers.serena` |
| Playwright | Node.js | `claude mcp add --scope user playwright -- npx -y @playwright/mcp@latest` | `mcp.servers.playwright` |
| Ponytail | — | `claude plugin marketplace add DietrichGebert/ponytail` then `claude plugin install ponytail@ponytail` | `"plugins": ["@dietrichgebert/ponytail"]` |
| i-have-adhd | — | `claude plugin marketplace add ayghri/i-have-adhd` then `claude plugin install i-have-adhd@i-have-adhd`; `touch ~/.claude/.i-have-adhd-always` | `git clone https://github.com/ayghri/i-have-adhd ~/.config/opencode/vendor/i-have-adhd`, loader `~/.config/opencode/plugins/i-have-adhd.ts`, `touch ~/.config/opencode/.i-have-adhd-always` |
| Caveman | Node.js | `npx skills add JuliusBrussee/caveman -a claude-code -g` | `npx skills add JuliusBrussee/caveman -a opencode -g` |

Add `.serena/` to your global git ignore (`~/.config/git/ignore`).

## 5. Strict privacy

See [privacy.md](privacy.md).
