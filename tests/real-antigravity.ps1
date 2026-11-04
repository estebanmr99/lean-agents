# Real Antigravity CLI and real tools on Windows through install.ps1, throwaway USERPROFILE. Used by CI.
$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot

$dir = Join-Path $(if ($env:RUNNER_TEMP) { $env:RUNNER_TEMP } else { [IO.Path]::GetTempPath() }) "lean agents $([guid]::NewGuid())"
New-Item -ItemType Directory -Path $dir | Out-Null

# The vendor installer writes to %LOCALAPPDATA%\agy\bin (the disposable runner's), before USERPROFILE moves.
Invoke-RestMethod https://antigravity.google/cli/install.ps1 | Invoke-Expression
$env:Path = "$env:LOCALAPPDATA\agy\bin;$env:Path"
if (-not (Test-Path "$env:LOCALAPPDATA\agy\bin\agy.exe")) { throw 'agy.exe was not installed' }
$agy = (Get-Command agy).Source

$env:USERPROFILE = $dir
$env:APPDATA = "$dir\AppData\Roaming"
$env:NPM_CONFIG_PREFIX = "$dir\npm"
New-Item -ItemType Directory -Path $env:NPM_CONFIG_PREFIX | Out-Null
$env:Path = "$dir\npm;$env:Path"
& $agy --version
if ($LASTEXITCODE -ne 0) { throw 'agy --version failed' }

# winget is not on the runner image; install.ps1 falls back to the release zip.
Invoke-WebRequest 'https://github.com/rtk-ai/rtk/releases/latest/download/rtk-x86_64-pc-windows-msvc.zip' -OutFile "$dir\rtk.zip"
Expand-Archive "$dir\rtk.zip" "$dir\tools\rtk"

$cfg = "$dir\.gemini\config"
& "$repo\install.ps1" -Yes -NoApp -Agents antigravity -Tools playwright, caveman, i-have-adhd -Privacy strict -Lang en --ponytail-mode off
if (-not (Test-Path "$cfg\rules\lean-agents.md")) { throw 'rules file is missing' }
if (-not (Select-String -Path "$cfg\agents\planner.md" -Pattern '^model: pro$' -Quiet)) { throw 'subagents are missing' }
if (-not (Test-Path "$dir\.agents\skills\caveman\SKILL.md")) { throw 'Caveman skills are missing' }
if (-not (Select-String -Path "$dir\.agents\skills\i-have-adhd\SKILL.md" -Pattern 'disable-model-invocation: false' -Quiet)) { throw 'i-have-adhd flag was not set' }
# rtk ignores USERPROFILE and uses the OS profile folder, here the disposable runner's.
$rtkPlugin = "$([Environment]::GetFolderPath('UserProfile'))\.gemini\config\plugins\rtk"
if (-not (Test-Path "$rtkPlugin\plugin.json")) { throw 'RTK plugin is missing' }

$agents = & $agy agents | Out-String
if ($LASTEXITCODE -ne 0) { throw 'agy agents failed' }
foreach ($n in 'explore', 'research', 'review', 'debug', 'planner') { if ($agents -notmatch $n) { throw "agy does not list $n" } }
$mcp = & $agy mcp list | Out-String
if ($LASTEXITCODE -ne 0) { throw 'agy mcp list failed' }
if ($mcp -notmatch 'playwright') { throw 'agy does not see Playwright' }
# agy reads the temp USERPROFILE: copy what rtk wrote so agy and --doctor can load it (test-only).
Copy-Item $rtkPlugin "$cfg\plugins\rtk" -Recurse
if ((& $agy plugin list --json | Out-String) -notmatch '"rtk"') { throw 'agy does not see RTK' }

& "$repo\install.ps1" -Doctor

& "$repo\install.ps1" -Uninstall -Yes
if (Test-Path "$cfg\agents\planner.md") { throw 'subagents were not removed' }
if (Test-Path "$cfg\rules\lean-agents.md") { throw 'rules were not removed' }
if (Test-Path "$dir\.agents\skills\caveman") { throw 'Caveman skills were not removed' }
if (Test-Path $rtkPlugin) { throw 'RTK plugin was not removed' }
Remove-Item "$cfg\plugins\rtk" -Recurse -Force -ErrorAction SilentlyContinue
