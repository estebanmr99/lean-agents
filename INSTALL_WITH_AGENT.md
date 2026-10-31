# Install with your agent

Paste this into Claude Code, OpenCode or Copilot CLI. Your agent will ask before changing anything.

```text
Install lean-agents for me from https://github.com/estebanmr99/lean-agents.
1. Clone it to ~/.config/lean-agents/src (Windows: %USERPROFILE%\.config\lean-agents\src).
2. Read docs/SPEC.md section 4 (installer behavior) and section 11 (strict privacy).
3. Detect which coding agents and tools I already have, then ask me:
   which agents to configure, which optional tools to add, whether I want
   strict privacy, which model profile matches my subscription, and my language.
4. Run `bash install.sh --dry-run` with the flags from my answers (see `--help`). Show me the plan.
5. After I approve, run it for real, then run the doctor and explain any failures.
Never read, print or store my API keys or tokens.
```

> Today the installer configures Claude Code and OpenCode 2.x on macOS and Linux. Windows support arrives in the next release.
