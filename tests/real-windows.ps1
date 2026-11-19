# Real tool installs on Windows through install.ps1, with OpenCode 1.x from npm. Used by CI.
# The USERPROFILE has a space on purpose: paths must survive the .cmd shim handling.
$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot
$rtkVer = (Get-Content (Join-Path $repo 'core\pins.json') -Raw | ConvertFrom-Json).pins.rtk.version

$dir = Join-Path $env:RUNNER_TEMP "lean agents $([guid]::NewGuid())"
New-Item -ItemType Directory -Path $dir | Out-Null
$env:USERPROFILE = $dir
$env:APPDATA = "$dir\AppData\Roaming"
$env:NPM_CONFIG_PREFIX = "$dir\npm"
New-Item -ItemType Directory -Path $env:NPM_CONFIG_PREFIX | Out-Null
$env:Path = "$dir\npm;$env:Path"

npm install -g opencode-ai@1.19.0
if ($LASTEXITCODE -ne 0) { throw 'npm install opencode-ai failed' }
opencode --version

# winget is not on the runner image, so this also proves the release zip route.
$rtkDir = "$dir\tools\rtk"
Invoke-WebRequest "https://github.com/rtk-ai/rtk/releases/download/$rtkVer/rtk-x86_64-pc-windows-msvc.zip" -OutFile "$dir\rtk.zip"
Expand-Archive "$dir\rtk.zip" $rtkDir
if (-not (Test-Path "$rtkDir\rtk.exe")) { throw 'rtk.exe is not at the top of the release zip' }

function Get-UserPath { [Environment]::GetEnvironmentVariable('Path', 'User') -split ';' }

& "$repo\install.ps1" -Yes -Agents opencode-v1 -Tools playwright, ponytail, caveman, i-have-adhd, dcp -Privacy strict -Profile anthropic-api -Lang en --ponytail-mode lite --adhd-always --install-terminal both
if ((Get-UserPath) -notcontains $rtkDir) { throw 'rtk folder was not added to the user PATH' }
if (-not (Test-Path "$dir\.agents\skills\caveman\SKILL.md")) { throw 'Caveman skills did not arrive' }

Write-Output "Windows install path checks:"
$orcaDir = "$env:LOCALAPPDATA\Programs\Orca"
$warpDir = "$env:LOCALAPPDATA\Programs\Warp"

$deadline = (Get-Date).AddSeconds(90)
while ((Get-Date) -lt $deadline -and ((-not (Test-Path $orcaDir)) -or (-not (Test-Path $warpDir)))) {
  Start-Sleep -Seconds 3
}

if ((-not (Test-Path $orcaDir)) -or (-not (Test-Path $warpDir))) {
  Write-Output "Get-ChildItem `"$env:LOCALAPPDATA\Programs`" -Name:"
  Get-ChildItem "$env:LOCALAPPDATA\Programs" -Name -ErrorAction SilentlyContinue | Write-Output
  Write-Output "Test-Path `"$env:ProgramFiles\Orca`": $(Test-Path "$env:ProgramFiles\Orca")"
  Write-Output "Test-Path `"$env:ProgramFiles\Warp`": $(Test-Path "$env:ProgramFiles\Warp")"
  foreach ($hive in 'HKCU', 'HKLM') {
    Write-Output "Uninstall entries in $hive matching Orca|Warp:"
    Get-ItemProperty -Path "${hive}:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*" -ErrorAction SilentlyContinue |
      Where-Object { $_.DisplayName -match 'Orca|Warp' } |
      ForEach-Object {
        Write-Output "  DisplayName: $($_.DisplayName)"
        Write-Output "  InstallLocation: $($_.InstallLocation)"
        Write-Output "  UninstallString: $($_.UninstallString)"
      }
  }
}

if (-not (Test-Path $orcaDir)) { throw "Orca not installed in $orcaDir" }
if (-not (Test-Path $warpDir)) { throw "Warp not installed in $warpDir" }
Write-Output "Orca uninstaller: $(Test-Path "$orcaDir\Uninstall Orca.exe")"
Write-Output "Warp uninstaller: $(Test-Path "$warpDir\unins000.exe")"
$orcaPath = [Environment]::GetEnvironmentVariable('Path', 'User')
Write-Output "HKCU Path after Orca install: $orcaPath"
if ((opencode debug skill | Out-String) -notmatch 'caveman') { throw 'OpenCode does not see the Caveman skills' }
if (-not (Test-Path "$dir\.config\opencode\vendor\i-have-adhd\.opencode")) { throw 'i-have-adhd clone is missing' }
# rtk ignores USERPROFILE and uses the OS profile folder, here the disposable runner's.
$rtkPlugin = "$([Environment]::GetFolderPath('UserProfile'))\.config\opencode\plugins\rtk.ts"
if (-not (Test-Path $rtkPlugin)) { throw 'RTK plugin is missing' }

& "$repo\install.ps1" -Doctor

opencode agent list | Tee-Object -Variable agents
foreach ($name in 'explore', 'research', 'review', 'debug', 'planner') {
  if (($agents -join "`n") -notmatch $name) { throw "subagent $name not loaded" }
}

& "$repo\install.ps1" -Uninstall -Yes
if ((Get-UserPath) -contains $rtkDir) { throw 'rtk folder was not removed from the user PATH' }
if (Test-Path $rtkPlugin) { throw 'RTK plugin was not removed' }
if (Test-Path "$dir\.config\opencode\vendor\i-have-adhd") { throw 'i-have-adhd clone was not removed' }
if (Test-Path "$dir\.agents\skills\caveman") { throw 'Caveman skills were not removed' }
if (Test-Path $orcaDir) { throw 'Orca was not removed' }
if (Test-Path $warpDir) { throw 'Warp was not removed' }
