# Code Mode proxy: design v1 (#407)

Status: design, security gate 2 passed with changes (Sonnet inspector, 2026-11-24; all 14 findings folded in below). No code yet. Date 2026-11-24.

Upstream caveat: quickjs-emscripten is below 1.0, "has not been audited" and gives no isolation guarantee (https://github.com/justjake/quickjs-emscripten). The sandbox is one layer, not the whole defense: the allowlist, fixed upstreams and scrubbed env below must hold even if a script escapes.

## What it is

A small stdio MCP server that lean-agents can put in front of the MCP servers it manages for Copilot CLI, Cursor CLI and Antigravity CLI. The agent sees two tools instead of every tool of every server:

- `search_tools({ query })`: matching tool names with one-line signatures (`server.tool(args)`, short description).
- `run_script({ code })`: runs a JavaScript snippet in a sandbox. The snippet calls proxied tools with `await tools.<server>.<tool>(args)`; only the value it returns goes back to the agent.

Measured upside (#304 spike, run 45311269097): tool list 3,783 → 904 tokens for 20 tools. Never offered for Claude Code (native Code Mode) or OpenCode 2 (native `execute`).

## Decisions

| # | Decision | Why |
|---|---|---|
| 1 | **No MCP SDK.** The proxy speaks MCP stdio itself: newline-delimited JSON-RPC 2.0, only `initialize`, `notifications/initialized`, `tools/list`, `tools/call`, `ping` (server side) and the same four as a client to each upstream. | Spike 2 (#415): the SDK pulls 166 packages (express, hono, jose...); the 2.x client still pulls jose, pkce-challenge, eventsource. The stdio subset is about 150 lines we own and test. The SDK approval stays unused. |
| 2 | **Sandbox: `quickjs-emscripten-core` + `@jitl/quickjs-wasmfile-release-sync`, exact pins.** Host tool calls return a guest promise the host resolves later (the pattern #415's probe proved: 3 delayed calls, `[1,2,3]`). No module loader is ever set (`import` always fails). | WASM, no native build, works on Windows. The sync variant is smaller than asyncify and does not need it with deferred promises. |
| 3 | **Fixed upstreams.** The server list comes from one config file read at start. No tool, script or message can add, remove or change upstreams. No command, shell or HTTP plugins. | The blocker found in `@utcp/code-mode-mcp` (`register_manual`). |
| 3a | **v1 proxies only lean-managed servers** (the ones lean-agents writes: context-mode, serena, ...). The user's own MCP entries stay where they are, untouched. | Removes the consent flow and the byte-for-byte restore of user entries. Moving user servers can come in v2 if the measurement asks for it. |
| 4 | **Optional install, outside the lean-agents package deps.** Proxy source ships in the package (`tools/code-mode-proxy/`, with its own `package.json` + lockfile). `--tools code-mode-proxy` runs `npm ci --ignore-scripts` for it into lean's data dir, as an engine command with an undo (like the adhd command): the undo runs `tools/code-mode-proxy/remove.mjs <dir>`, which deletes the dir only if it holds lean's marker file, is inside the lean data dir and is not a symlink. | Keeps lean-agents' own dependency rule (jsonc-parser, @clack/prompts) and the owner's "optional install" decision; no new fsops action kind. |

## Sandbox limits (defaults; config can lower them, never raise past the cap)

| Limit | Default | Cap |
|---|---|---|
| Memory per script (`setMemoryLimit` on a fresh runtime per call) | 64 MB | 128 MB |
| Stack (`setMaxStackSize`) | 512 KB | 1 MB |
| Wall time per script | 15 s | 60 s |
| Tool calls per script | 25 | 100 |
| Tool calls per proxy process (session budget) | 500 | 2,000 |
| Concurrent `run_script` calls / in-flight upstream calls | 2 / 4 | — |
| Result returned to the agent | 20,000 chars (cut, with a note) | 100,000 |
| Upstream message or result read before `JSON.parse` | 1 MB | — |
| Script size | 20,000 chars | — |

- **Deadline:** enforced only by `shouldInterruptAfterDeadline` passed to every `evalCode` and `executePendingJobs` (both are synchronous, so a host timer cannot stop `while (1) await null`). The host timer only bounds waiting for upstream replies; on expiry the call is aborted.
- **Lifetime:** every handle and deferred promise of a call lives in one `Scope`. On any exit (result, error, timeout, abort) the call is marked closed, all deferreds and handles are disposed, then the context and the runtime. A late upstream reply checks the closed flag and is dropped.
- **Guest globals:** standard ECMAScript built-ins, `tools`, `console.log` (collected, returned with the result under the same cap). Nothing else: no `process`, `require`, `import`, `fetch`, timers, filesystem. No state between calls.
- **Bridge:** `tools` is built from null-prototype objects with `defineProperty`, then frozen. Server and tool names must match `^[A-Za-z_][A-Za-z0-9_]*$` and are never `__proto__`, `constructor` or `prototype`; others are skipped and reported by `search_tools`. Arguments cross as one JSON string (`JSON.stringify` in the guest, `JSON.parse` on the host, must be a plain object), checked against the tool's `inputSchema` top level (required keys, primitive types), never merged into another object. Results go back only as a string through `newString` and a guest-side `JSON.parse`; host values are never spliced into code. shortcut: top-level schema check only; nested validation if an upstream needs it.
- **Probes** (unit tests and `--doctor` self-test, at the design limits, not 100 MB): process, require, fetch, import, globalThis keys, infinite loop, memory at 64 MB, `Object.prototype` mutation not visible to the next call, deep recursion, `while (1) await null`, never-resolving upstream, upstream named `__proto__`.

## Upstreams

- **Config file** `<lean config dir>/code-mode-proxy.json` decides what runs at every agent start, so: written by a `file` action with the `managed by lean-agents` mark, mode `0600` in a user-only dir. At start the proxy refuses to run if the mark is missing or the file is group- or world-writable (POSIX). The path is fixed; never taken from argv or env.
- **Commands:** spawned once at start with `shell: false`, args as an array, `cwd` = the lean data dir. Each `command` must be an absolute path to an executable or to `node` plus a JS entry file; `.cmd` and `.bat` are rejected at config load (Node refuses them without a shell since the CVE-2024-27980 fix, and a shell reopens argument injection). lean already has absolute `node_command` forms for its servers (`scripts/lib/render.mjs`). **VERIFY** in the Windows CI leg.
- **Env per upstream:** a fixed base (`PATH`, `HOME`, `USERPROFILE`, `SYSTEMROOT`, `APPDATA`, `LOCALAPPDATA`, `TEMP`, `TMP`, `NVM_DIR`, and the proxy/CA variables from "Child environment allowlist" in `docs/compatibility.md`) plus only the `env` keys its entry names. `NODE_OPTIONS` and `npm_config_*` are never in the base. The proxy's own env is never forwarded whole.
- **Protocol:** an upstream that fails `initialize` within 10 s is left out and listed as unavailable with the reason. Any upstream-initiated request (`sampling/*`, `roots/list`, `elicitation/*`, anything else) gets error `-32601`; replies with an unknown id are ignored. When the proxy's stdin closes, it kills every upstream (process tree on Windows).

## Which tools can run: allowlist

Default deny. A proxied tool is callable only if (a) the config `allow` list names it (`server.tool`; lean writes a reviewed list for the servers it manages), or (b) the upstream marks it `readOnlyHint: true`. A name veto stays on top, even for allowed tools unless named exactly: `delete|remove|rm|drop|kill|exec|execute|shell|write|move|rename|create|update|edit|replace|insert|send|post|push|upload|install|apply|set|patch|commit|run|fetch` (word parts, case-insensitive). `search_tools` shows blocked tools as blocked. A blocked call returns an error the script can catch.

Each `run_script` result lists the `server.tool` names it called (with counts) and wraps tool output as untrusted data, so the user sees in the agent's transcript what one approved script did.

## Audit log

JSONL at `<lean state dir>/code-mode-proxy.log`, created `0600`: time, `sha256` of the script, call count, and per call: server, tool, duration ms, ok/error, blocked. No arguments or results unless config `log_args: true`. Upstream stderr and error messages are redacted with the same secret-name patterns as the child env allowlist, at most 50 lines per upstream, 2 KB per line. Rotates at 1 MB (one `.1` kept). `--uninstall` removes both files.

## Supply chain

`core/pins.json` holds both packages' exact version and `sha512` integrity, and the `sha256` of the `.wasm` file. PR 1 runs `npm audit signatures` on the proxy's own lockfile and records whether each package has provenance (spike 2 checked the SDK tree, not this one). Install and `--doctor` verify the lockfile hash and the hash of `tools/code-mode-proxy/` sources against the shipped values. The pins bump process adds a QuickJS advisory check (`version-watch`).

## lean-agents integration

- `--tools code-mode-proxy`: opt-in, never in `--all-tools` or `--everything`, never on the enterprise profile until a security sign-off on a release.
- Adapters (copilot, cursor, antigravity) with the tool on: write the lean-managed servers into the proxy config (`<lean config dir>/code-mode-proxy.json`, a `file` action) and write one `lean-code-mode` MCP entry (`json` action) instead of those servers. Without the tool: today's output, unchanged (`scripts/behavior-diff.sh` proves it).
- `--doctor` row: proxy starts, upstream count (ok/unavailable), sandbox self-test passes.
- `--uninstall`: the normal action undo; nothing user-owned is moved, so nothing user-owned is restored.
- Re-run without `--tools code-mode-proxy` after having it: the adapters write the direct server entries again, remove `lean-code-mode`, and the proxy command's undo deletes its dir, config and log. Covered by an engine test.
- Agent-side approvals (an "always allow" for `lean-code-mode` in Copilot, Cursor or Antigravity) can outlive uninstall: listed in `docs/compatibility.md` as **VERIFY**; the real-CLI jobs check that none remain after `--uninstall`.

## Delivery (one PR each, mid/strong worker, coordinator review, security inspector on 1 and 3)

1. Proxy core in `tools/code-mode-proxy/`: JSON-RPC framing, upstream client, sandbox, limits, deny list, audit log. Unit tests with a fake upstream (node:test, no network). `npm audit signatures` + `npm audit --omit=dev --audit-level=high` in the existing spike workflow.
2. Measurement: the existing spike workflow runs the proxy against the #304 fake server. Pass bars: ≥ 50% fewer tool-list tokens, start < 2 s, RSS < 150 MB, per-call overhead < 300 ms, sandbox probes blocked, no runtime registration.
3. Engine: `--tools code-mode-proxy`, pins, adapters, doctor row, uninstall, docs (README EN/ES tables, compatibility, CHANGELOG).
4. Real CLIs: steps added to the existing `real-copilot`, `real-cursor`, `real-antigravity` jobs (no new jobs): the CLI lists `lean-code-mode` and calls one tool through it, throwaway HOME.
5. #404: three Code Modes on the same tasks (Claude Code native, OpenCode `execute`, ours on Copilot CLI), cost-weighted. Recommended in docs only if ours is within reach.

## Open questions for the owner

- OK to skip the MCP SDK entirely (decision 1)? It means fewer dependencies than you approved.
- OK that v1 proxies only lean-managed servers (decision 3a)?
