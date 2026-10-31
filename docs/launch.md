# Launch kit

For the owner. Not linked from the README. Every claim below is something the repo shows today. There are no savings numbers on purpose: add them only from real Codeburn data, at the `TODO(owner)` marks, and only after the README "Why" section has them.

Do not post until the `v1.0.0` release exists, unless you want a preview launch. In that case say "preview".

## What these posts may claim

| Claim | Where the repo shows it |
| --- | --- |
| One installer for Claude Code, OpenCode 1.x and 2.x, Copilot CLI, Antigravity CLI | README table, `real-*` CI jobs |
| `--dry-run` shows every file and command first | `install.sh`, CI dry-run step |
| Uninstall undoes the changes; user files are not overwritten | `scripts/lib/fsops.mjs`, tests in `tests/engine.test.mjs` |
| Five subagents by cost tier | `core/agents/` |
| No login is used in CI; real binaries in a throwaway HOME | `.github/workflows/ci.yml` |

Do not claim: token or cost savings, that Antigravity loads the rules or skills, or that Copilot picks the model set per agent. See "Not yet verified" in `docs/compatibility.md`.

## X

> lean-agents: one command sets up the same rules, cheap-by-default subagents and context-saving tools in Claude Code, OpenCode, Copilot CLI and Antigravity CLI.
>
> `--dry-run` shows every change first. `--uninstall` undoes it. MIT.
>
> https://github.com/estebanmr99/lean-agents

`TODO(owner)`: second post with the real Codeburn before and after.

## LinkedIn

> I use more than one AI coding agent, and each one had its own rules, its own subagents and its own tool setup.
>
> lean-agents is one installer for all of that: Claude Code, OpenCode, GitHub Copilot CLI and Antigravity CLI. It installs one rule set, subagents by cost tier, and tools that keep big outputs out of the context window.
>
> It shows every change with `--dry-run`, keeps your existing config, and `--uninstall` undoes it. Each CI job runs real agent binaries in a throwaway HOME.
>
> Every third-party tool comes from its upstream source, with credit and a link in the README.
>
> https://github.com/estebanmr99/lean-agents

## Reddit

Read each sidebar first. Self-promotion rules could not be confirmed on 2026-10-31 (**VERIFY**). Say that you made it.

- r/ClaudeAI: exists.
- r/LocalLLaMA: lead with OpenCode and model profiles, not Claude Code. Secondary guides report a 1-in-10 self-promotion norm.
- r/ChatGPTCoding: **VERIFY** rules.
- r/opencode: **VERIFY** it exists. A search found r/opencodecli instead.

Title: `I made one installer for rules, subagents and context tools across Claude Code, OpenCode, Copilot CLI and Antigravity CLI`

> I kept copying rules and subagents between coding agents, so I wrote one source and adapters per agent.
>
> What it installs: global rules, five subagents by cost tier, MCP servers (Serena, Playwright), and optional tools such as RTK and Context Mode. Everything comes from upstream; the repo is only glue.
>
> Run `--dry-run` first: it lists every file and command. `--uninstall` undoes it.
>
> Known gaps: Antigravity rule and skill loading is not proven, because it needs a login. The README table marks each partial feature.
>
> I have no token numbers to share yet. `TODO(owner)`: replace this line with real Codeburn numbers, or keep it.
>
> Feedback on what breaks on your setup is what I want most: https://github.com/estebanmr99/lean-agents

## Show HN

Rules: https://news.ycombinator.com/showhn.html. It must be easy to try without signup: `--dry-run` is.

Title: `Show HN: lean-agents – one installer for rules and subagents across coding agents`

First comment:

> I use several coding agents and got tired of keeping their rules, subagents and MCP config in step. lean-agents keeps one neutral source and renders it per agent: Claude Code, OpenCode 1.x and 2.x, Copilot CLI and Antigravity CLI.
>
> The part I cared about most is safety: `--dry-run` prints every file and command, edits keep your comments and values, and `--uninstall` undoes it. CI runs real agent binaries in a throwaway HOME, with no login, so a few things stay unproven. Those are listed in `docs/compatibility.md`.
>
> It installs third-party tools from upstream and ships only glue. I have no savings numbers yet. `TODO(owner)`: replace with real Codeburn numbers, or keep it.

Tell readers it was built with coding agents: the repo history shows it.

## Awesome lists

| List | How to submit | Note |
| --- | --- | --- |
| [hesreallyhim/awesome-claude-code](https://github.com/hesreallyhim/awesome-claude-code) | Web issue form only, no PR, no `gh` CLI. See [CONTRIBUTING](https://github.com/hesreallyhim/awesome-claude-code/blob/main/CONTRIBUTING.md) | Repo needs 14 days since the first commit plus active development, or 100 stars: from 2026-11-14. The repo may be agent-written, but you must write the recommendation yourself |
| [awesome-opencode/awesome-opencode](https://github.com/awesome-opencode/awesome-opencode) | PR with a YAML file under `data/<category>/`, not the README. See [contributing](https://github.com/awesome-opencode/awesome-opencode/blob/main/contributing.md) | Fits |
| [punkpeye/awesome-mcp-servers](https://github.com/punkpeye/awesome-mcp-servers) | PR on the README | Skip: lean-agents is not an MCP server, it only configures them |

## Upstream authors to tag

GitHub owners, from each repo. X handles are listed only when the repo links one; do not guess the others.

| Tool | GitHub owner | X |
| --- | --- | --- |
| RTK | [rtk-ai](https://github.com/rtk-ai/rtk) | none linked |
| Context Mode | [mksglu](https://github.com/mksglu/context-mode) | none linked |
| Serena | [oraios](https://github.com/oraios/serena) | none linked |
| Playwright MCP | [microsoft](https://github.com/microsoft/playwright-mcp) | **VERIFY** |
| Ponytail | [DietrichGebert](https://github.com/DietrichGebert/ponytail) | **VERIFY** |
| Caveman | [JuliusBrussee](https://github.com/JuliusBrussee/caveman) | none linked |
| i-have-adhd | [ayghri](https://github.com/ayghri/i-have-adhd) | none linked |
| OpenCode DCP | [Opencode-DCP](https://github.com/Opencode-DCP/opencode-dynamic-context-pruning) | **VERIFY** |
| Codeburn | [getagentseal](https://github.com/getagentseal/codeburn) | `@_codeburn` |
| GSD Core | [open-gsd](https://github.com/open-gsd/gsd-core) | **VERIFY** |
| AutoSkills | [midudev](https://github.com/midudev/autoskills) | none linked |
| Skills CLI | [vercel-labs](https://github.com/vercel-labs/skills) | none linked |

## Owner checklist

1. Description: `One command. Every coding agent. Fewer tokens, clearer answers.`
2. Topics (gear next to "About"): `claude-code`, `opencode`, `github-copilot`, `ai-agents`, `agents-md`, `mcp`, `token-optimization`, `dotfiles`, `developer-tools`.
3. [Social preview](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/customizing-your-repositorys-social-media-preview): Settings, Social preview, upload `docs/assets/social-preview.png`.
4. Settings, Features: turn Discussions on.
5. [Pin the repo](https://docs.github.com/en/account-and-profile/how-tos/profile-customization/pinning-items-to-your-profile) on your profile.
