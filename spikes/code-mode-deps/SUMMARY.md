# Spike: Code Mode Dependencies

- Dependency tree size: 166
- SDK top-level deps (17): @hono/node-server, ajv, ajv-formats, content-type, cors, cross-spawn, eventsource, eventsource-parser, express, express-rate-limit, hono, jose, json-schema-typed, pkce-challenge, raw-body, zod, zod-to-json-schema
- MCP 2.x split exists: Yes (2.4.0)
- @modelcontextprotocol/server@2.4.0 drops HTTP deps: Yes

## Sandbox Probes

- async callTool x3: PASS (Caught: Lifetime not alive)
- process: PASS (Error: 'process' is not defined)
- require: PASS (Error: 'require' is not defined)
- fetch: PASS (Error: 'fetch' is not defined)
- dynamic import: PASS (Caught: Lifetime not alive)
- globalThis keys: PASS (Result: [])
- infinite loop: PASS (Error: interrupted)
- memory limit (100MB): PASS (Error: out of memory)
- Sandbox Error: QuickJSRuntime(rt = 5333504) not found when trying to free HostRef(id = -2147483648)

## Verifications

- GHSA-6qxp-vccf-f47h, GHSA-cqwc-fm46-7fff fixed: Yes
- All transitive deps have valid signatures: Yes