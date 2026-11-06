# Strict privacy mode

Off by default. The installer asks one network question with three answers:

- **off**: enterprise PC. Telemetry, auto-updates, session sharing, the feedback command and built-in providers off (see [what is not blocked](#what-each-preset-does-not-block)). Same as `--network off` or `--privacy strict`.
- **on**: personal PC. Nothing changes. Same as `--network on` or `--privacy standard`, and the default with `--yes`.
- **choose**: ask per category.

For `--yes` runs, set one category with `--telemetry on|off`, `--auto-update on|off` or `--outbound on|off`. These override the preset. The choice is saved in `~/.config/lean-agents/state.json` (`options.network`), and `--update` reuses it.

| Category | Claude Code | OpenCode 2 | OpenCode 1 | Copilot CLI | While installing |
| --- | --- | --- | --- | --- | --- |
| telemetry | `DISABLE_TELEMETRY`, `DISABLE_ERROR_REPORTING`, `DO_NOT_TRACK` | ➖ | `experimental.openTelemetry: false` | reminder only | `DO_NOT_TRACK=1`, `HOMEBREW_NO_ANALYTICS=1`, `GH_TELEMETRY=false` |
| auto-update | `DISABLE_AUTOUPDATER` | `update: "disable"` | `autoupdate: false` | `autoUpdate: false` | |
| outbound | `DISABLE_BUG_COMMAND` | `share`, deny the `opencode` provider | `share`, `disabled_providers` | | |
| all three off | also `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` | | | | |

`DO_NOT_TRACK=1` in Claude Code's settings also turns off Caveman and Skills CLI telemetry inside Claude Code. For other agents, set it in your shell profile. Antigravity CLI updates itself and has no documented switch for it (**VERIFY**). Sources and dates are in [compatibility.md](compatibility.md#outbound-switches).

The table below is the "all off" (strict) result per agent.

| Agent | What changes |
| --- | --- |
| Claude Code | `env`: `DISABLE_AUTOUPDATER=1`, `DISABLE_TELEMETRY=1`, `DISABLE_ERROR_REPORTING=1`, `DISABLE_BUG_COMMAND=1`, `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1`, `DO_NOT_TRACK=1`. Manual step: turn off "Help improve Claude" in your claude.ai privacy settings. |
| OpenCode 2 | `"share": "disabled"`, `"update": "disable"`, and a policy that denies the built-in `opencode` provider unless your profile uses it. |
| OpenCode 1 | `"share": "disabled"`, `"autoupdate": false`, `"experimental": { "openTelemetry": false }`, and `"disabled_providers": ["opencode"]` unless your profile uses that provider. |
| Copilot CLI | `"autoUpdate": false` in `~/.copilot/settings.json`. Telemetry has no setting: start Copilot with `--disable-client-telemetry`. Strict mode prints this reminder and cannot do it for you. |
| Antigravity CLI | Nothing on disk: telemetry is an account setting, and no auto-update setting is documented. Manual step: turn off "Enable Telemetry" in Antigravity settings. Strict mode prints this reminder. |
| VS Code Copilot | `telemetry.telemetryLevel: "off"` and `update.mode: "none"` in the VS Code user `settings.json`. |
| Cursor | Nothing on disk: Privacy Mode is stored on your account. Manual step: turn it on in Cursor settings. Strict mode prints this reminder. |
| Warp | Nothing on disk. Manual step: set `[privacy] telemetry_enabled = false` in its `settings.toml` (the free plan may need it on for AI). Strict mode prints this reminder. |
| Orca | No file is changed. On Windows, when Orca is detected, strict mode sets `DO_NOT_TRACK=1` and `ORCA_TELEMETRY_DISABLED=1` in your user environment (restart Orca; a value you already set is kept, and `--uninstall` removes only the ones it set). Elsewhere, set `DO_NOT_TRACK=1` where Orca starts, or turn off Settings > Privacy > Share anonymous usage data. Strict mode prints this reminder. |

With auto-updates off, update on purpose: `opencode upgrade`, `claude update`, `copilot update`, then `install.sh --update` or `install.ps1 -Update` (see [update.md](update.md)).

## What each preset does NOT block

The presets set switches in the agents' configs and, while installing, `DO_NOT_TRACK=1`, `HOMEBREW_NO_ANALYTICS=1` and `GH_TELEMETRY=false`. They do not stop the downloads the install itself makes, under any preset:

- `git`, `npm` and `npx` (the packages pinned in `core/pins.json`, which `npx` fetches at run time), `uvx` (Serena), `brew` or `winget`, `curl` or `irm` (the Bun installer), and the browser binaries Playwright downloads.
- Tools you choose keep their own network behavior. Strict mode sets no switch for them. Only Claude Code gets `DO_NOT_TRACK=1` (which also covers Caveman and Skills CLI inside Claude Code), and the install commands run with it. Strict mode does not remove a tool: `--all-tools` still installs Serena, Codeburn, Ponytail and the rest. Their telemetry is either documented in [compatibility.md](compatibility.md#outbound-switches) or marked **VERIFY** in [compatibility.md](compatibility.md#not-yet-verified).
- `--doctor` runs its child commands (version probes, `mcp list`, `npx`) with the same environment as the install (`DO_NOT_TRACK=1` and friends under telemetry off). With `outbound` off it skips every `mcp list` (it would start Serena through `uvx` and Playwright) and prints one `mcp servers` row marked `skipped`; with `outbound` on it starts them. `npx` checks for codeburn and autoskills still run and may download the pinned package.
- Claude Code, Copilot CLI, VS Code Copilot and `--project` lose the research agent's web tools (`WebFetch`, `WebSearch`, `web`) when `outbound` is off. Antigravity keeps them. lean-agents does not remove them for OpenCode (**VERIFY** what its agents inherit).

Sources, hosts and dates: [compatibility.md](compatibility.md#verification-log) and [compatibility.md](compatibility.md#outbound-switches). To block the downloads, run the installer where your network or proxy policy allows only what you accept.

Pick model providers whose terms do not train on your prompts.
