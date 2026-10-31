# Real Copilot CLI and real tools on Windows through install.ps1, throwaway USERPROFILE. Used by CI.
$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot

$dir = Join-Path $env:RUNNER_TEMP "lean agents $([guid]::NewGuid())"
New-Item -ItemType Directory -Path $dir | Out-Null
$env:USERPROFILE = $dir
$env:APPDATA = "$dir\AppData\Roaming"
$env:NPM_CONFIG_PREFIX = "$dir\npm"
New-Item -ItemType Directory -Path $env:NPM_CONFIG_PREFIX | Out-Null
$env:Path = "$dir\npm;$env:Path"

npm install -g @github/copilot
if ($LASTEXITCODE -ne 0) { throw 'npm install @github/copilot failed' }
copilot --version

# winget is not on the runner image; install.ps1 falls back to the release zip.
Invoke-WebRequest 'https://github.com/rtk-ai/rtk/releases/latest/download/rtk-x86_64-pc-windows-msvc.zip' -OutFile "$dir\rtk.zip"
Expand-Archive "$dir\rtk.zip" "$dir\tools\rtk"

$copilot = "$dir\.copilot"
& "$repo\install.ps1" -Yes -Agents copilot-cli -Tools playwright, caveman, i-have-adhd -Privacy strict -Lang en --ponytail-mode off
if (-not (Select-String -Path "$copilot\copilot-instructions.md" -Pattern 'lean-agents:start' -Quiet)) { throw 'rules block is missing' }
if (-not (Test-Path "$copilot\agents\planner.agent.md")) { throw 'subagents are missing' }
if (-not (Select-String -Path "$dir\.agents\skills\i-have-adhd\SKILL.md" -Pattern 'disable-model-invocation: false' -Quiet)) { throw 'i-have-adhd flag was not set' }
# rtk ignores USERPROFILE and uses the OS profile folder, here the disposable runner's.
$rtkHook = "$([Environment]::GetFolderPath('UserProfile'))\.copilot\hooks\rtk-rewrite.json"
if (-not (Test-Path $rtkHook)) { throw 'RTK hook is missing' }

if ((copilot mcp list --json | Out-String) -notmatch '"playwright"') { throw 'Copilot does not see Playwright' }
if ((copilot instruction list | Out-String) -notmatch 'copilot-instructions.md') { throw 'Copilot does not see the rules' }
$skills = copilot skill list | Out-String
if ($skills -notmatch 'caveman' -or $skills -notmatch 'i-have-adhd') { throw 'Copilot does not see the skills' }
if ((copilot plugin list | Out-String) -notmatch 'context-mode') { throw 'Copilot does not see Context Mode' }

& "$repo\install.ps1" -Doctor

& "$repo\install.ps1" -Uninstall -Yes
if (Test-Path "$copilot\agents\planner.agent.md") { throw 'subagents were not removed' }
if (Test-Path $rtkHook) { throw 'RTK hook was not removed' }
if (Test-Path "$dir\.agents\skills\caveman") { throw 'Caveman skills were not removed' }
if ((copilot plugin list | Out-String) -match 'context-mode') { throw 'Context Mode was not removed' }
