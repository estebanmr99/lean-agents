# VS Code agent mode: logged-in proof checklist

Run this **once**, on a real work PC with VS Code, the GitHub Copilot extension signed in, and your company proxy. CI cannot do it (no Copilot login). It turns the **VERIFY** rows about [installing with an agent](install-with-an-agent.md#vs-code-copilot-chat-agent-mode-corporate-windows-pc) into verified facts. About 30 minutes.

Rules for what you write down: no company name, user name, home path, proxy host or CA file name. Write "company proxy", "D:\tools", "policy blocks X". Results go in a comment on issue #180; the owner then edits [compatibility.md](compatibility.md).

## Before you start

Record these once (they go in every row you move):

- Date (YYYY-MM-DD).
- VS Code version: **Help > About**.
- Copilot extension version: Extensions view, GitHub Copilot Chat.
- Copilot plan type if you know it (Business, Enterprise) and any policy note you can see (Settings, search "chat.agent", "chat.tools").
- Windows version.

## Steps

Each step ends with a **Record** line and the row it moves. Rows are in the section "Install with VS Code Copilot chat (#180, 2026-11-18)" of `compatibility.md` unless another place is named.

1. **Paste the install prompt.** Open Copilot chat, switch the mode to **Agent**, paste the prompt from [Prompt to paste](install-with-an-agent.md#prompt-to-paste). Set the proxy variables first in the VS Code terminal ([guide step 1](install-with-an-agent.md#vs-code-copilot-chat-agent-mode-corporate-windows-pc)).
   - Record: did the agent open the guide and follow it? Which chat model was selected?
   - Moves: nothing yet. This is the setup for the rows below.
2. **Terminal tool.** Watch the first command (`npx -y lean-agents@latest --doctor --json`).
   - Record: did the agent run it, ask for approval, or say it has no terminal tool? Did the command run in PowerShell? Did it finish behind the proxy?
   - Moves: **VERIFY: agent-mode terminal tool and auto-approve behavior on Windows**. Write "terminal tool: available / needs approval / blocked" and the shell name.
3. **Answer each question.** The agent should ask one question per choice: agents (include `vscode-copilot`), tools, migrate, network, terminal, GitHub CLI. Then it shows the `--yes --dry-run --json` plan and waits for your OK.
   - Record: which questions were skipped or merged; whether it waited for your yes before installing.
   - Moves: the guide's "Flow" claim. If it holds, note "flow followed"; if not, open an issue with what it did instead.
4. **If the terminal tool is blocked.** Skip this step when step 2 worked. If your policy blocks it (or you can turn it off to test), the agent must print each command for you to run, not try workarounds ([guide step 3](install-with-an-agent.md#vs-code-copilot-chat-agent-mode-corporate-windows-pc)). Run them in your own PowerShell and paste the output back.
   - Record: did it print the commands and stop, or try another route (another tool, a different shell)?
   - Moves: **Terminal blocked by policy** (today "Not a verified VS Code behavior") and **VERIFY: which agent-mode tools enterprise policy leaves available**. List tools you see in the chat **Tools** picker (names only) and which are disabled by policy.
5. **Install.** Say yes. The agent runs the install and then `--doctor --json`.
   - Record: `ok` true or false, and every row that is not `ok` (statuses only, no paths).
   - Moves: nothing by itself; the next steps use what it wrote.
6. **Verify by hand.** In your own PowerShell run `npx -y lean-agents@latest --doctor`. Open `%APPDATA%\Code\User` in Explorer.
   - Record: is `mcp.json` in `%APPDATA%\Code\User`, next to `settings.json`? Do the lean-agents servers show up in the chat **Tools** picker?
   - Moves: **VERIFY: the VS Code user `mcp.json` path on Windows (`%APPDATA%\Code\User`)** (the "VERIFY" list in `compatibility.md`, next to the `real-vscode` note).
7. **Check what VS Code loads.** Reload the window. In agent mode ask: "Which rules and agents do you have loaded, and from which files?" Then run **Chat: New Prompt File** once and note the folder it opens (path shape only, for example `...\Code\User\prompts`).
   - Record: are the lean-agents rules (the block in `~/.copilot/copilot-instructions.md`) and agents visible to VS Code? Which folder did the prompt file land in?
   - Moves: **VERIFY: whether VS Code, not only Copilot CLI, loads `~/.copilot` rules and agents**, and **VERIFY (PR3): the `*.prompt.md` user folder** (Windows value). Also the `model` format row if an agent shows a model error.
8. **Undo.** In your own PowerShell run `npx -y lean-agents@latest --uninstall`, then `npx -y lean-agents@latest --doctor`.
   - Record: does `--doctor` show `lean-agents` as `missing`? Did the Tools picker drop the servers after a window reload? Were your own settings and `mcp.json` entries kept?
   - Moves: the "every change is undone by `--uninstall`" claim for `vscode-copilot` on Windows.
9. **Minimum version.** Add the VS Code version from "Before you start" to the VERIFY row "minimum VS Code version". One data point is a floor you saw working, not the true minimum.

## Results template

Paste this in a comment on #180. Fill every line; write `not tested` where you skipped.

```text
date:
VS Code version:
Copilot extension version:
Windows version:
policy notes (generic, no company names):
1 prompt followed the guide:
2 terminal tool (available / needs approval / blocked), shell:
3 questions asked (list) and waited for yes:
4 blocked fallback (printed commands / tried workarounds / not tested):
5 doctor after install (ok, non-ok row statuses):
6 mcp.json at %APPDATA%\Code\User (yes/no), servers in Tools picker:
7 ~/.copilot rules and agents loaded by VS Code (yes/no), prompt folder shape:
8 uninstall clean (yes/no), user entries kept (yes/no):
9 tool names enabled / disabled by policy:
```

## After the run (owner)

For each row above, replace **VERIFY** with the result, the date and both versions, as in other verified rows of `compatibility.md`. A row that failed stays **VERIFY** with the failure written next to it. Then update the README VS Code Windows cell and mark the open items in issue #180.
