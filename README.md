<div align="center">

# lean-agents

**One command. Every coding agent. Fewer tokens, clearer answers.**

The same rules, cheap-by-default subagents, context-saving tools and MCP servers for Claude Code, OpenCode, GitHub Copilot CLI and Antigravity CLI, on macOS and Windows.

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![Platforms](https://img.shields.io/badge/platforms-macOS%20%7C%20Windows-lightgrey)
![Agents](https://img.shields.io/badge/agents-Claude%20Code%20%7C%20OpenCode%20%7C%20Copilot%20CLI%20%7C%20Antigravity-8A2BE2)
[![Secret scan](https://github.com/estebanmr99/lean-agents/actions/workflows/secret-scan.yml/badge.svg)](https://github.com/estebanmr99/lean-agents/actions/workflows/secret-scan.yml)

[Leer en español](README.es.md)

</div>

> **Status: under construction.** The installer lands in the next releases. Follow [the spec](docs/SPEC.md) and the [roadmap](#roadmap). Star the repo to get notified when `v1.0.0` ships.

<!-- TODO(session 5): demo GIF -->

## Quick start

macOS, Linux or Git Bash:

```bash
curl -fsSL https://raw.githubusercontent.com/estebanmr99/lean-agents/main/install.sh | bash -s -- --dry-run
```

Windows PowerShell:

```powershell
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/estebanmr99/lean-agents/main/install.ps1))) -DryRun
```

Prefer your agent to do it? Paste a prompt from [INSTALL_WITH_AGENT.md](INSTALL_WITH_AGENT.md) into Claude Code, OpenCode or Copilot CLI.

Always start with `--dry-run`: it shows every file and command before anything changes.

## Why

<!-- TODO(session 5): real before/after numbers from Codeburn. No invented numbers. -->

- **Fewer tokens.** Exploration, research and review go to cheap subagents. Big outputs stay out of the context window. Agents search symbols instead of reading whole files.
- **Clearer answers.** One short set of global rules: answer first, state assumptions, surgical changes, verify before saying done.
- **Same behavior everywhere.** Rules are written once in `core/` and rendered for each agent.

## What you get

| Feature | Claude Code | OpenCode 2.x | OpenCode 1.x | Copilot CLI | Antigravity CLI |
| --- | --- | --- | --- | --- | --- |
| Global rules (AGENTS.md) | ✅ | ✅ | ✅ | 🔎 | 🔎 |
| Subagents by cost tier | ✅ | ✅ | ✅ | 🔎 | 🔎 |
| RTK (shell output compression) | ✅ | ✅ | ✅ | 🔎 | 🔎 |
| Context Mode | ✅ plugin | ✅ MCP | ✅ plugin | 🔎 MCP | 🔎 MCP |
| Serena + Playwright MCP | ✅ | ✅ | ✅ | 🔎 | 🔎 |
| Ponytail, i-have-adhd | ✅ | ✅ | ✅ | ➖ | ➖ |
| Caveman and other skills | ✅ | ✅ | ✅ | 🔎 | 🔎 |
| Context compaction | ✅ auto 80% | ✅ native | ✅ DCP | 🔎 | 🔎 |

✅ supported · 🔎 being verified · ➖ not available for this agent

## Install tiers

| Tier | What | Default |
| --- | --- | --- |
| Minimal | Rules, tiered subagents, compaction, output limits, RTK, Context Mode | Always |
| Optional tools | Serena, Playwright, Ponytail, Caveman, i-have-adhd, Codeburn, AutoSkills, GSD | Asked one by one |
| Strict privacy | No telemetry, no auto-updates, no session sharing, no providers that train on your prompts | Off, opt in with `--privacy strict` |

## Models that stay current

Subagents ask for a tier (`fast`, `balanced`, `strong`), not a model ID. Claude Code maps tiers to the `haiku`, `sonnet` and `opus` aliases, which always point to the newest models. Other agents use dated [profiles](profiles/) per subscription, and the `update-models` skill refreshes them with your approval.

## Safety

- Backs up every file before touching it. `--uninstall` restores them.
- Never overwrites your `AGENTS.md` or `CLAUDE.md`: it imports or appends a marked block.
- Never asks for, stores or prints API keys. You log in to providers yourself.
- No admin rights needed (`--no-admin`), so it works on locked-down work laptops.

## Credits

lean-agents is glue. The heavy lifting is done by these projects; please star them too:

[RTK](https://github.com/rtk-ai/rtk) ·
[Context Mode](https://github.com/mksglu/context-mode) ·
[Serena](https://github.com/oraios/serena) ·
[Playwright MCP](https://github.com/microsoft/playwright-mcp) ·
[Ponytail](https://github.com/DietrichGebert/ponytail) ·
[Caveman](https://github.com/juliusbrussee/caveman) ·
[i-have-adhd](https://github.com/ayghri/i-have-adhd) ·
[OpenCode DCP](https://github.com/Opencode-DCP/opencode-dynamic-context-pruning) ·
[GSD Core](https://github.com/open-gsd/gsd-core) ·
Codeburn · AutoSkills · [Skills CLI](https://vercel.com/changelog/introducing-skills-the-open-agent-skills-ecosystem)

## Roadmap

- [x] Spec, rules and subagent definitions
- [ ] Installer for Claude Code and OpenCode 2.x (macOS)
- [ ] Windows installer and OpenCode 1.x
- [ ] Copilot CLI, Antigravity CLI, Codeburn, AutoSkills, original skills, model profiles
- [ ] `v1.0.0`
- Later: Codex CLI, Gemini CLI, Cursor

## Contributing

Issues and PRs are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) first; every PR runs a secret and privacy scan.

## License

[MIT](LICENSE)
