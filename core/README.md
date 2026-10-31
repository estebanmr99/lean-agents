# core

The single source of truth. Adapters in `agents/` render these files into each agent's format.

- `AGENTS.md` / `AGENTS.es.md`: global rules. Placeholders (`{{LANG_RULE}}`, `{{SERENA_HINT}}`, `{{TOOL_RULES}}`) are filled at install time so the rules only mention tools you installed.
- `agents/`: neutral subagent definitions with a `tier` instead of a model ID.
- `mcp.json`: MCP servers rendered per agent.
- `tiers.json`: example tier mapping; real mappings live in `profiles/`.
