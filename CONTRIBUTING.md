# Contributing

Thanks for helping. The full design is in [docs/SPEC.md](docs/SPEC.md); read its "Non-negotiable rules" first.

## Development

1. Install Node 22.20 or newer.
2. From the repo root, install dependencies: `npm ci`
3. Run the engine tests (temp HOME, no external commands): `npm test`
4. Lint the shell scripts: `shellcheck install.sh scripts/check-private.sh tests/*.sh`
5. Run the privacy check: `bash scripts/check-private.sh`
6. Try the installer without touching your real HOME: `node scripts/lean.mjs --home "$(mktemp -d)" --no-exec --yes --dry-run --agents claude,opencode-v2 --all-tools`

[AGENTS.md](AGENTS.md) has the full table of commands, including the real-binary checks that CI runs.

## Ground rules

- **No private data.** No personal usernames or home paths (use `~`, `$HOME`, `%USERPROFILE%`), company names or internal tools, cloud project IDs, emails, keys or tokens.
- Run `scripts/check-private.sh` before committing. CI runs it plus gitleaks on every PR.
- Verify every install command and config key against the tool's current upstream docs, and record the date in `docs/compatibility.md`.
- Keep `core/AGENTS.md` short: it is loaded on every turn of every agent.
- Third-party tools are installed from upstream and credited, never vendored.
- Conventional commits (`feat:`, `fix:`, `docs:`, `ci:`, `chore:`).

## Issues and labels

Pick a form when you open an issue (bug, feature, update finding, agent support); vulnerabilities go through [SECURITY.md](SECURITY.md), not an issue. Maintainers add a `priority:` (p0 to p2) and an `area:` label when triaging. `bash scripts/labels.sh` creates the label set.

## Private denylist

`scripts/check-private.sh` also reads extra patterns from a local, gitignored `.private-denylist` file (one regex per line). Put your own username, company name and internal hostnames there so they can never be committed by accident.

## Adding an agent

Open an "Agent support" issue first with links to the agent's docs for global instructions, subagents, MCP and plugins. Then:

1. Add an adapter at `scripts/lib/adapters/<agent>.mjs`. It returns `{ actions, commands }`; use the existing adapters as the pattern (see [SPEC section 6](docs/SPEC.md#6-subagents-and-adapters)).
2. `agents/<agent>/` holds documentation only; do not put code there.
3. Touch the tests: `tests/engine.test.mjs` for the engine behavior and `tests/agent-install.test.mjs` for the install flow. Add a `tests/real-<agent>.sh` check and its CI job for real binaries.

## Proposing a tool

Third-party tools are not added on a pull request alone. The owner decides first.

1. Open an issue with the tool's details in the [SPEC section 7](docs/SPEC.md#7-third-party-tools-tools-tool) format: name, upstream link, license, what it does in one line, how to remove it, install command per OS, which agents it wires into, and tier (Minimal, Optional or Docs only).
2. Wait for the owner to approve the tool. Only then open a pull request. It adds the recipe (`tools/<tool>/` with `README.md`, `install.sh`, `install.ps1`, the uninstall scripts and a `check` function) and follows the checklist in [AGENTS.md](AGENTS.md#git): CHANGELOG, README compatibility tables and `docs/compatibility.md`.
3. Not accepted: Oh My OpenAgent and Graphify. The owner rejected both; see [docs/faq.md](docs/faq.md).

See [tools/README.md](tools/README.md) for the tools that already exist.

