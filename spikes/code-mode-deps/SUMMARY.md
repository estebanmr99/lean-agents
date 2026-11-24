# Spike: Code Mode Dependencies

- Dependency tree size: 166
- SDK top-level deps (17): @hono/node-server, ajv, ajv-formats, content-type, cors, cross-spawn, eventsource, eventsource-parser, express, express-rate-limit, hono, jose, json-schema-typed, pkce-challenge, raw-body, zod, zod-to-json-schema
- @modelcontextprotocol/server@2.4.0: PASS (Published: 2026-10-23T18:20:13.773Z)
  - Deps: zod, @modelcontextprotocol/core
- @modelcontextprotocol/client@2.4.0: PASS (Published: 2026-10-23T18:21:05.614Z)
  - Deps: zod, jose, cross-spawn, eventsource, pkce-challenge, eventsource-parser, @modelcontextprotocol/core

## Sandbox Probes

- async callTool x3: PASS (Result: [1,2,3])
- process: PASS (ReferenceError: 'process' is not defined)
- require: PASS (ReferenceError: 'require' is not defined)
- fetch: PASS (ReferenceError: 'fetch' is not defined)
- dynamic import: PASS (ReferenceError: could not load module 'fs')
- globalThis keys: PASS (Result: [])
- infinite loop: PASS (InternalError: interrupted)
- memory limit (100MB): PASS (InternalError: out of memory)

## Verifications

- All transitive deps have valid signatures: Yes
```
audited 98 packages in 0s

98 packages have verified registry signatures

17 packages have verified attestations
(use --json --include-attestations to view attestation details)
```