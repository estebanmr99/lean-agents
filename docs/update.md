# Updating

Update one thing at a time and check after each step.

1. Record versions: `claude --version`, `opencode --version`, `rtk --version`, `node --version`.
2. Agents: `claude update`, `opencode upgrade`.
3. lean-agents: run the installer again with `--update`. It re-applies your saved choices, backs up first and changes only what is new.
4. Tools: `brew upgrade rtk uv` (Windows: `winget upgrade rtk-ai.rtk astral-sh.uv`), `npm update -g context-mode`, `claude plugin update <name>`, `git -C ~/.config/opencode/vendor/i-have-adhd pull --ff-only`.
5. Check: `node ~/.config/lean-agents/src/scripts/lean.mjs --doctor`, then `/status` in OpenCode.

To go back after `--update` moved an agent CLI: `--update --undo` shows the plan (the version each agent had before its first upgrade); add `--yes` to run it. `--uninstall` leaves those agent CLIs as they are.

Or ask your agent to use the `lean-update` skill: it runs `--update --dry-run`, shows a table, asks, applies, then `--doctor`. The nightly CI run (`ci-latest`) proves the move from the last published release to the current pins in a throwaway HOME (`tests/real-update.sh`, N-1 -> N).

Read release notes before crossing a major version.
