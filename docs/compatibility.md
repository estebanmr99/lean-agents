# Compatibility

What lean-agents configures per agent, how, and when each command or key was last checked against upstream.

| Feature | Claude Code | OpenCode 2.x | OpenCode 1.x | Copilot CLI | Antigravity CLI |
| --- | --- | --- | --- | --- | --- |
| Global rules | `@` import in `~/.claude/CLAUDE.md` | `instructions` entry | `instructions` entry | marked block in `~/.copilot/copilot-instructions.md` | `~/.gemini/config/rules/lean-agents.md` |
| Subagents by tier | `~/.claude/agents/*.md` | `~/.config/opencode/agents/*.md` | `~/.config/opencode/agents/*.md` | `~/.copilot/agents/*.agent.md` | `~/.gemini/config/agents/*.md` (`subagent: true`) |
| Primary agent models | `model` in settings (only if unset) | `agents.plan` / `agents.build` from profile | `agent.plan` / `agent.build` from profile | planned | planned |
| RTK | `rtk init -g --auto-patch` (hook) | `rtk init -g --opencode` (plugin) | `rtk init -g --opencode` (plugin) | `rtk init -g --copilot` | `rtk init -g --agent antigravity` |
| Context Mode | plugin `context-mode@context-mode` | MCP (`mcp.servers`) | `plugin` entry, needs Node.js 22.5+ | `copilot plugin install mksglu/context-mode:configs/copilot-cli` | `agy plugin install` from `configs/antigravity-cli` |
| Serena, Playwright | `claude mcp add --scope user` | `mcp.servers` | flat `mcp.<name>` | `~/.copilot/mcp-config.json` | `~/.gemini/config/mcp_config.json` |
| Ponytail | plugin `ponytail@ponytail` | `plugins` entry | `plugin` entry | ➖ | ➖ |
| i-have-adhd | plugin `i-have-adhd@i-have-adhd` + flag | vendor checkout + loader + flag | vendor checkout + loader + flag | `npx skills add … -a github-copilot -g` | `npx skills add … -a antigravity-cli -g` (partial) |
| Caveman | `npx skills add … -a claude-code -g` | `npx skills add … -a opencode -g` | `npx skills add … -a opencode -g` | `npx skills add … -a github-copilot -g` | `npx skills add … -a antigravity-cli -g` (partial) |
| Compaction | `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE=80` | `compaction.auto` + `compaction.buffer` | `compaction.auto` + `compaction.reserved`, optional DCP | planned | planned |
| Strict privacy | env flags (below) | `share`, `update`, `policies` | `share`, `autoupdate`, `experimental.openTelemetry`, `disabled_providers` | `autoUpdate: false`; telemetry only through the `--disable-client-telemetry` flag | account setting only, printed as a reminder |

### VS Code Copilot and Cursor

| Feature | VS Code Copilot | Cursor (IDE and `agent` CLI) | `--project <dir>` (in the repo) |
| --- | --- | --- | --- |
| Rules | marked block in `~/.copilot/copilot-instructions.md` | ➖ user rules live in the settings UI | marked block in `AGENTS.md`; `.github/copilot-instructions.md` and `.cursor/rules/lean-agents.mdc` point to it |
| Subagents | `~/.copilot/agents/*.agent.md` | `~/.cursor/agents/*.md` (`model: inherit`, `readonly`) | `.github/agents/*.agent.md`, `.cursor/agents/*.md` |
| MCP | user `mcp.json` (`servers`, `type: stdio`) next to `settings.json` | `~/.cursor/mcp.json` (`mcpServers`) | `.vscode/mcp.json`, `.cursor/mcp.json` |
| Context Mode | MCP | MCP | MCP |
| RTK | shares the Copilot CLI hook (`rtk init -g --copilot`) only when copilot-cli is installed | `rtk init -g --agent cursor` | ➖ per user |
| Skills | `npx skills add … -a github-copilot -g` | `npx skills add … -a cursor -g` | ➖ per user |
| Strict privacy | `telemetry.telemetryLevel: off`, `update.mode: none` | Privacy Mode is an account setting, printed as a reminder | ➖ |

With both `copilot-cli` and `vscode-copilot`, the shared `~/.copilot` files and skills are written once. Proxies: Cursor CLI has `network.useHttp1ForAgent` in `~/.cursor/cli-config.json`; lean-agents does not set it yet.

## Windows

- `install.ps1` runs on PowerShell 5.1 and 7 and needs no admin rights.
- Tools come from winget (`rtk-ai.rtk`, `astral-sh.uv`). `real-winget` installs both without a TTY: rtk 1.1.0 and uv 0.13.6 on 2026-10-31.
- Without winget, extract `rtk-x86_64-pc-windows-msvc.zip` into `%USERPROFILE%\tools\rtk`; `install.ps1` adds it to the user PATH.
- No directory junctions are needed: the Skills CLI installs into `~/.claude/skills` and `~/.agents/skills`, and OpenCode reads `~/.agents/skills`.
- `rtk init` writes to the OS profile folder, not `USERPROFILE`. It only matters when testing with a temp `USERPROFILE`.
- The runner image has no winget; `real-winget` adds it with `Repair-WinGetPackageManager`.

## Terminals

Research only (session 8). lean-agents installs neither app yet. Checked 2026-11-03: Warp docs, Orca `v1.4.247` (released 2026-11-03).

### Warp

