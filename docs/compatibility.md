# Compatibility

What lean-agents configures per agent, how, and when each command or key was last checked against upstream.

| Feature | Claude Code | OpenCode 2.x | OpenCode 1.x | Copilot CLI | Antigravity CLI |
| --- | --- | --- | --- | --- | --- |
| Global rules | `@` import in `~/.claude/CLAUDE.md` | `instructions` entry | `instructions` entry | planned | planned |
| Subagents by tier | `~/.claude/agents/*.md` | `~/.config/opencode/agents/*.md` | `~/.config/opencode/agents/*.md` | planned | planned |
| Primary agent models | `model` in settings (only if unset) | `agents.plan` / `agents.build` from profile | `agent.plan` / `agent.build` from profile | planned | planned |
| RTK | `rtk init -g` (hook) | `rtk init -g --opencode` (plugin) | `rtk init -g --opencode` (plugin) | `rtk init -g --copilot` | `rtk init -g --agent antigravity` |
| Context Mode | plugin `context-mode@context-mode` | MCP (`mcp.servers`) | `plugin` entry, needs Node.js 22.5+ | planned | planned |
| Serena, Playwright | `claude mcp add --scope user` | `mcp.servers` | flat `mcp.<name>` | planned | planned |
| Ponytail | plugin `ponytail@ponytail` | `plugins` entry | `plugin` entry | ➖ | ➖ |
| i-have-adhd | plugin `i-have-adhd@i-have-adhd` + flag | vendor checkout + loader + flag | vendor checkout + loader + flag | ➖ | ➖ |
| Caveman | `npx skills add … -a claude-code -g` | `npx skills add … -a opencode -g` | `npx skills add … -a opencode -g` | planned | planned |
| Compaction | `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE=80` | `compaction.auto` + `compaction.buffer` | `compaction.auto` + `compaction.reserved`, optional DCP | planned | planned |
| Strict privacy | env flags (below) | `share`, `update`, `policies` | `share`, `autoupdate`, `experimental.openTelemetry`, `disabled_providers` | planned | planned |

## Windows

- `install.ps1` runs on PowerShell 5.1 and 7 and needs no admin rights.
- Tools come from winget (`rtk-ai.rtk`, `astral-sh.uv`). The winget RTK build lags upstream: 0.50.0 against 1.1.0 on 2026-10-30.
- Without winget, extract `rtk-x86_64-pc-windows-msvc.zip` into `%USERPROFILE%\tools\rtk`; `install.ps1` adds it to the user PATH.
- No directory junctions are needed: the Skills CLI installs into `~/.claude/skills` and `~/.agents/skills`, and OpenCode reads `~/.agents/skills`.
- `rtk init` writes to the OS profile folder, not `USERPROFILE`. It only matters when testing with a temp `USERPROFILE`.
- **VERIFY:** winget routes are not exercised in CI because the runner image does not list winget.

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
| OpenCode 2 native keys accepted and loaded: `instructions`, `default_agent`, `agents`, `plugins`, `update`, `share`, `policies`, `mcp.servers`, `compaction.buffer`, markdown subagents | `opencode debug config` / `debug agents` on OpenCode 2.2.5 in CI (`tests/real-opencode.sh`) | 2026-10-31 |
| OpenCode 1.x keys: `instructions`, `default_agent`, `agent`, `plugin`, flat `mcp`, `share`, `autoupdate`, `disabled_providers`, `compaction.auto`, `compaction.reserved`, `experimental.openTelemetry` | [1.19.0 schema](https://github.com/anomalyco/opencode/blob/v1.19.0/packages/core/src/v1/config/config.ts), `opencode debug config` on 1.19.0 in CI (`tests/real-opencode-v1.sh`) | 2026-10-30 |
| `opencode.ai/install` installs 1.x only and takes `--version`; `opencode debug config` prints one object; subagents are listed by `opencode agent list` (no `debug agents`) | [install script](https://opencode.ai/install), [1.19.0 source](https://github.com/anomalyco/opencode/tree/v1.19.0/packages/opencode/src/cli/cmd) | 2026-10-30 |
| DCP `@tarquinen/opencode-dcp` 3.2.0, peer `@opencode-ai/plugin >=1.18.29`, `~/.config/opencode/dcp.jsonc`, `compress.minContextLimit` / `maxContextLimit`; AGPL-3.0; also installs on OpenCode 2 now; upstream recommends Sleev for new users | [README](https://github.com/Opencode-DCP/opencode-dynamic-context-pruning) | 2026-10-30 |
| Context Mode OpenCode route: `"plugin": ["context-mode"]`, Node.js >=22.5 | [README](https://github.com/mksglu/context-mode), npm | 2026-10-30 |
| Ponytail one package serves V1 and V2 plugin APIs; config at `$XDG_CONFIG_HOME/ponytail`, `~/.config/ponytail`, Windows `%APPDATA%\ponytail` | [plugin source](https://github.com/DietrichGebert/ponytail/blob/main/.opencode/plugins/ponytail.mjs), [config source](https://github.com/DietrichGebert/ponytail/blob/main/hooks/ponytail-config.js) | 2026-10-30 |
| i-have-adhd supports OpenCode V1 1.18.29+ and V2 with the same loader | [README](https://github.com/ayghri/i-have-adhd) | 2026-10-30 |
| RTK: core formula `rtk`, winget `rtk-ai.rtk`, zip `rtk-x86_64-pc-windows-msvc.zip` | [installation guide](https://github.com/rtk-ai/rtk/blob/master/docs/guide/getting-started/installation.md), [Homebrew](https://formulae.brew.sh/formula/rtk), [winget-pkgs](https://github.com/microsoft/winget-pkgs/tree/master/manifests/r/rtk-ai/rtk) | 2026-10-30 |
| Skills CLI: `--skill <names>` and `-y` are needed without a TTY; `skills remove` takes skill names; `-a opencode -g` writes `~/.agents/skills`, `-a claude-code -g` writes `~/.claude/skills` | `npx skills --help` and a real run in a throwaway HOME; `real-tools`, `real-windows` in CI | 2026-10-30 |
| OpenCode 1.x and 2.x read global skills from `~/.agents/skills` | [1.x docs](https://opencode.ai/docs/skills), [2.x docs](https://opencode.ai/v2/docs/skills) | 2026-10-30 |
| Claude Code native installer `claude.ai/install.sh`; privacy env names `DISABLE_TELEMETRY`, `DISABLE_ERROR_REPORTING`, `DISABLE_BUG_COMMAND`, `DISABLE_AUTOUPDATER`, `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` | [setup docs](https://code.claude.com/docs/en/setup), [env vars](https://code.claude.com/docs/en/env-vars) | 2026-10-30 |
| `claude mcp add`, `claude mcp list`, `claude plugin marketplace add`, `claude plugin install` and `claude plugin uninstall` work without login | `real-claude` in CI | 2026-10-30 |
| `opencode-ai` on npm provides the 1.19.0 binary | npm, `tests/real-windows.ps1` in CI | 2026-10-30 |

## Not yet verified

- `reasoningEffort` as the pass-through option for Gemini on Vertex.
