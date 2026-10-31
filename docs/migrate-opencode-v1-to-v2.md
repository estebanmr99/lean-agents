# Migrate from OpenCode 1.x to 2.x

Do this after upgrading the OpenCode binary. lean-agents configures one major version at a time.

## With lean-agents

1. Uninstall the 1.x setup: `install.sh --uninstall` (PowerShell: `install.ps1 -Uninstall`).
2. Install again for 2.x: `install.sh --agents opencode-v2` (PowerShell: `install.ps1 -Agents opencode-v2`).
3. Move your own 1.x settings using the table below.
4. Check the result: `opencode debug config`, then `install.sh --doctor`.

## By hand

Back up `~/.config/opencode` first, then change these keys.

| OpenCode 1.x | OpenCode 2.x |
| --- | --- |
| `agent` | `agents` |
| `plugin` | `plugins` |
| `autoupdate: false` | `update: "disable"` |
| flat `mcp.<name>` | `mcp.servers.<name>` |
| `experimental.policies`, `disabled_providers` | `policies` |
| `compaction.reserved` | `compaction.buffer` |
| `tui.json` | `cli.json` |

Then:

- **DCP:** remove the plugin and `dcp.jsonc`. lean-agents uses native compaction with `compaction.buffer` on 2.x. DCP does install on 2.x, so you can keep it by hand, but lean-agents does not manage it there.
- **Context Mode:** remove it from `plugin` and add it as MCP under `mcp.servers.context-mode`. Never keep both.
- **Check:** run `opencode debug config` and confirm your keys appear.
