# FAQ

## Why not X?

- **Oh My OpenAgent (OMO):** powerful, but it adds many MCP servers and integrations, which costs context on every turn and widens what the agent can reach. lean-agents keeps the MCP list short and gets similar planning/building routing from tiered subagents.
- **Graphify:** builds a code graph with AI calls, which costs a lot of tokens up front. Serena gives symbol-level navigation through a language server at no model cost.
- **Terminal-specific plugins (for example Warp):** they only help users of one terminal. This covers Warp's Claude Code plugin ([`warpdotdev/claude-code-warp`](https://github.com/warpdotdev/claude-code-warp)) and its OpenCode plugin ([`warpdotdev/opencode-warp`](https://github.com/warpdotdev/opencode-warp)). Notification hooks may be documented later in a terminal-neutral way.

## What does Orca change in my agents?

[Orca](https://github.com/stablyai/orca) adds its own status hooks to Claude Code and Codex, a status plugin to OpenCode's `tui.json` (or `tui.jsonc`), and the `orca-cli`, `orchestration` and `computer-use` skills to `~/.agents/skills`. If you choose its Yolo (full-access) mode, it also starts agents with bypass flags such as `--dangerously-skip-permissions` or `--yolo`. New sessions use the agent's own permission settings unless you change that. To keep approvals, set Settings > Agents > Agent permissions to Manual or keep the default, and keep bypass flags out of the per-agent default arguments. `orca agent hooks off` removes its hooks but not the OpenCode plugin or the skills; the removal steps are in the compatibility doc. Details and sources: [compatibility](compatibility.md#orca).

## Does it change my existing config?

It merges into it after a backup and never removes your keys. Instruction files get an import line or a marked block, never an overwrite. `--uninstall` restores the backups.
