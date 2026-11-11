# Signed-in browser for agents (Playwright Extension)

Many pages sit behind single sign-on. The default `playwright` MCP server starts a fresh browser with no cookies, so it lands on a login page. Extension mode attaches to the Chrome or Edge you already use, with your sessions.

Use it with OpenCode, Copilot CLI, VS Code Copilot and Cursor. Claude Code and Claude Desktop have their own route, Claude in Chrome, so lean-agents does not add this server for Claude Code.

| | `playwright` (default) | `playwright-extension` (opt-in) |
| --- | --- | --- |
| Browser | new browser, no profile | your own Chrome or Edge, signed in |
| Pages behind SSO | fail | work |
| Setup | none | install the extension, approve each session |
| Risk | sees only what it opens | sees every site you are signed in to |

## Turn it on

1. Run the installer with the tool, for example:
   `curl -fsSL https://github.com/estebanmr99/lean-agents/releases/latest/download/install.sh | bash -s -- --tools playwright-extension`
   It adds `npx -y @playwright/mcp@0.0.83 --extension` as `playwright-extension` next to the headless entry.
2. Install the **Playwright Extension** yourself from the Chrome Web Store:
   https://chromewebstore.google.com/detail/playwright-extension/mmlmfjhmonkocbjadbfplnigmagldckm
   Browsers do not let a script install extensions without an admin policy, so the installer only prints the link.
3. Keep Chrome open. When the agent first uses the browser, the extension asks you to approve the connection and pick a tab. This approval per session is the default and the safest choice.

`--uninstall` removes the MCP entry. Remove the extension from `chrome://extensions` yourself.

## Optional: skip the approval with a token

The extension shows a token that lets the MCP server connect without asking. It is a recommendation for people who approve many sessions a day, not a requirement. **lean-agents never asks for, stores or prints this token.** You set it yourself.

1. Open the extension (toolbar icon or its status page) and copy the token. It belongs to one browser profile.
2. Set `PLAYWRIGHT_MCP_EXTENSION_TOKEN` for your user:
   - **Windows** (PowerShell or cmd): `setx PLAYWRIGHT_MCP_EXTENSION_TOKEN "<paste-token>"`, then open a new terminal.
   - **macOS** (zsh): add `export PLAYWRIGHT_MCP_EXTENSION_TOKEN="<paste-token>"` to `~/.zshrc`, then open a new terminal.
   - **Linux** (bash): add the same line to `~/.bashrc`, then open a new terminal.
   To keep the token out of your shell history, edit the file in an editor instead of running `echo … >>` in the terminal.
3. Restart the agent from that new terminal. The MCP server reads the variable from the agent's environment.

**VERIFY:** VS Code and Cursor started from the Dock, Start menu or a launcher may not read `~/.zshrc` or `~/.bashrc`. Start them from a terminal (`code`, `cursor`) if the approval still appears.

### Treat the token as a password

- Anyone with the token can drive your signed-in browser while the extension is connected.
- **VERIFY:** the token may appear in the extension's connect page URL. Tool results (page URLs, tab lists, screenshots) can echo it into the conversation, and conversations are stored by your agent and provider.
- Never paste it into a chat, a config file in a repo, or a bug report.

### Rotate it

Rotate the token if it showed up in a conversation, log, screenshot or commit:

1. Generate a new token in the extension. **VERIFY:** the exact button name; if there is none, remove and reinstall the extension.
2. Replace the value with `setx` (Windows) or in your shell profile (macOS, Linux).
3. Restart the agent.

To stop using the token, delete the line from your profile, or run `reg delete HKCU\Environment /v PLAYWRIGHT_MCP_EXTENSION_TOKEN /f` on Windows.

## Sources

- Extension mode and `--extension`: https://github.com/microsoft/playwright-mcp (checked 2026-11-03)
- Extension, token and approval: https://github.com/microsoft/playwright/tree/main/packages/extension (checked 2026-11-03)
