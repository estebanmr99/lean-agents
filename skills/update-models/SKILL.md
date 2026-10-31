---
name: update-models
description: Compare the tier-to-model mapping with the models the account can use now, and propose a change. Use when the user asks about newer models, a model was retired, or models.dev shows a new one.
---

# update-models

1. Read the current mapping: `~/.config/lean-agents/state.json` gives the profile, and `profiles/<name>.json` in the lean-agents repository gives the tiers.
2. List what this account can use:
   - OpenCode: `opencode models` or `opencode models <provider>`.
   - Claude Code: the `/model` command. The tiers use the aliases `haiku`, `sonnet`, `opus`.
   - Copilot CLI: the `/model` command in a session. Your plan or organization may hide some models.
   - Antigravity: `agy models` after signing in. Subagents take only `flash`, `pro` or `inherit`.
3. Read the provider's release notes for each candidate. Check price and whether prompts may be used for training. On OpenCode Go, avoid models named Contributor or Free.
4. Show the proposal as a table: tier, current model, proposed model, one-line reason. Keep the fast tier cheap.
5. Write nothing before the user approves. After approval, edit the profile, then rerun the installer with `--update`.
6. Report what changed and how to go back. The previous files are in `~/.config/lean-agents/backups`.
