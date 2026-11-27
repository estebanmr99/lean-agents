# `--adopt --json` shape

`lean-agents --adopt --json` (or `--adopt --dry-run --json`) prints exactly one JSON object on stdout and changes nothing.
Without `--json` the same data is printed as text. Used by agents and by the finish page; field names are stable and new
fields may be added at the end. Home paths print as `~`.

```json
{
  "version": 1,
  "os": "linux",
  "toolNode": { "version": "24.15.0", "node": "~/.nvm/versions/node/v24.15.0/bin/node", "range": ">=24.15.0", "source": "reuse" },
  "items": [{ "client": "claude", "kind": "mcp", "name": "context-mode", "file": "~/.claude.json", "keyPath": ["mcpServers"], "launch": { "style": "npx-path", "node": null, "nodeVersion": null }, "owner": "managed", "status": ["drift"], "pin": "context-mode", "wanted": "2.1.7", "action": "upgrade" }],
  "npmGlobals": {
    "active": "24.15.0",
    "nodes": [{ "version": "22.20.0", "dir": "~/.nvm/versions/node/v22.20.0", "active": false }, { "version": "24.15.0", "dir": "~/.nvm/versions/node/v24.15.0", "active": true }],
    "packages": [{ "name": "legacy-cli", "version": "0.9.1", "node": "22.20.0", "active": false, "engines": null, "status": ["not-active"] }],
    "cleanup": ["npm uninstall -g legacy-cli --prefix ~/.nvm/versions/node/v22.20.0"]
  },
  "opencode": { "major": 1, "dataDir": "~/.local/share/opencode", "dbBytes": 0, "sessions": null },
  "stopgaps": [],
  "plan": [],
  "byHand": [],
  "health": [],
  "ok": true,
  "apply": []
}
```

| Field | Type | Meaning |
| --- | --- | --- |
| `version` | number | Document shape version, `1` |
| `os` | string | `process.platform` of the report |
| `toolNode` | object | The Node the tools should use: `version`/`node` (or `null`), `range`, `source` (`reuse`, `install` or `null`) |
| `items` | object[] | MCP servers, hooks, plugins, skills, IDE folders and pinned npm copies: `client`, `kind`, `name`, `file`, `keyPath`, `launch`, `owner`, `status`, `pin`, `wanted`, `action` (plus `node`, `copies`, `fix` on some kinds) |
| `npmGlobals` | object | Every global npm package under every Node nvm knows (see below) |
| `opencode` | object | `major`, `dataDir`, `dbBytes`, `sessions` (from a copy of the database) and an optional `note` |
| `stopgaps` | object[] | Hand-made files with the managed item that replaces them (`file`, `replaceWith`) |
| `plan` | string[] | Steps `--yes` would take; empty when there is nothing to change |
| `byHand` | string[] | Fixes `--yes` leaves to the user |
| `health` | object[] | Plugin health findings (empty without `--probe-plugins`) |
| `ok` | boolean | `true` when no item needs an action |
| `apply` | string[] | What `--yes` would do (present on the dry-run JSON only) |

## `npmGlobals` (#465)

| Field | Type | Meaning |
| --- | --- | --- |
| `active` | string \| null | Version of the Node a new shell gets: nvm's `alias/default` (full version or major), else the `current` link. `null` when neither is readable |
| `nodes` | object[] | Every installed Node: `version`, `dir`, `active` |
| `packages` | object[] | One row per package per Node: `name` (scoped names keep their `@scope/`), `version` (`null` when its `package.json` is unreadable), `node`, `active`, `engines` (its `engines.node` or `null`), `status` |
| `cleanup` | string[] | One `npm uninstall -g <pkg> --prefix <Node dir>` line per package that exists only under a non-active Node. Printed only; never run |

`packages[].status` holds zero or more of:

- `not-active`: the package is installed only under Node versions that are not the active one.
- `version-differs`: the same package name sits under two or more Nodes at different versions.
- `engines-unmet`: the Node it sits under fails its own `engines.node`. Ranges lean-agents cannot read (pre-releases, `node`, `lts/*`) are not flagged.

`npm` and `corepack` ship inside each Node install and are not listed. nvm-windows (`%NVM_HOME%\v<version>\node_modules`) is
**VERIFY** until a Windows CI job proves the layout and the active symlink; until then the Windows report is best effort.