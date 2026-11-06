# Real Cursor CLI on Windows through install.ps1, throwaway USERPROFILE, plus Git Bash (#23). Used by CI.
$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot

$dir = Join-Path $(if ($env:RUNNER_TEMP) { $env:RUNNER_TEMP } else { [IO.Path]::GetTempPath() }) "lean agents $([guid]::NewGuid())"
New-Item -ItemType Directory -Path $dir | Out-Null

# The vendor installer writes to %LOCALAPPDATA%\cursor-agent (the disposable runner's), before USERPROFILE moves.
& ([scriptblock]::Create((Invoke-RestMethod 'https://cursor.com/install?win32=true')))
$agentDir = "$env:LOCALAPPDATA\cursor-agent"
if (-not (Test-Path "$agentDir\agent.cmd")) { throw 'agent.cmd was not installed' }
$env:Path = "$agentDir;$env:Path"

$env:USERPROFILE = $dir
$env:HOME = $dir
$env:APPDATA = "$dir\AppData\Roaming"
$env:NPM_CONFIG_PREFIX = "$dir\npm"
New-Item -ItemType Directory -Path $env:NPM_CONFIG_PREFIX | Out-Null
$env:Path = "$dir\npm;$env:Path"
& "$agentDir\agent.cmd" --version
if ($LASTEXITCODE -ne 0) { throw 'agent.cmd --version failed' }

# winget is not on the runner image; install.ps1 falls back to the release zip.
Invoke-WebRequest 'https://github.com/rtk-ai/rtk/releases/latest/download/rtk-x86_64-pc-windows-msvc.zip' -OutFile "$dir\rtk.zip"
Expand-Archive "$dir\rtk.zip" "$dir\tools\rtk"

$bash = "$env:ProgramFiles\Git\bin\bash.exe"
if (-not (Test-Path $bash)) { throw 'Git Bash is not on the runner' }
try {
  & "$repo\install.ps1" -Yes -Agents cursor -Tools playwright, caveman -Privacy strict -Lang en --ponytail-mode off
  if (-not (Select-String -Path "$dir\.cursor\agents\explore.md" -Pattern '^readonly: true$' -Quiet)) { throw 'subagents are missing' }
  if (-not (Test-Path "$dir\.agents\skills\caveman\SKILL.md")) { throw 'Caveman skills are missing' }
  if (-not (Select-String -Path "$dir\.cursor\mcp.json" -Pattern 'playwright' -Quiet)) { throw 'Playwright MCP entry is missing' }

  # Git Bash: the marked ~/.bashrc block makes `agent` reach agent.cmd with MSYSTEM and SHELL empty.
  if (-not (Select-String -Path "$dir\.bashrc" -Pattern "alias agent='MSYSTEM= SHELL= agent.cmd'" -SimpleMatch -Quiet)) { throw 'the .bashrc alias block is missing' }
  & $bash -c 'agent --version' 2>&1 | Out-Null
  if ($LASTEXITCODE -eq 0) { throw 'a bare agent should not resolve in Git Bash without the alias (#23)' }
  & $bash -ic 'agent --version' 2>&1 | Out-String | Write-Output
  if ($LASTEXITCODE -ne 0) { throw 'agent through the .bashrc alias failed in Git Bash' }

  $mcp = & "$agentDir\agent.cmd" mcp list | Out-String
  if ($LASTEXITCODE -ne 0) { throw 'agent mcp list failed' }
  if ($mcp -notmatch 'playwright') { throw 'Cursor does not see Playwright' }

  & "$repo\install.ps1" -Doctor
} finally {
  & "$repo\install.ps1" -Uninstall -Yes
}
if (Test-Path "$dir\.cursor\agents\explore.md") { throw 'subagents were not removed' }
if (Test-Path "$dir\.agents\skills\caveman") { throw 'Caveman skills were not removed' }
if (Test-Path "$dir\.bashrc") { throw 'the .bashrc block was not removed' }
