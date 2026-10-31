# Compatibility

What lean-agents configures per agent, how, and when each command or key was last checked against upstream.

| Feature | Claude Code | OpenCode 2.x | OpenCode 1.x | Copilot CLI | Antigravity CLI |
| --- | --- | --- | --- | --- | --- |
| Global rules | `@` import in `~/.claude/CLAUDE.md` | `instructions` entry | planned (v0.3) | planned | planned |
| Subagents by tier | `~/.claude/agents/*.md` | `~/.config/opencode/agents/*.md` | planned | planned | planned |
| Primary agent models | `model` in settings (only if unset) | `agent.plan` / `agent.build` from profile | planned | planned | planned |
| RTK | `rtk init -g` (hook) | `rtk init -g --opencode` (plugin) | planned | `rtk init -g --copilot` | `rtk init -g --agent antigravity` |
| Context Mode | plugin `context-mode@context-mode` | MCP (`mcp.servers`) | plugin | planned | planned |
| Serena, Playwright | `claude mcp add --scope user` | `mcp.servers` | planned | planned | planned |
| Ponytail | plugin `ponytail@ponytail` | `plugins` entry | planned | ➖ | ➖ |
| i-have-adhd | plugin `i-have-adhd@i-have-adhd` + flag | vendor checkout + loader + flag | planned | ➖ | ➖ |
| Caveman | `npx skills add … -a claude-code -g` | `npx skills add … -a opencode -g` | planned | planned | planned |
| Compaction | `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE=80` | `compaction.auto` + `compaction.buffer` | DCP (planned) | planned | planned |
| Strict privacy | env flags (below) | `share`, `update`, `experimental.policies` | planned | planned | planned |

## Verification log

| Item | Source | Checked |
| --- | --- | --- |
| Context Mode Claude plugin `mksglu/context-mode`, `context-mode@context-mode`; license ELv2 | [README](https://github.com/mksglu/context-mode) | 2026-10-31 |
| Context Mode: plugin and MCP together break OpenCode tool registration | same | 2026-10-31 |
| Ponytail Claude plugin `DietrichGebert/ponytail`, `ponytail@ponytail`; OpenCode 2 uses `plugins`, 1.x uses `plugin` | [INSTALL.md](https://github.com/DietrichGebert/ponytail/blob/main/INSTALL.md) | 2026-10-31 |
| i-have-adhd Claude plugin `ayghri/i-have-adhd`, `i-have-adhd@i-have-adhd` | [README](https://github.com/ayghri/i-have-adhd) | 2026-10-31 |
| RTK install (`brew install rtk`, `winget install rtk-ai.rtk`), `rtk init -g`, `--opencode` (OpenCode 1.18.29+), `--copilot`, `--agent antigravity`, `--uninstall` | [README](https://github.com/rtk-ai/rtk), [installation guide](https://github.com/rtk-ai/rtk/blob/master/docs/guide/getting-started/installation.md) | 2026-10-31 |
| Caveman `npx skills add JuliusBrussee/caveman -g` and `skills remove` | [README](https://github.com/juliusbrussee/caveman) | 2026-10-31 |
| OpenCode config: `instructions`, `default_agent`, `agent.<name>.model`, markdown agents in `~/.config/opencode/agents/`, `permission`, `experimental.policies` (OpenCode 2 only) | [config docs](https://github.com/anomalyco/opencode/blob/dev/packages/web/src/content/docs/config.mdx), [agents docs](https://github.com/anomalyco/opencode/blob/dev/packages/web/src/content/docs/agents.mdx) | 2026-10-31 |
| OpenCode 2 renames: `plugins`, `update: "disable"`, `mcp.servers`, `compaction.buffer` | Working OpenCode 2.1 setup on macOS | 2026-10-26 |

## Not yet verified

- OpenCode 2 `compaction.buffer` versus the documented `compaction.reserved`, and `mcp.servers` versus flat `mcp`. The doctor reads `opencode debug config` and reports any server or rule that did not load, so a wrong key shows up right away.
- `reasoningEffort` as the pass-through option for Gemini on Vertex.
- Claude Code privacy env names (`DISABLE_TELEMETRY`, `DISABLE_ERROR_REPORTING`, `DISABLE_BUG_COMMAND`, `DISABLE_AUTOUPDATER`, `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`).
