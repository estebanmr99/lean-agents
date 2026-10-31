# Strict privacy mode

Off by default. Turn it on with `--privacy strict` (or answer yes when asked). It is meant for work machines with strict data rules.

| Agent | What changes |
| --- | --- |
| Claude Code | `env`: `DISABLE_AUTOUPDATER=1`, `DISABLE_TELEMETRY=1`, `DISABLE_ERROR_REPORTING=1`, `DISABLE_BUG_COMMAND=1`, `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1`. Manual step: turn off "Help improve Claude" in your claude.ai privacy settings. |
| OpenCode 2 | `"share": "disabled"`, `"update": "disable"`, and a policy that denies the built-in `opencode` provider unless your profile uses it. |
| OpenCode 1 | `"share": "disabled"`, `"autoupdate": false`, `"experimental": { "openTelemetry": false }`, and `"disabled_providers": ["opencode"]` unless your profile uses that provider. |

| Copilot CLI | `"autoUpdate": false` in `~/.copilot/settings.json`. Telemetry has no setting: start Copilot with `--disable-client-telemetry`. Strict mode prints this reminder and cannot do it for you. |
| Antigravity CLI | Nothing on disk: telemetry is an account setting, and no auto-update setting is documented. Manual step: turn off "Enable Telemetry" in Antigravity settings. Strict mode prints this reminder. |

With auto-updates off, update on purpose: `opencode upgrade`, `claude update`, `copilot update`, then `install.sh --update` or `install.ps1 -Update` (see [update.md](update.md)).

Strict mode never installs tools that send data without opt-in. Pick model providers whose terms do not train on your prompts.