| Item | Value |
| --- | --- |
| Install | macOS `brew install --cask warp`; Windows `winget install Warp.Warp --scope user` (Inno installer, user and machine scopes); Linux `.deb`, `.rpm`, AppImage or the `releases.warp.dev` repo (needs `sudo`) |
| Name clash | Cloudflare WARP is the `cloudflare-warp` cask, not Warp |
| Settings | `settings.toml`: macOS `~/.warp/` (current docs; older docs say `~/.config/warp-terminal`, **VERIFY**), Linux `~/.config/warp-terminal/`, Windows `%LOCALAPPDATA%\warp\Warp\config\` |
| Outbound | `[privacy] telemetry_enabled` (default `true`; the free plan needs it on for AI, **VERIFY**), `crash_reporting_enabled`; `[general] login_item` (starts at login, default `true`) |
| Agent features | Reads `AGENTS.md` and `WARP.md` (`WARP.md` wins in the same folder); user MCP in `~/.warp/.mcp.json`, file-based MCP off by default (`file_based_mcp_enabled`) |
| Hooks into other agents | None by itself. The optional Claude Code plugin `warp@claude-code-warp` adds SessionStart, Stop, Notification, PermissionRequest, UserPromptSubmit and PostToolUse hooks; `warpdotdev/opencode-warp` is the OpenCode plugin. Both are rejected (FAQ only) |
| Remove | `brew uninstall --cask warp` (**VERIFY**) or delete the app; leftovers `~/.warp`, `~/.config/warp-terminal`, the `dev.warp.Warp-Stable` defaults domain and its Group Containers folder, `~/Library/Logs/warp.log*` |

### Orca

| Item | Value |
| --- | --- |
| Project | [`stablyai/orca`](https://github.com/stablyai/orca), MIT, desktop app that runs several agents in git worktrees |
| Install | macOS `brew install --cask stablyai/orca/orca` (bare `orca` is an unrelated cask); Windows `orca-windows-setup.exe`; Linux `orca-linux.AppImage`; no winget package found |
| CLI | `orca`, ships with the app and is put on PATH from Settings > General > Orca CLI |
| Claude Code hooks | Status hooks in the Claude `settings.json` (`CLAUDE_CONFIG_DIR` or `~/.claude`): SessionStart, UserPromptSubmit, Stop, StopFailure, SubagentStart, SubagentStop, TeammateIdle, PreToolUse, PostToolUse, PostToolUseFailure, PermissionRequest, PostCompact, Elicitation, ElicitationResult, SessionEnd (each gated by Claude version), plus a `statusLine` for the default config dir |
| Codex hooks | `hooks.json` and `config.toml` in an Orca-managed Codex home: SessionStart, UserPromptSubmit, PreToolUse, PermissionRequest, PostToolUse, SubagentStart, SubagentStop, Stop, Interrupt, each running `/bin/sh <script>` |
| Hook endpoint | `agent-hooks/endpoint.env` (`endpoint.cmd` on Windows) in the app data folder; `~/.orca/agent-hooks/` on remote hosts |
| Other agents | Orca also has hook installers and removers for Copilot CLI, Antigravity, Gemini, Cursor and other agents (`src/main/agent-hooks/managed-agent-hook-registry.ts`); their files and events: **VERIFY** |
| OpenCode TUI plugin | Copies a status plugin into `plugins/` (TUI copy in a `<name>-tui` folder) and adds its `file://` URL to the `plugin` list in `tui.jsonc` or `tui.json`, in `$XDG_CONFIG_HOME/opencode` or `~/.config/opencode`. Not in the hook remover list, so `orca agent hooks off` leaves it |
| Skills | Agent setup installs `orca-cli`, `orchestration` and `computer-use` into the shared `~/.agents/skills` (plus folders of detected agents, such as `~/.claude/skills`). Orca updates only its own untouched copies and never deletes a folder it did not create |
| Hooks on or off | Settings > Agents > Agent status hooks, or `orca agent hooks on\|off\|status --json`. Off removes the managed hooks and the `statusLine` |
| MCP servers | None written on its own: servers come only from what the user registers in Settings > Integrations > MCP (docs; no full source grep, **VERIFY**). The repo-root `.mcp.json` (`orca-component-fixtures`) is a test fixture, not installed |
| Permission modes | `own` (default for new sessions, adds no flag), `ask`, `accept-edits`, `auto`, `full-access` (Yolo). Settings keys `agentPermissionDefault`, `nativeChatPermissionMode`, `agentDefaultArgs` |
| Bypass flags (Yolo) | Claude Code and Antigravity `--dangerously-skip-permissions`; Codex `--dangerously-bypass-approvals-and-sandbox`; Copilot CLI, Gemini, Cursor and others `--yolo`. Auto mode: Claude `--permission-mode auto`, Codex `--approve-for-me` |
| Turn bypass off | Settings > Agents > Agent permissions: pick Manual (`ask`) or keep the default `own` (UI path and runtime default: **VERIFY** in a running app); check that no bypass flag sits in the per-agent default arguments |
| Folder trust | "Trust the folder when Orca starts an agent" is on by default and skips each agent's trust prompt; turn it off in Settings > Agents |
| Telemetry | Settings > Privacy "Share anonymous usage data", or `DO_NOT_TRACK=1` / `ORCA_TELEMETRY_DISABLED=1`. Sends version, OS, app opens, agent type, coarse errors; not prompts |
| Remove | 1. `orca agent hooks off`. 2. Skills: Orca Skills page > Delete (**VERIFY**), or `npx skills remove orca-cli orchestration computer-use -g -y` (whether it also clears the copies in agent folders such as `~/.claude/skills`: **VERIFY**). 3. OpenCode: delete Orca's `file://…/plugins/…` entry from `plugin` in `tui.json` / `tui.jsonc` and its files in `plugins/` (file name: **VERIFY**). 4. Remove the app (`brew uninstall --cask stablyai/orca/orca`, **VERIFY**). No uninstall page found upstream |

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
| `rtk init -g` without a TTY prints a manual step and skips the hook; `--auto-patch` writes it to `settings.json` | `rtk init --help` 1.1.0, `real-claude` in CI | 2026-10-30 |
| `claude mcp add`, `claude mcp list`, `claude plugin marketplace add`, `claude plugin install` and `claude plugin uninstall` work without login | `real-claude` in CI | 2026-10-30 |
| `opencode-ai` on npm provides the 1.19.0 binary | npm, `tests/real-windows.ps1` in CI | 2026-10-30 |
| Copilot CLI 1.0.105: `npm i -g @github/copilot` (Node 22+), `gh.io/copilot-install`, `winget install GitHub.Copilot`; `COPILOT_HOME`; `copilot-instructions.md`, `agents/*.agent.md`, `mcp-config.json`, `hooks/`, `settings.json`; `autoUpdate`; tool aliases `read`, `edit`, `search`, `execute`, `web` | [docs](https://docs.github.com/en/copilot/how-tos/copilot-cli) and real binary, no login | 2026-10-30 |
| `copilot mcp list --json`, `instruction list`, `skill list`, `plugin list` work without login. Piping them to `grep -q` kills copilot with EPIPE; read from a file | real binary | 2026-10-30 |
| Copilot telemetry has no setting, only `--disable-client-telemetry` | real binary (`copilot config --list`, `--help`) | 2026-10-30 |
| Antigravity CLI 1.4.12: binary `agy`, `antigravity.google/cli/install.sh` and `install.ps1`; `~/.gemini/config/{rules,agents,plugins}`, `mcp_config.json`; agent frontmatter `subagent`, `model` (`inherit`, `flash`, `pro`), `tools` | [docs](https://antigravity.google/docs) and real binary, no login | 2026-10-30 |
| `agy agents`, `agy mcp list`, `agy plugin list --json` work without login; `agy models` needs sign-in | real binary | 2026-10-30 |
| `rtk init -g --copilot` and `--agent antigravity` work without a TTY; `--uninstall` removes them. On Copilot it also adds a block to `copilot-instructions.md` | rtk 1.1.0, real binary | 2026-10-30 |
| `rtk init` does not read `COPILOT_HOME`: with that variable set, the RTK hook still lands in `~/.copilot` | rtk 1.1.0, real binary | 2026-10-30 |
| Context Mode plugin routes for both agents install and uninstall without a TTY. Copilot warns that direct plugin installs are deprecated | real binaries | 2026-10-30 |
| Skills CLI ids `github-copilot`, `antigravity-cli`. `skills remove -a <agent>` reports success but keeps `~/.agents/skills` while another detected agent may share it, so the Copilot, Antigravity and OpenCode undo drops `-a`. Side effect: those skills go for every agent on the machine. On 1.7.4 the folder stays with `~/.gemini/antigravity-cli` and `~/.config/opencode`, but not in every folder mix, so `tests/real-skills-undo.sh` uses that pair. `-a claude-code` copies to `~/.claude/skills` and does not write `~/.agents/skills`, so the Claude Code undo keeps `-a` | real binary, `real-skills-undo` in CI | 2026-10-31 |
| Codeburn: npm `codeburn` 0.9.27, repo `getagentseal/codeburn`, MIT, Node 22.13+; `report -p week --format json` | npm, real binary | 2026-10-30 |
| AutoSkills: npm `autoskills` 0.4.1, repo `midudev/autoskills`, CC-BY-NC-4.0. Identity confirmed: npm `gitHead` is the `release: v0.4.1` commit in that repo, and autoskills.sh links it. No `--version`, doctor uses `--help` | npm, GitHub, real binary | 2026-10-30 |
| GSD Core: `@opengsd/gsd-core` 1.19.0, MIT, repo `open-gsd/gsd-core`. `--copilot`, `--antigravity`, `--opencode`, `--claude` with `--global`, `--uninstall`. `model_overrides` is read from `~/.gsd/defaults.json` (`bin/lib/config-loader.cjs`) | npm, package source, real binary | 2026-10-30 |
| Model IDs for `github-copilot`, `openai-api`, `opencode-go` exist | [models.dev](https://models.dev/api.json), `scripts/models-refresh.mjs --check` | 2026-10-30 |
| OpenCode Go training terms: the default models are marked not used for training; Contributor and Free models may train; DeepSeek needs a region setting, so it is not a default | [docs](https://opencode.ai/docs/go) | 2026-10-30 |
| OpenCode 2: `cli.json` replaces `tui.json` (migration code and docs inside the binary); `policies` accepted | real binary 2.1.4, `tests/real-opencode.sh` | 2026-10-30 |
| i-have-adhd ships `disable-model-invocation: true`: a prompt cannot load it, only `/i-have-adhd` or the always-on flag. lean-agents sets it to `false` in the installed copies | plugin 0.4.1 | 2026-10-30 |
| vhs: needs `ttyd` and `ffmpeg`; tape commands `Output`, `Set`, `Hide`, `Show`, `Type`, `Enter`, `Sleep`. `charmbracelet/vhs-action` latest is v2.1.1, input `path`; the tag `v2` is used in `assets.yml` | [vhs README](https://github.com/charmbracelet/vhs), [action](https://github.com/charmbracelet/vhs-action), `assets` job | 2026-10-31 |
| `gh release create` flags `--notes-file`, `--verify-tag` | `gh release create --help` on 2.103.0 | 2026-10-31 |
| Warp install per OS, settings file paths, `telemetry_enabled`, `crash_reporting_enabled`, `login_item`, `file_based_mcp_enabled`, `~/.warp/.mcp.json`, `AGENTS.md` / `WARP.md` rules (`WARP.md` wins), `cloudflare-warp` is a different cask, leftovers after uninstall | [installation](https://docs.warp.dev/getting-started/installation), [all settings](https://docs.warp.dev/terminal/settings/all-settings/), [file locations](https://docs.warp.dev/terminal/settings/file-locations/), [MCP](https://docs.warp.dev/guides/external-tools/using-mcp-servers-with-warp.md), [rules](https://docs.warp.dev/agent-platform/capabilities/rules/), [uninstall](https://docs.warp.dev/support-and-community/troubleshooting-and-support/logging-out-and-uninstalling/) | 2026-11-03 |
| winget `Warp.Warp`: Inno installer with `user` (`/CURRENTUSER`) and `machine` (`/ALLUSERS`) scopes | [winget-pkgs manifest](https://github.com/microsoft/winget-pkgs/tree/master/manifests/w/Warp/Warp) | 2026-11-03 |
| Warp plugins `warpdotdev/claude-code-warp` (`warp@claude-code-warp`, six hooks, needs `jq`) and `warpdotdev/opencode-warp` (OpenCode 2.0.18+); rejected | [claude-code-warp](https://github.com/warpdotdev/claude-code-warp), [opencode-warp](https://github.com/warpdotdev/opencode-warp) | 2026-11-03 |
| Orca install routes (cask `stablyai/orca/orca`, bare `orca` is another cask, dmg, exe, AppImage, no winget), CLI on PATH from Settings > General, `agent-hooks/endpoint.env` / `endpoint.cmd`, hook toggle `orca agent hooks on\|off\|status --json`, folder trust default, telemetry opt-out `DO_NOT_TRACK` / `ORCA_TELEMETRY_DISABLED` and the data it sends | [README](https://github.com/stablyai/orca), [settings](https://www.onorca.dev/docs/settings), [hooks](https://www.onorca.dev/docs/agents/hooks-memory), [CLI](https://www.onorca.dev/docs/cli/overview), [telemetry](https://onorca.dev/docs/telemetry) | 2026-11-03 |
| Orca Claude hook events, `CLAUDE_CONFIG_DIR` honored, `statusLine` only for the default dir, hooks off removes them | `src/main/claude/{claude-managed-hook-events,claude-hook-event-versions,claude-config-dir-pin,hook-service}.ts` at [v1.4.247](https://github.com/stablyai/orca/tree/v1.4.247) | 2026-11-03 |
| Orca `v1.4.247` published 2026-11-03; repo-root `.mcp.json` holds only the `orca-component-fixtures` test server | [release](https://github.com/stablyai/orca/releases/tag/v1.4.247), `.mcp.json` at v1.4.247 | 2026-11-03 |
| Orca skills `orca-cli`, `orchestration`, `computer-use` installed into `~/.agents/skills` and agent folders, `orca skills install`, only untouched copies updated; MCP only from Settings > Integrations > MCP | [skills docs](https://github.com/stablyai/orca/blob/v1.4.247/docs/site/content/docs/cli/skills.mdx), `src/main/skills/bundled-skill-install/targets.ts` at v1.4.247 | 2026-11-03 |
| Orca OpenCode TUI plugin: `file://` entry in the `plugin` list of `tui.jsonc` / `tui.json`, config dir from `XDG_CONFIG_HOME`; OpenCode absent from `MANAGED_AGENT_HOOK_REMOVERS` | `src/shared/{opencode-tui-config-registration,opencode-tui-plugin-install,opencode-config-directory}.ts`, `src/main/agent-hooks/managed-agent-hook-registry.ts` at v1.4.247 | 2026-11-03 |
| Orca Codex hooks in its managed Codex home (`hooks.json`, `config.toml`) | `src/main/codex/codex-hook-definition.ts` at v1.4.247 | 2026-11-03 |
| Orca permission modes, default `own` with no flag, Yolo and auto flags per agent | `src/shared/{tui-agent-permissions,tui-agent-permission-choice,agent-chat-permission-mode,agent-permission-args}.ts` at v1.4.247 | 2026-11-03 |
| Installer with no TTY and no `--yes`: stops with a message, changes nothing; `--dry-run` with every choice as a flag exits 0. With `/dev/tty` and stdin from `/dev/null`, it asks and exits. Windows `CONIN$` is not tested | `tests/engine.test.mjs`, pty run in the `test` job | 2026-10-31 |
| Awesome lists: `hesreallyhim/awesome-claude-code` (web issue form), `awesome-opencode/awesome-opencode` (YAML PR), `punkpeye/awesome-mcp-servers` (MCP servers only). Show HN rules. Social preview 1280x640, under 1 MB. Up to six pinned repos | each project's CONTRIBUTING, [Show HN](https://news.ycombinator.com/showhn.html), GitHub docs; all links in `docs/launch.md` fetched | 2026-10-31 |
| Orca orchestration CLI (session 10): `worktree create --name --agent --prompt <text> --surface terminal --base-branch --json`, `agent launch --worktree --prompt`, `worktree ps --json`, `worktree list --json`, `worktree rm` (also deletes the branch), `terminal read --screen --limit`, `terminal send --text --enter`, `terminal wait --for exit\|tui-idle --timeout-ms`, `orchestration run-create`, `worker-start`, `worker-read`, `check`, `send`. `--prompt` takes text only: no prompt-file or stdin option | `orca agent-context --json` on Orca 1.4.243; [orchestration guide](https://github.com/stablyai/orca/blob/main/skill-guides/orchestration.md) | 2026-11-03 |
| Claude Code parallel sessions: `-w/--worktree [name]` (`.claude/worktrees/<name>`, branch `worktree-<name>`), `--tmux` (needs `--worktree`), `--bg`, `claude agents`, `logs`, `attach`, `stop`, `rm`, `--permission-mode plan`, `-n <name>`, subagent `isolation: worktree`. No prompt-file flag: prompt is argv text, or piped with `cat f \| claude -p "<instr>"`; `--append-system-prompt-file` is in the docs but only named in a note in `--help` (**VERIFY**). `-p` worktrees are not cleaned up | `claude --help` on 2.1.309; [CLI reference](https://code.claude.com/docs/en/cli-reference), [worktrees](https://code.claude.com/docs/en/worktrees), [headless](https://code.claude.com/docs/en/headless), [subagents](https://code.claude.com/docs/en/sub-agents) | 2026-11-03 |
| OpenCode parallel sessions: `opencode run "<msg>" -f <file> --agent plan --session --title --format json`, TUI `--prompt`, `serve`, `attach`, `run --attach`. No worktree command. The docs list `run --dir`, but 2.1.4 `--help` does not: set the working directory instead | `opencode run --help` on 2.1.4; [CLI docs](https://opencode.ai/docs/cli/), [agents docs](https://opencode.ai/docs/agents/) | 2026-11-03 |
| VS Code user files: `~/.copilot/copilot-instructions.md`, `~/.copilot/instructions/`, `~/.copilot/agents/`, skills in `~/.copilot/skills` and `~/.agents/skills`; workspace `AGENTS.md` (`chat.useAgentsMdFile`), `.github/copilot-instructions.md`, `.github/agents/` | [instructions](https://code.visualstudio.com/docs/copilot/customization/custom-instructions), [agents](https://code.visualstudio.com/docs/copilot/customization/custom-agents), [skills](https://code.visualstudio.com/docs/copilot/customization/agent-skills) | 2026-11-03 |
| VS Code `.agent.md` keys incl. `model` (an ID or a fallback list); `mcp.json` `servers` with `type`, `command`, `args`; `code --add-mcp` writes the user profile config | [agent file reference](https://code.visualstudio.com/docs/agents/reference/custom-agent-file-reference), [MCP reference](https://code.visualstudio.com/docs/agents/reference/mcp-configuration) | 2026-11-03 |
| VS Code `telemetry.telemetryLevel` (`all`, `error`, `crash`, `off`), `update.mode` (`default`, `start`, `manual`, `none`); `settings.json` under `Code/User` per OS | [telemetry](https://code.visualstudio.com/docs/configure/telemetry), [updates](https://code.visualstudio.com/docs/enterprise/updates), [settings](https://code.visualstudio.com/docs/getstarted/settings) | 2026-11-03 |
| Cursor CLI install `curl https://cursor.com/install -fsS \| bash` (Windows `irm 'https://cursor.com/install?win32=true' \| iex`); links `agent` and `cursor-agent` into `~/.local/bin`; `agent mcp list` | [install](https://cursor.com/docs/cli/installation), installer script, [CLI MCP](https://cursor.com/docs/cli/mcp) | 2026-11-03 |
| Cursor rules `.cursor/rules/*.mdc` (`description`, `globs`, `alwaysApply`), `AGENTS.md`; the CLI reads both; user rules only in the UI | [rules](https://cursor.com/docs/context/rules), [CLI](https://cursor.com/docs/cli/using) | 2026-11-03 |
| Cursor subagents `~/.cursor/agents`, `.cursor/agents` (`name`, `description`, `model`, `readonly`, `is_background`); skills `~/.cursor/skills`, `~/.agents/skills`; MCP `mcpServers`; CLI config `~/.cursor/cli-config.json` with `network.useHttp1ForAgent` | [subagents](https://cursor.com/docs/subagents), [skills](https://cursor.com/docs/skills), [MCP](https://cursor.com/docs/mcp), [CLI config](https://cursor.com/docs/cli/reference/configuration) | 2026-11-03 |
| `rtk init -g --agent cursor`; Skills CLI ids `cursor`, `github-copilot`; Context Mode MCP for Cursor and VS Code (`servers`) | [rtk](https://github.com/rtk-ai/rtk), [skills agents](https://github.com/vercel-labs/skills/blob/main/docs/agents.md), [context-mode](https://github.com/mksglu/context-mode) | 2026-11-03 |
| Claude through Copilot: Claude coding agent (partner agent), "Allow Claude coding agent", Copilot CLI only offers Claude models; see `docs/claude-with-copilot.md` | [Claude agent](https://docs.github.com/en/copilot/concepts/agents/anthropic-claude), [partner agents](https://docs.github.com/en/copilot/concepts/agents/about-third-party-agents) | 2026-11-03 |
| Cursor CLI 2026.10.22: `agent mcp list` runs without a login and lists `~/.cursor/mcp.json` and the repo's `.cursor/mcp.json`; `rtk init -g --agent cursor` (rtk 1.1.0) writes a preToolUse hook to `~/.cursor/hooks.json` and `--uninstall` removes it; `skills add -a cursor -g` installs into `~/.agents/skills` | `tests/real-cursor.sh`, `real-cursor` on Ubuntu and macOS | 2026-11-04 |
| VS Code: `code --add-mcp` writes the user `mcp.json` that lean-agents edits (`~/.config/Code/User` on Linux, `~/Library/Application Support/Code/User` on macOS); Copilot Chat ships built in (`--install-extension GitHub.copilot-chat` reports it as already installed, 0.71 to 0.72) | `tests/real-vscode.sh`, `real-vscode` on Ubuntu and macOS | 2026-11-04 |
| Antigravity latest: app 2.28.2 (2026-10-29), `agy` 1.4.12 (2026-10-30). No rename or app and CLI merge announced in the part of the changelog read | [download](https://antigravity.google/download), [changelog](https://antigravity.google/docs/changelog/), [CLI releases](https://github.com/google-antigravity/antigravity-cli/releases) | 2026-11-03 |
| Antigravity CLI install: `install.sh` to `~/.local/bin/agy`; Windows `irm https://antigravity.google/cli/install.ps1 \| iex` or `install.cmd` to `%LOCALAPPDATA%\agy\bin\agy.exe`; `brew install --cask antigravity-cli`; winget `Google.AntigravityCLI` 1.4.12 | [getting started](https://antigravity.google/docs/getting-started), [Homebrew](https://formulae.brew.sh/cask/antigravity-cli), [winget-pkgs](https://github.com/microsoft/winget-pkgs/tree/master/manifests/g/Google/AntigravityCLI) | 2026-11-03 |
| Antigravity app downloads: macOS `.dmg`, Windows `Antigravity-x64.exe` / `Antigravity-arm64.exe`, Linux `.tar.gz` (run `./Antigravity`). No deb or rpm found | [download](https://antigravity.google/download) | 2026-11-03 |
| Docs only, app loading **VERIFY**: Antigravity app and CLI share global rules (`~/.gemini/GEMINI.md`, `~/.gemini/AGENTS.md`, `~/.gemini/config/rules/*.md`), agents (`~/.gemini/config/agents/`), skills (`~/.gemini/config/skills/<name>/`) and MCP (`~/.gemini/config/mcp_config.json`) | [rules](https://antigravity.google/docs/rules/), [skills](https://antigravity.google/docs/skills/), [subagents](https://antigravity.google/docs/subagents/), [MCP](https://antigravity.google/docs/mcp/) | 2026-11-03 |
| Antigravity settings stay separate: CLI `~/.gemini/antigravity-cli/settings.json`, app `~/.gemini/config/config.json` (docs only, **VERIFY** on a real app). The CLI also reads `~/.gemini/antigravity-cli/skills/` and `~/.gemini/skills/` | [settings](https://antigravity.google/docs/settings/), [install](https://antigravity.google/docs/install), [migration](https://antigravity.google/docs/cli/gcli-migration/) | 2026-11-03 |
| Antigravity network: no proxy setting documented, only `sandboxProxy.http` and `sandboxProxy.certFile` for sandboxed commands; the CA variable `AGY_LLM_GATEWAY_CA_CERT` is in "Proxy and corporate CA". Telemetry is an account setting, always off for business accounts. No auto-update switch documented | [settings](https://antigravity.google/docs/settings/), [enterprise](https://antigravity.google/docs/enterprise/) | 2026-11-03 |
| Antigravity CLI on Windows: auto mode and sandbox need Windows 11 24H2+ | [CLI releases](https://github.com/google-antigravity/antigravity-cli/releases) | 2026-11-03 |
| Why lean-agents skips Antigravity on Windows: CI job `real-antigravity` runs the bash `tests/real-antigravity.sh` on `ubuntu-latest` and `macos-latest` only, and no `.ps1` version exists. No Windows failure is on record | this repo, `.github/workflows/ci.yml` | 2026-11-03 |
| Context Mode and Bun, per the README: "Bun is auto-detected for 3-5x faster JS/TS execution"; on Bun it uses `bun:sqlite` and skips `better-sqlite3`; storage is `bun:sqlite` on Bun, `node:sqlite` on Node.js 22.5+, `better-sqlite3` otherwise. The README makes no Windows-specific Bun claim. No benchmark backs the 3-5x figure | [README](https://github.com/mksglu/context-mode), [BENCHMARK.md](https://github.com/mksglu/context-mode/blob/main/BENCHMARK.md) | 2026-11-03 |
| **VERIFY** against the raw files: Context Mode source: Bun found on PATH or in `~/.bun/bin` (Windows also `%LOCALAPPDATA%\bun\bin`); no variable forces or turns off Bun; `node:sqlite` is used only when an FTS5 probe passes; `better-sqlite3` is a regular dependency (`^12.6.2`), so `npm i -g context-mode` installs it even with Bun | [runtime.ts](https://github.com/mksglu/context-mode/blob/main/src/runtime.ts), [db-base.ts](https://github.com/mksglu/context-mode/blob/main/src/db-base.ts), [package.json](https://github.com/mksglu/context-mode/blob/main/package.json) (read through a summary) | 2026-11-03 |
| Bun 1.4.4: `curl -fsSL https://bun.com/install \| bash` and `irm bun.sh/install.ps1 \| iex` to `~/.bun/bin`; `brew install oven-sh/bun/bun`; `npm install -g bun`; winget `Oven-sh.Bun` exists | [Bun install docs](https://bun.com/docs/installation), [releases](https://github.com/oven-sh/bun/releases/latest), [winget-pkgs](https://github.com/microsoft/winget-pkgs/tree/master/manifests/o/Oven-sh/Bun) | 2026-11-03 |
| `bench-context-mode` (run 2026-11-04, Node 22, Bun 1.4.4, throwaway HOME, 2 warm-up + 10 timed runs of `tests/fixtures/bench/`). **JavaScript `ctx_execute` median, Node only / Bun:** Ubuntu 46 / 30 ms (1.53x), macOS 54 / 27 ms (2.00x), Windows 109 / 70 ms (1.56x). **TypeScript:** Node only has no TS runtime (`ctx_execute` errors, asks for bun, tsx or ts-node); with Bun 29, 26 and 69 ms. **Install:** `npm i -g context-mode` about 4 s on Ubuntu and macOS, 55 s on Windows (step time); Bun 2 s, 1 s, 8 s, with the upstream script at user scope and no TTY on all three. **SQLite:** `ctx_doctor` reports FTS5 / SQLite PASS with the native module on both passes; it does not name the backend (**VERIFY**), and prebuilt vs compiled `better-sqlite3` is in the job summary. Context Mode's "3-5x" is not reproduced: 1.5-2x on this workload | `bench-context-mode` job, PR #13 | 2026-11-04 |
| Playwright MCP `--extension` connects to a running Chrome or Edge through the "Playwright Extension" (Chrome Web Store id `mmlmfjhmonkocbjadbfplnigmagldckm`); each connection is approved in the browser unless `PLAYWRIGHT_MCP_EXTENSION_TOKEN` is set in the server's environment; the token is per browser profile, shown by the extension. lean-agents adds the `playwright-extension` entry only with `--tools playwright-extension`, never for Claude Code or Antigravity | [playwright-mcp](https://github.com/microsoft/playwright-mcp), [extension README](https://github.com/microsoft/playwright/tree/main/packages/extension) | 2026-11-03 |

## Gemini CLI (not supported)

Checked 2026-11-03. lean-agents does not add a Gemini CLI adapter: upstream says free individual access and Google AI Pro and Ultra moved to Antigravity CLI on 2026-06-18, and Gemini CLI now serves Gemini Code Assist Standard and Enterprise. Antigravity CLI is supported instead.

| Item | Source | Checked |
| --- | --- | --- |
| Access moved to Antigravity CLI on 2026-06-18; Gemini CLI targets Code Assist Standard and Enterprise | [README](https://github.com/google-gemini/gemini-cli), [MCP docs](https://geminicli.com/docs/tools/mcp-server) | 2026-11-03 |
| Install: `npm install -g @google/gemini-cli`, `npx @google/gemini-cli`, `brew install gemini-cli`, MacPorts, conda | [README](https://github.com/google-gemini/gemini-cli) | 2026-11-03 |
| MCP: `~/.gemini/settings.json` `mcpServers` (`command`, `url` or `httpUrl`; `args`, `env`, `cwd`, `timeout`, `trust`, `includeTools`, `excludeTools`); `gemini mcp add [-s user\|project] [-t stdio\|sse\|http]`, `gemini mcp list`, `gemini mcp remove`; stdio servers connect only in trusted folders | [MCP docs](https://geminicli.com/docs/tools/mcp-server) | 2026-11-03 |
| Auto-update: `general.enableAutoUpdate` (default true); `skills.enabled` (default true) | [settings](https://geminicli.com/docs/cli/settings) | 2026-11-03 |
| RTK: `rtk init -g --gemini` (BeforeTool hook) | [rtk](https://github.com/rtk-ai/rtk) | 2026-11-03 |

- **VERIFY:** Gemini CLI rules file (`~/.gemini/GEMINI.md`, `context.fileName` for `AGENTS.md`), skills and subagent folders, proxy, telemetry and usage statistics settings, the Node minimum, and whether `gemini mcp list` runs without a login.

### Cursor: what CI proves today

- Proven by `real-cursor` (Ubuntu, macOS): `agent mcp list` reads `~/.cursor/mcp.json` and the repo's `.cursor/mcp.json`; the RTK hook in `~/.cursor/hooks.json`; skills in `~/.agents/skills`; `--uninstall` removes them.
- **VERIFY:** whether the Cursor CLI loads `~/.cursor/agents/*.md` and `.cursor/agents/*.md` (CI checks the files only); whether it applies `.cursor/rules/lean-agents.mdc`; Context Mode hooks for Cursor (MCP only for now); `network.useHttp1ForAgent` for proxies (not set yet); the Cursor IDE app itself (not in CI).

## Proxy and corporate CA

lean-agents copies each proxy variable it finds (`HTTP_PROXY`, `HTTPS_PROXY`, `ALL_PROXY`, `NO_PROXY`) to the other letter case for the commands it runs, because tools disagree on the case. It reports CA variables but never copies them: each one replaces a tool's whole bundle.

| Item | Proxy | Corporate CA | Source | Checked |
| --- | --- | --- | --- | --- |
| Node.js | `NODE_USE_ENV_PROXY=1` or `--use-env-proxy` (22.21+, 24+) makes `fetch` read `HTTP(S)_PROXY`, `NO_PROXY` | `NODE_EXTRA_CA_CERTS=<file>`; `NODE_USE_SYSTEM_CA=1` (22.19+, 24.6+) | [Node CLI](https://nodejs.org/api/cli.html) | 2026-11-03 |
| npm, npx | `HTTP_PROXY`, `HTTPS_PROXY`, `NO_PROXY`, or `proxy`, `https-proxy`, `noproxy` (`npm_config_*` env) | `cafile`; keep `strict-ssl` on | [npm config](https://docs.npmjs.com/cli/v10/using-npm/config) | 2026-11-03 |
| git | `http_proxy`, `https_proxy`, `all_proxy` (lowercase); `http.proxy` wins | `http.sslCAInfo`, `GIT_SSL_CAINFO` | [git-config](https://git-scm.com/docs/git-config) | 2026-11-03 |
| uv, uvx (Serena) | `HTTP_PROXY`, `HTTPS_PROXY`, `ALL_PROXY`, `NO_PROXY` (uppercase) | `SSL_CERT_FILE`, `SSL_CERT_DIR`, `UV_SYSTEM_CERTS=true` (`UV_NATIVE_TLS` is deprecated) | [uv env vars](https://docs.astral.sh/uv/reference/environment/) | 2026-11-03 |
| Homebrew | `http_proxy`, `https_proxy`, `all_proxy`, `no_proxy` (lowercase, through curl and git) | no variable documented | [brew manpage](https://docs.brew.sh/Manpage) | 2026-11-03 |
| winget | `--proxy <url>`, `--no-proxy` per run; not used by lean-agents | not documented | [winget settings](https://learn.microsoft.com/en-us/windows/package-manager/winget/settings) | 2026-11-03 |
| Claude Code | `https_proxy`, `HTTPS_PROXY`, `http_proxy`, `HTTP_PROXY` (first set wins), `NO_PROXY`; no SOCKS | `NODE_EXTRA_CA_CERTS`; bundled CAs plus the OS store; mTLS `CLAUDE_CODE_CLIENT_CERT` / `CLAUDE_CODE_CLIENT_KEY` | [network config](https://code.claude.com/docs/en/network-config) | 2026-11-03 |
| OpenCode | standard proxy variables (docs show uppercase); add `localhost` to `NO_PROXY` | `NODE_EXTRA_CA_CERTS` | [network](https://opencode.ai/docs/network/) | 2026-11-03 |
| Copilot CLI | `HTTPS_PROXY` > `https_proxy` > `HTTP_PROXY` > `http_proxy`; restart after a change | `NODE_EXTRA_CA_CERTS` plus the OS store | [network settings](https://docs.github.com/en/copilot/concepts/network-settings) | 2026-11-03 |
| Antigravity CLI | **VERIFY** | `AGY_LLM_GATEWAY_CA_CERT` (enterprise gateway, agy 1.2.15+), falls back to `SSL_CERT_FILE` | [gateway docs](https://docs.cloud.google.com/gemini/enterprise/docs/ai-developer-tools/connect-enterprise-gateway) | 2026-11-03 |
| Playwright MCP | **VERIFY** | browser download: `NODE_EXTRA_CA_CERTS`; mirror with `PLAYWRIGHT_DOWNLOAD_HOST` | [Playwright browsers](https://playwright.dev/docs/browsers) | 2026-11-03 |

## Outbound switches

The network question (`--network`, `--telemetry`, `--auto-update`, `--outbound`) sets these; see [privacy.md](privacy.md).

| Agent or tool | Category | Switch | Source | Checked |
| --- | --- | --- | --- | --- |
| Claude Code | telemetry | env `DISABLE_TELEMETRY=1`, `DISABLE_ERROR_REPORTING=1`, `DO_NOT_TRACK=1` | [data usage](https://code.claude.com/docs/en/data-usage), [env vars](https://code.claude.com/docs/en/env-vars) | 2026-11-03 |
| Claude Code | auto-update | env `DISABLE_AUTOUPDATER=1` (`claude update` still works) | [env vars](https://code.claude.com/docs/en/env-vars) | 2026-11-03 |
| Claude Code | other | env `DISABLE_BUG_COMMAND=1` (now also `DISABLE_FEEDBACK_COMMAND`); `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1` turns off updates, telemetry, error reports, feedback and surveys together, so lean-agents sets it only when all three are off | [env vars](https://code.claude.com/docs/en/env-vars) | 2026-11-03 |
| OpenCode 2 | auto-update | `update: "disable"` | [v2 config](https://opencode.ai/v2/docs/config), real binary 2.2.5 | 2026-11-03 |
| OpenCode 2 | other | `share: "disabled"`; `policies` deny `provider.use` `opencode` | real binary 2.2.5 (`tests/real-opencode.sh`) | 2026-10-31 |
| OpenCode 1 | telemetry, auto-update, other | `experimental.openTelemetry: false`; `autoupdate: false`; `share: "disabled"`, `disabled_providers` | [1.x config](https://opencode.ai/docs/config/), real binary 1.19.0 | 2026-11-03 |
| Copilot CLI | auto-update | `autoUpdate: false` in `~/.copilot/settings.json` | [change settings](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/change-settings) | 2026-11-03 |
| Copilot CLI | telemetry | `COPILOT_OFFLINE=true` disables all telemetry (and more); printed as a reminder only | [responsible use](https://docs.github.com/en/copilot/responsible-use/copilot-cli) | 2026-11-03 |
| gh | telemetry | `GH_TELEMETRY=false`, `DO_NOT_TRACK=true`, or `gh config set telemetry disabled` | [gh telemetry](https://docs.github.com/en/github-cli/github-cli/github-cli-telemetry) | 2026-11-03 |
| gh | auto-update | `GH_NO_UPDATE_NOTIFIER`, `GH_NO_EXTENSION_UPDATE_NOTIFIER` (any value) | [gh environment](https://cli.github.com/manual/gh_help_environment) | 2026-11-03 |
| Caveman | telemetry | on by default; `DO_NOT_TRACK=1` or `caveman telemetry off` | [SECURITY.md](https://github.com/JuliusBrussee/caveman/blob/main/SECURITY.md) | 2026-11-03 |
| Skills CLI | telemetry | `DISABLE_TELEMETRY=1` or `DO_NOT_TRACK=1` | [vercel-labs/skills](https://github.com/vercel-labs/skills) | 2026-11-03 |
| RTK | telemetry | off until `rtk telemetry enable` | [README](https://github.com/rtk-ai/rtk) | 2026-11-03 |
| Context Mode | telemetry | none, per README; `ctx-insight` opens a hosted dashboard only when run | [README](https://github.com/mksglu/context-mode) | 2026-11-03 |
| Serena | other | `web_dashboard: False` in Serena's config (default on; dashboard on `localhost:24282`); not set by lean-agents | [config template](https://github.com/oraios/serena/blob/main/src/serena/resources/serena_config.template.yml) | 2026-11-03 |
| Codeburn | other | CLI sends nothing; `CODEBURN_CURSOR_SYNC=0` | [README](https://github.com/getagentseal/codeburn) | 2026-11-03 |
| Homebrew | telemetry, auto-update | `HOMEBREW_NO_ANALYTICS`, `HOMEBREW_NO_AUTO_UPDATE` | [brew manpage](https://docs.brew.sh/Manpage) | 2026-11-03 |
| npm | auto-update | `update-notifier=false` | [npm config](https://docs.npmjs.com/cli/v10/using-npm/config) | 2026-11-03 |
| uv | — | no telemetry or update-check switch documented | [uv env vars](https://docs.astral.sh/uv/reference/environment/) | 2026-11-03 |

## Not yet verified

The undocumented items below (Antigravity telemetry and auto-update, Serena config, winget persistent proxy, download hosts, DCP, GSD and AutoSkills telemetry) stay **VERIFY**. The installer does not configure them: it asks the user to paste their docs or IT notes (saved to `~/.config/lean-agents/notes/`, never applied) or keep the tool's default. When another agent already set the tool up (Serena, DCP, GSD config found), it skips the question.

- `reasoningEffort` as the pass-through option for Gemini on Vertex.
- **VERIFY:** the `model` value format in Copilot `*.agent.md`. Without a login, Copilot cannot show which model it picked.
- **VERIFY:** Antigravity loading `~/.gemini/config/rules` and `~/.agents/skills`. No list command shows them without a login, so README marks both as partial.
- **VERIFY:** subreddit rules, whether r/opencode exists, and X handles in `docs/launch.md`. Reddit blocked the fetch.
- **VERIFY:** `brew install copilot-cli` (README) against `brew install --cask copilot-cli` (docs). lean-agents does not use either.
- **VERIFY:** Antigravity proxy variables (no docs; `tests/real-proxy.sh` runs `agy plugin install` through squid with direct traffic blocked) and any telemetry or auto-update switch (none documented; the CLI updates itself in the background, per [antigravity.google/cli](https://antigravity.google/cli), checked 2026-11-03).
- **VERIFY:** gh has no documented proxy or CA variable ([gh environment](https://cli.github.com/manual/gh_help_environment), 2026-11-03); `tests/real-proxy.sh` checks that it uses `https_proxy` and that `SSL_CERT_FILE` replaces its trust store.
- **VERIFY:** proxy and CA handling in RTK, Context Mode, Serena, Playwright MCP and the Skills CLI beyond the variables their runtimes (Node, uv, git) read.
- **VERIFY:** Copilot CLI `NO_PROXY` and `--disable-client-telemetry` (seen in release notes, not in the docs).
- **VERIFY:** Serena config path `~/.serena/serena_config.yml` and a usage-stats switch; GSD and Ponytail outbound calls.
- **VERIFY:** pip `PIP_PROXY`, `PIP_CERT`; winget persistent proxy settings and CA handling.
- **VERIFY:** DCP and AutoSkills telemetry; the exact winget and Playwright download hosts.
- **VERIFY:** Warp first run: whether the desktop app needs a login, writes shell integration into `~/.zshrc` / `~/.bashrc`, and has a desktop auto-update switch (only the Agent CLI documents `general.autoupdate_enabled` and `WARP_TUI_DISABLE_AUTOUPDATE`). Older docs give `~/.config/warp-terminal` as the macOS settings path.
- **VERIFY:** Orca: the hook command strings, the local hook script path and the app data folder name; the OpenCode plugin file name; whether Codex hooks go into `~/.codex` (docs say so, v1.4.247 source uses a managed home); that no MCP server is written (source grep needs a GitHub login); whether `orca agent hooks status` works without the app running; whether the app installs and starts headless in CI.
- **VERIFY:** the `orca` on PATH is Orca (`stablyai/orca`, answers `orca agent-context`), not the unrelated `orca-cli/orca`. Install, first-run hooks and bypass mode belong to session 8.
- **VERIFY:** the Orca guide advises against `task-create`, `dispatch --inject` and `check --wait` for full handoffs; read from a search summary, not the full page.
- **VERIFY:** OpenCode stdin prompts, background runs and worktrees (feature request [anomalyco/opencode#12896](https://github.com/anomalyco/opencode/issues/12896)); `opencode run` flags on 1.x.
- **VERIFY:** `copilot -p` and `agy -p` for workers; reports say `agy -p` hangs when stdout is not a TTY.
- **VERIFY:** a parallel run with a real model (needs a login, out of CI).
- **VERIFY:** the VS Code user `mcp.json` path on Windows (`%APPDATA%\Code\User`). Linux and macOS are proven by `real-vscode`.
- **VERIFY:** the `model` value format in VS Code `.agent.md` (Copilot runtime IDs are assumed, as for Copilot CLI).
- **VERIFY:** whether VS Code reads Copilot CLI hooks, so RTK for VS Code alone is not installed.
- **VERIFY:** Playwright extension mode with a real Chrome (needs the extension and a click to approve, out of CI); whether the token appears in the connect page URL; the extension's button to regenerate the token; whether VS Code and Cursor started outside a terminal see a token set in the shell profile.
- **VERIFY:** whether the Cursor CLI reads `~/.cursor/agents`, and the Context Mode hooks for Cursor and VS Code (MCP only for now).
- **VERIFY:** the Claude agent plans, the organization and enterprise policy labels, and the minimum VS Code version (see `docs/claude-with-copilot.md`).
- **VERIFY (session 11):** the next Antigravity release; only part of the changelog was read.
- **VERIFY (session 11):** brew cask and winget ids for the Antigravity app, and the install scope of `Google.AntigravityCLI`.
- **VERIFY (session 11):** that `install.sh` and `install.ps1` need no admin rights and no prompts (read through a summary, not as raw text), and how `install.ps1` adds `%LOCALAPPDATA%\agy\bin` to PATH.
- **VERIFY (session 11):** the app's MCP file. The docs say `~/.gemini/config/mcp_config.json`; the Context Mode README says `~/.gemini/antigravity/mcp_config.json`.
- **VERIFY (session 11):** `~/.agents/skills` (where the Skills CLI writes for `antigravity-cli`) is not a documented Antigravity path; `~/.gemini/config/skills` is.
- **VERIFY (session 11):** Windows paths under `%USERPROFILE%\.gemini`, any variable that moves the Antigravity config folder, and a VS Code style `settings.json` for the app (community sources only).
- **VERIFY (session 11):** the app's proxy, CA and auto-update behavior; the docs only cover `sandboxProxy`.
- **VERIFY (session 11):** on Windows, `rtk init -g --agent antigravity`, the Context Mode `configs/antigravity-cli` plugin, and `agy agents`, `agy mcp list`, `agy plugin list --json` (not in the CLI reference; they work on macOS and Linux in CI).
- **VERIFY (session 11):** whether the app has a launcher command that runs headless in CI.
- **VERIFY (session 11):** the "3-5x faster" Bun claim for `ctx_execute`; unmeasured until the `bench-context-mode` CI job runs on each OS.
- **VERIFY (session 11):** when `better-sqlite3` compiles instead of using a prebuilt binary, per OS, and whether Context Mode on Node.js 22.5+ picks `node:sqlite` on each runner.
- **VERIFY (session 11):** the winget `Oven-sh.Bun` install scope and PATH (upstream issues report `bun` missing from PATH after a winget install), and whether the Bun installer honors `BUN_INSTALL`, which Context Mode ignores.
- **VERIFY (session 11):** `better-sqlite3` load failures under Bun on Windows (Bun issues up to 1.3.0); Context Mode avoids them with `bun:sqlite`, but the status on 1.4.x is unknown.
