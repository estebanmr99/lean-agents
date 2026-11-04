# Claude through GitHub Copilot

How to use Claude when your company pays for GitHub Copilot, which routes GitHub allows, and why lean-agents installs nothing for this. Checked 2026-11-03.

## Short version

- **Allowed:** the Claude coding agent, one of Copilot's partner agents (Agent HQ). It runs on your Copilot subscription after an admin turns it on.
- **Also allowed:** the Claude models inside Copilot (VS Code chat, Copilot CLI `/model`). These are Copilot-hosted models, not the Claude Code agent. lean-agents already uses them through the `github-copilot` profile.
- **Not supported:** tools that reuse a Copilot token to run the Claude Code CLI. lean-agents never installs them.

## The allowed route, step by step

1. **Check your plan.** GitHub lists the partner agents for Copilot Pro, Pro+ and Max, for Copilot Business, and for Copilot Enterprise. **VERIFY:** GitHub pages disagree on which plans get it, so check the [partner agents page](https://docs.github.com/en/copilot/concepts/agents/about-third-party-agents) for yours.
2. **Admin, enterprise level.** In the enterprise AI controls, open the **Agents** section and allow the Claude agent for the organizations that need it. ([Claude coding agent](https://docs.github.com/en/copilot/concepts/agents/anthropic-claude))
3. **Admin, organization level.** In the organization's Copilot policies, turn on **Allow Claude coding agent**. This installs a GitHub App named `anthropic code agent`. **VERIFY:** the exact policy label on the organization and enterprise pages.
4. **You, personal plans only.** In your own Copilot settings, turn on **Allow Claude coding agent**.
5. **Use it:**
   - On github.com: the **Agents** tab, or assign an issue or pull request to the Claude agent.
   - In VS Code: start a new session in the chat view and pick Claude. **VERIFY:** the minimum VS Code version. `docs/SPEC.md` assumes 1.109 or later; GitHub states none.

Policies for partner agents do not cover local agents in VS Code. Those follow the normal Copilot model policies. **VERIFY:** GitHub's Claude agent page says so, but no policy page confirms it.

## Copilot CLI

Copilot CLI (`copilot`) offers Claude models through `/model`. It does not run the Claude coding agent. On 2026-11-03 no Copilot CLI docs mentioned partner agents.

## Not supported

These are not official and break the "no secrets" and "honest compatibility" rules of this repo:

- Local proxies that take your Copilot token and expose it as an Anthropic-compatible API, so the Claude Code CLI runs on a Copilot subscription. Their own READMEs say they are unofficial and that GitHub may flag or suspend the account.
- Copying Copilot tokens into Claude Code settings or environment variables.

lean-agents never installs, configures or recommends these. GitHub's [Generative AI Services Terms](https://github.com/customer-terms/github-generative-ai-services-terms) have no clause written for proxies. The [Acceptable Use Policies](https://docs.github.com/en/site-policy/acceptable-use-policies/github-acceptable-use-policies) forbid unauthorized access and exploiting the service without permission. **VERIFY:** whether GitHub states that these clauses cover proxies. If your company wants Claude Code itself, use an Anthropic plan or API key with `--agents claude`.

## What lean-agents does

Nothing for the partner agent: it is a policy switch, not a file or package. With `--project`, your rules, subagents and MCP servers are already in place when the Claude agent works in the same repository, because it reads `AGENTS.md`. **VERIFY:** whether the Claude agent reads `AGENTS.md`.
