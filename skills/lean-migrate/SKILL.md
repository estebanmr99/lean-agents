---
name: lean-migrate
description: Guide an OpenCode 1.x to 2.x upgrade through the lean-agents engine: dry run, show what is managed, translatable or manual, ask, apply, check, then port the manual items by hand. Use when the user wants to move OpenCode 1.x to 2.x without losing config or sessions. Opt-in.
---

# lean-migrate

You guide the upgrade; the engine changes files. Never edit an OpenCode 1.x file yourself, never run the installer or `opencode upgrade` directly, never touch `~/.local/share/opencode` (sessions).

1. Hand-built machine (no `~/.config/lean-agents/state.json`)? Run `npx lean-agents --adopt --json` first. It is read-only; show the user what it found.
2. Dry run: `npx lean-agents --upgrade-agent opencode --dry-run --json`. Writes nothing. Read `upgrade.counts`, `upgrade.plan` and each item's `upgrade` block.
3. Show three short lists, never secret values:
   - **managed**: lean-agents reinstalls these for 2.x.
   - **translatable**: `before -> after` plus its `source`.
   - **manual**: item and `reason`. Rows marked VERIFY are unproven; say so.
4. Ask the user whether to go on. Stop on "no". Applying is `npx lean-agents --upgrade-agent opencode --yes`; in the current release that is rejected with "not in this release yet", so tell the user and stop there.
5. After an apply: `npx lean-agents --doctor`. `opencode --version` must show 2.x and the session count must equal the dry run's `upgrade.layout.sessions`.
6. Port each manual item into the 2.x files only (`~/.config/opencode/opencode.jsonc`, `cli.json`, the 2.x folders), one at a time, asking before each. Keep the 1.x originals as they are.
7. If doctor fails or sessions changed: `npx lean-agents --upgrade-agent opencode --undo`, then report the exact error.

Report what you verified (command and result) and what is left for the user.
