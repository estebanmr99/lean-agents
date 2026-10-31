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

| Codeburn | Usage and cost report across agents, run with `npx` | MIT | [getagentseal/codeburn](https://github.com/getagentseal/codeburn) |
| AutoSkills | Picks skills per project, run with `npx autoskills` in the project. Opt-in | CC BY-NC 4.0, non-commercial use only | [midudev/autoskills](https://github.com/midudev/autoskills) |
| GSD Core | Spec-driven workflow skills and agents. Opt-in | MIT | [open-gsd/gsd-core](https://github.com/open-gsd/gsd-core) |

i-have-adhd ships with `disable-model-invocation: true`, so a prompt cannot load it: only `/i-have-adhd` or the always-on flag (`--adhd-always`) can. lean-agents sets it to `false` in the installed copies, so an agent can load it when asked. A plugin update resets it; the doctor reports that, and `--update` applies it again. `--uninstall` restores it.
