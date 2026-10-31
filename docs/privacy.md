# Strict privacy mode

Off by default. Turn it on with `--privacy strict` (or answer yes when asked). It is meant for work machines with strict data rules.

| Agent | What changes |
| --- | --- |
| Claude Code | `env`: `DISABLE_AUTOUPDATER=1`, `DISABLE_TELEMETRY=1`, `DISABLE_ERROR_REPORTING=1`, `DISABLE_BUG_COMMAND=1`, `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1`. Manual step: turn off "Help improve Claude" in your claude.ai privacy settings. |
| OpenCode 2 | `"share": "disabled"`, `"update": "disable"`, and a policy that denies the built-in `opencode` provider unless your profile uses it. |

With auto-updates off, update on purpose: `opencode upgrade`, `claude update`, then `install.sh --update` (see [update.md](update.md)).

Strict mode never installs tools that send data without opt-in. Pick model providers whose terms do not train on your prompts.
