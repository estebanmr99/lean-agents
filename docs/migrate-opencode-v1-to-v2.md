# Migrate from OpenCode 1.x to 2.x

Moving to OpenCode 2 changes the session database in place: the first 2.x start rewrites `opencode.db`. lean-agents therefore backs up your 1.x sessions first and keeps 1.x runnable next to 2.x. Nothing is deleted, and one command goes back.

The easiest way: install the opt-in skill (`--tools lean-migrate`) and ask your agent to move you to OpenCode 2. It follows the steps below and asks before each change. Details of what was proven in CI: [compatibility.md](compatibility.md#opencode-1x--2x-side-by-side).

## Steps

Close every OpenCode window first (and the 2.x background service, if one exists). The engine refuses to run while OpenCode runs. Use `npx lean-agents` or `install.sh`; every command accepts `--dry-run`.

1. `lean-agents --upgrade-agent opencode --backup` shows the plan; add `--yes` to copy.
2. `lean-agents --upgrade-agent opencode --dry-run --json` shows what happens to your config (see "What is kept").
3. `lean-agents --upgrade-agent opencode --yes` applies it.
4. `lean-agents --doctor` checks the result.
5. Port the manual items by hand (table below).

On a machine you set up by hand, run `lean-agents --adopt` first (read-only) so you see what lean-agents already manages.

## What happens when you apply

Five journaled steps, recorded in `state.json`:

1. `backup`: verify the permanent backup (every file's sha256 against its manifest; the live data must equal the backup or the frozen copy).
2. `opencode1`: copy the 1.x binary out and add the `opencode1` command. It runs 1.x on the frozen copy of the data only, so it never touches the 2.x database.
3. `install2x`: install OpenCode 2 with the pinned installer (or keep a 2.x already there).
4. `config`: translate the 1.x config and reinstall what lean-agents manages.
5. `dcp`: add the DCP plugin for 2.x.

Apply never starts OpenCode 2. A failed step undoes the finished ones in reverse. If a rollback step itself fails, it stops, keeps the journal and prints the path to `RESTORE.md` (copy-back commands per OS).

## Disk needs

The backup needs free space of 2 x the size of your OpenCode data + 1 GB (the data is copied twice: the permanent backup and the frozen copy), plus the database once more for the check on a temp copy. Sessions of a heavy user can reach several GB; the plan prints the numbers before copying and `--yes` refuses when there is not enough room. Undo needs the size of the frozen copy + the database + 1 GB free.

## What is kept

- **Backup:** `<data>/lean-agents/backups/opencode1-sessions-<timestamp>/` (`<data>` is `$XDG_DATA_HOME`, else `~/.local/share`, also on Windows): `opencode.db`, `-wal`, `-shm`, `storage/`, `snapshot/`, a snapshot of the 1.x config and `RESTORE.md`. lean-agents never deletes it, not even on `--uninstall` or `--undo`.
- **Frozen copy:** `<data>/lean-agents/opencode1/data/`, made from the backup. Only `opencode1` writes there, so you can go back to old sessions for changes.
- **1.x config files** are not edited by hand and not removed; the translated 2.x keys sit next to them (each binary ignores the other's keys).
- The 1.x binary copy lives beside the frozen copy.

## Undo

`lean-agents --upgrade-agent opencode --undo` shows the plan (OpenCode closed); add `--yes` to run it. It removes the `opencode1` shim and PATH entry, puts the 1.x binary and config back, moves the 2.x-migrated database, storage and snapshot aside to `backups/opencode2-db-<timestamp>/` and copies the frozen copy back (checked by sha256 and session count first; the permanent backup is used when the frozen copy has fewer sessions). End state: `opencode --version` shows 1.x with your sessions. Config files you changed after the apply and that differ from the snapshot are reported, never overwritten. `--uninstall` also removes `opencode1`.

## Windows notes

CI proves the full apply on Linux only; on Windows and macOS it is **VERIFY** (compatibility.md, "Upgrade apply and `--undo`"). The backup, `opencode1` and the PATH edit have Windows tests.

- `opencode1.cmd` is added next to the PowerShell shim; the user PATH is edited in `HKCU` (no admin rights) and restored on undo.
- The 2.x installer writes the same path 1.x used (`%USERPROFILE%\.opencode\bin`). That is why the 1.x binary is copied out first; undo puts it back.
- Antivirus can lock a file just written. Renames of files lean-agents just wrote are retried; a copy of several GB takes minutes, so let it finish.
- Git Bash is set as OpenCode's shell only when you did not choose one (`--shell default` opts out).

## Behind a proxy

The pinned 2.x installer downloads through your proxy variables: `HTTPS_PROXY`, `HTTP_PROXY`, `NO_PROXY`. For a corporate CA set `NODE_EXTRA_CA_CERTS=<file>`; lean-agents reports CA variables but never copies them. Set them in the shell that runs lean-agents. More in [compatibility.md](compatibility.md#proxy-and-corporate-ca).

## Port by hand

Do this in the 2.x files only (`~/.config/opencode/opencode.jsonc`, `cli.json`). The full mapping with sources, and what is still unverified, is in [compatibility.md](compatibility.md#opencode-1x-to-2x-where-things-live).

| OpenCode 1.x | OpenCode 2.x |
| --- | --- |
| `agent` | `agents` |
| `plugin` | `plugins` |
| `autoupdate: false` | `update: "disable"` |
| flat `mcp.<name>` | `mcp.servers.<name>` |
| `disabled_providers` | `policies` |
| `compaction.reserved` | `compaction.buffer` |
| `tui.json` | `cli.json` (**VERIFY**) |

- **DCP:** the apply step adds it for 2.x.
- **Context Mode:** keep it as MCP under `mcp.servers.context-mode`, not as a plugin. Never keep both.
- **Check:** `opencode debug config` must show your keys.
