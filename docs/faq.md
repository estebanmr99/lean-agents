# FAQ

## Why not X?

- **Oh My OpenAgent (OMO):** powerful, but it adds many MCP servers and integrations, which costs context on every turn and widens what the agent can reach. lean-agents keeps the MCP list short and gets similar planning/building routing from tiered subagents.
- **Graphify:** builds a code graph with AI calls, which costs a lot of tokens up front. Serena gives symbol-level navigation through a language server at no model cost.
- **Terminal-specific plugins (for example Warp):** they only help users of one terminal. Notification hooks may be documented later in a terminal-neutral way.

## Does it change my existing config?

It merges into it after a backup and never removes your keys. Instruction files get an import line or a marked block, never an overwrite. `--uninstall` restores the backups.
