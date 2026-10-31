# Security

## Reporting

Please report vulnerabilities privately through GitHub's "Report a vulnerability" button on the Security tab. Do not open public issues for security problems.

## What the installer touches

- Only files under your user profile: `~/.claude/`, `~/.config/opencode/`, `~/.copilot/`, the Antigravity config folder, `~/.config/lean-agents/` and your global git ignore.
- Every file is backed up to `~/.config/lean-agents/backups/<timestamp>/` first.
- It never reads, stores or prints credentials. Provider logins are done by you.
- It installs third-party tools from their upstream sources. Review [docs/SPEC.md section 7](docs/SPEC.md#7-third-party-tools-toolstool) for the full list and run with `--dry-run` first.
