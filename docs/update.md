# Updating

Update one thing at a time and check after each step.

1. Record versions: `claude --version`, `opencode --version`, `rtk --version`, `node --version`.
2. Agents: `claude update`, `opencode upgrade`.
3. lean-agents: run the installer again with `--update`. It re-applies your saved choices, backs up first and changes only what is new.
4. Tools: `brew upgrade rtk uv` (Windows: `winget upgrade rtk-ai.rtk astral-sh.uv`), `npm update -g context-mode`, `claude plugin update <name>`, `git -C ~/.config/opencode/vendor/i-have-adhd pull --ff-only`.
5. Check: `node ~/.config/lean-agents/src/scripts/lean.mjs --doctor`, then `/status` in OpenCode.

Read release notes before crossing a major version.
