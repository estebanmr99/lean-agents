# Third-party tools

lean-agents installs these from upstream and never vendors them. Each one is optional except RTK and Context Mode. The exact commands per agent live in `scripts/lib/adapters/` and are listed in [docs/manual-install.md](../docs/manual-install.md).

| Tool | What it does | License | Upstream |
| --- | --- | --- | --- |
| RTK | Compresses shell output before the agent reads it | see repo (OSS edition: Apache-2.0) | [rtk-ai/rtk](https://github.com/rtk-ai/rtk) |
| Context Mode | Keeps large tool outputs out of the context window | Elastic License 2.0 | [mksglu/context-mode](https://github.com/mksglu/context-mode) |
| Serena | Symbol-level code navigation via language servers | see repo | [oraios/serena](https://github.com/oraios/serena) |
| Playwright MCP | Browser automation | see repo | [microsoft/playwright-mcp](https://github.com/microsoft/playwright-mcp) |
| Ponytail | Code-quality guidance each turn, `/ponytail-audit` | see repo | [DietrichGebert/ponytail](https://github.com/DietrichGebert/ponytail) |
| i-have-adhd | Skimmable, action-first answers | see repo | [ayghri/i-have-adhd](https://github.com/ayghri/i-have-adhd) |
| Caveman | Extra-compressed answers on request | see repo | [juliusbrussee/caveman](https://github.com/juliusbrussee/caveman) |

Codeburn, AutoSkills and GSD arrive in v0.4.
