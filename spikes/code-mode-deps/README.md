# Code Mode Dependency Spike

Measures dependency footprint and QuickJS sandbox security for the proposed Code Mode proxy.

## Bars
- All escape probes (process, require, fetch, import) must be blocked.
- Infinite loops must be interrupted by the deadline.
- Memory allocations exceeding the limit must fail.
- Async host calls (`callTool`) must work and return results.

## Run
```bash
cd spikes/code-mode-deps
npm ci --ignore-scripts
node probe.mjs
```
