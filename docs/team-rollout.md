# Team rollout

How to roll out lean-agents across a team so everyone shares the same rules, subagents, and MCP configurations in git, while keeping personal state and credentials local.

[Leer en español](team-rollout.es.md)

---

## 1. Pin one version across the team

Do not let teammates run `npx lean-agents@latest` independently, which can introduce differing rules or tool pins across machines. Instead, pin an exact version in your team runbook or package scripts:

```bash
npx lean-agents@1.3.0 --project . --dry-run
```

Preview with `--dry-run` first to inspect every planned action without touching files. Once reviewed, apply the plan:

```bash
npx lean-agents@1.3.0 --project .
```

PowerShell takes the same command.

## 2. Commit the `--project` files to git

Running with `--project <dir>` writes shared configuration directly into the repository. Inspect and commit the generated files:

| File / Folder | Purpose |
| --- | --- |
| `AGENTS.md` | Shared global rules at the repository root. Placed in a marked block; existing custom rules outside the block are preserved. |
| `.github/copilot-instructions.md` | Points GitHub Copilot to `AGENTS.md` so rules load once without duplication. |
| `.github/agents/*.agent.md` | Tiered subagent definitions for VS Code Copilot (`explore`, `research`, `review`, `debug`, `planner`). |
| `.cursor/rules/lean-agents.mdc` | Cursor rule definition pointing to `AGENTS.md`. |
| `.cursor/agents/*.md` | Tiered subagent definitions for Cursor (`explore`, `research`, `review`, `debug`, `planner`). |
| `.vscode/mcp.json` | Shared MCP server definitions for VS Code (Context Mode, plus Serena and Playwright if you pick them with `--tools`). |
| `.cursor/mcp.json` | Shared MCP server definitions for Cursor. |

Commit them to the repository:

```bash
git add AGENTS.md .github .cursor .vscode
git commit -m "chore: add lean-agents team setup"
```

Team state is stored locally in `~/.config/lean-agents/projects/`, never inside the repository.

Optional tools (such as Serena or Playwright) can be included during `--project` setup using `--tools`:

```bash
npx lean-agents@1.3.0 --project . --tools serena,playwright
```

## 3. Teammate onboarding and `--doctor`

When a teammate pulls the branch, git delivers the repository rules, subagents, and MCP configurations. Each teammate then installs the required agent tools locally:

```bash
npx lean-agents@1.3.0 --dry-run
npx lean-agents@1.3.0
```

Every teammate then verifies their setup with `--doctor`:

```bash
npx lean-agents@1.3.0 --doctor
```

### What doctor statuses mean

| Status | Meaning | Action needed |
| --- | --- | --- |
| `ok` | The component, binary, or pin is verified, healthy, and matches the expected configuration. | None. Everything is working. |
| `note` | Information only (for example, shell guidance, project Node notices, or manual settings). | None (information only, nothing to fix). |
| `changed` | A file, pin, or setting differs from the installed state (for example, a rule file edited locally since install, or a pin drift indicating an update is available). | Review the change. Local edits are fine if intentional; otherwise run `--update`. |
| `error` | A required tool, binary, MCP registration, or install command failed or is missing, or a managed file is missing. | Check the reported error detail and reinstall or fix the missing requirement. |
| `missing` | lean-agents is not installed on this machine (`not installed (run the installer)`). | Run the install (`npx lean-agents@1.3.0`). |

You can also pass `--json` to `--doctor` for machine-readable output in scripts or verification checks.

## 4. Work PCs behind a proxy

If teammates work on corporate machines behind an authenticating proxy or custom certificate authority:

- Follow the setup in the README: [On a work PC: proxy, network and security review](../README.md#on-a-work-pc-proxy-network-and-security-review).
- Define `HTTPS_PROXY`, `NO_PROXY`, and `NODE_EXTRA_CA_CERTS` in your terminal session.
- Pass `--network off` (or `--privacy strict`) if outbound telemetry, automatic update checks, or external network requests are restricted by corporate policy:

```bash
npx lean-agents@1.3.0 --project . --network off
```

## 5. Updating across the team (`--update`)

When upgrading the team to a newer lean-agents version:

1. **Maintainer updates the repository:**
   ```bash
   npx lean-agents@1.3.0 --project . --update --dry-run
   npx lean-agents@1.3.0 --project . --update
   git add AGENTS.md .github .cursor .vscode
   git commit -m "chore: update lean-agents to 1.2.0"
   git push
   ```

2. **Teammates update their local environment:**
   After pulling the commit, each teammate runs:
   ```bash
   npx lean-agents@1.3.0 --update --dry-run
   npx lean-agents@1.3.0 --update
   npx lean-agents@1.3.0 --doctor
   ```

To remove all configurations added by lean-agents:
```bash
npx lean-agents@1.0.0 --project . --uninstall
```
