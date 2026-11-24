# Spike: Code Mode MCP Proxy

This spike measures the `@utcp/code-mode-mcp@1.2.1` proxy to evaluate if it's a viable solution for bringing Code Mode-like functionality to Copilot CLI, Cursor CLI, and Antigravity CLI.

## Security Note

This is a **spike only**. The security inspector verdict allows this spike under strict guards, but it is **not to be shipped** to production/enterprise work PCs.

## Contents

- `fake-mcp.mjs`: A synthetic MCP server exposing 20 tools.
- `measure.mjs`: Measurement script for cold start, latency, token reduction, and sandbox escape.
- `package.json`: Dependency pinning.

## Run (CI Only)

```bash
npm ci --ignore-scripts
npm rebuild isolated-vm
node measure.mjs
```
