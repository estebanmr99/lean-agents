# Contributing

Thanks for helping. The full design is in [docs/SPEC.md](docs/SPEC.md); read its "Non-negotiable rules" first.

## Ground rules

- **No private data.** No personal usernames or home paths (use `~`, `$HOME`, `%USERPROFILE%`), company names or internal tools, cloud project IDs, emails, keys or tokens.
- Run `scripts/check-private.sh` before committing. CI runs it plus gitleaks on every PR.
- Verify every install command and config key against the tool's current upstream docs, and record the date in `docs/compatibility.md`.
- Keep `core/AGENTS.md` short: it is loaded on every turn of every agent.
- Third-party tools are installed from upstream and credited, never vendored.
- Conventional commits (`feat:`, `fix:`, `docs:`, `ci:`, `chore:`).

## Private denylist

`scripts/check-private.sh` also reads extra patterns from a local, gitignored `.private-denylist` file (one regex per line). Put your own username, company name and internal hostnames there so they can never be committed by accident.

## Adding an agent

Open an "Agent support" issue first with links to the agent's docs for global instructions, subagents, MCP and plugins. Then add `agents/<agent>/` following [SPEC section 6](docs/SPEC.md#6-subagents-and-adapters).
