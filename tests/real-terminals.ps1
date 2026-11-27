# Orca user-env writes on Windows with the real engine, throwaway USERPROFILE: telemetry env and loopback NO_PROXY
# go to the runner's real user env, so every touched variable is restored in `finally`. `npx` is stubbed
# (no network); the point is the env write and its undo. The optional Orca app is installed from one older
# release, then --update must adopt it, move it to the pin, and --uninstall must leave it alone. Used by CI.
$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot

$dir = Join-Path $(if ($env:RUNNER_TEMP) { $env:RUNNER_TEMP } else { [IO.Path]::GetTempPath() }) "lean agents $([guid]::NewGuid())"
New-Item -ItemType Directory -Path "$dir\stub" | Out-Null
Set-Content "$dir\stub\npx.cmd" '@exit /b 0' -Encoding ascii

$names = 'NO_PROXY', 'DO_NOT_TRACK', 'ORCA_TELEMETRY_DISABLED'
function Get-UserEnv($n) { [Environment]::GetEnvironmentVariable($n, 'User') }
function Write-UserEnv($n, $v) { [Environment]::SetEnvironmentVariable($n, $v, 'User') }
function Assert-Eq($what, $got, $want) { if ($got -ne $want) { throw "$what`: expected '$want', got '$got'" } }
$saved = @{}
foreach ($n in $names) { $saved[$n] = Get-UserEnv $n }
$machineNoProxy = [Environment]::GetEnvironmentVariable('NO_PROXY', 'Machine')
$saveProfile = $env:USERPROFILE
$saveLocalAppData = $env:LOCALAPPDATA

function Get-OrcaVersion {
  $keys = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
    'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
    'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*'
  (Get-ItemProperty $keys -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -eq 'Orca' } | Select-Object -First 1).DisplayVersion
}

function Invoke-Lean($rest) {
  node "$repo\scripts\lean.mjs" @rest
  if ($LASTEXITCODE -ne 0) { throw "lean.mjs $($rest -join ' ') failed" }
}
$install = '--yes', '--agents', 'cursor', '--no-tools', '--terminal', 'orca', '--network', 'off', '--lang', 'en'

try {
  $env:USERPROFILE = $dir
  $env:HOME = $dir
  $env:APPDATA = "$dir\AppData\Roaming"
  $env:Path = "$dir\stub;$env:Path"
  # Only the engine's process sees the proxy; the stubbed npx never touches the network.
  $env:HTTPS_PROXY = 'http://proxy.invalid:8080'

  # 1. You already have a NO_PROXY and your own ORCA_TELEMETRY_DISABLED: both are kept.
  Write-UserEnv 'NO_PROXY' 'corp.invalid,localhost'
  Write-UserEnv 'DO_NOT_TRACK' $null
  Write-UserEnv 'ORCA_TELEMETRY_DISABLED' '0'
  Invoke-Lean $install
  Assert-Eq 'NO_PROXY after install' (Get-UserEnv 'NO_PROXY') 'corp.invalid,localhost,127.0.0.1,::1'
  Assert-Eq 'DO_NOT_TRACK after install' (Get-UserEnv 'DO_NOT_TRACK') '1'
  Assert-Eq 'ORCA_TELEMETRY_DISABLED after install' (Get-UserEnv 'ORCA_TELEMETRY_DISABLED') '0'

  # Git Bash gets the same loopback entries from its own block, without losing the ones it inherits.
  $bash = "$env:ProgramFiles\Git\bin\bash.exe"
  if (-not (Test-Path $bash)) { throw 'Git Bash is not on the runner' }
  $env:NO_PROXY = 'corp.invalid,localhost'
  $np = (& $bash -ic 'echo "NP=$NO_PROXY"' 2>$null | Select-String '^NP=').Line
  Assert-Eq 'NO_PROXY in Git Bash' $np 'NP=corp.invalid,localhost,127.0.0.1,::1'
  Remove-Item Env:NO_PROXY

  Invoke-Lean '--uninstall', '--yes'
  Assert-Eq 'NO_PROXY after uninstall' (Get-UserEnv 'NO_PROXY') 'corp.invalid,localhost'
  Assert-Eq 'DO_NOT_TRACK after uninstall' (Get-UserEnv 'DO_NOT_TRACK') $null
  Assert-Eq 'ORCA_TELEMETRY_DISABLED after uninstall' (Get-UserEnv 'ORCA_TELEMETRY_DISABLED') '0'
  if (Test-Path "$dir\.bashrc") { throw 'the .bashrc block was not removed' }

  # 2. No NO_PROXY of your own: the variable is created, then removed again.
  if (-not $machineNoProxy) {
    Write-UserEnv 'NO_PROXY' $null
    Write-UserEnv 'ORCA_TELEMETRY_DISABLED' $null
    Invoke-Lean $install
    Assert-Eq 'created NO_PROXY' (Get-UserEnv 'NO_PROXY') 'localhost,127.0.0.1,::1'
    Assert-Eq 'created ORCA_TELEMETRY_DISABLED' (Get-UserEnv 'ORCA_TELEMETRY_DISABLED') '1'
    Invoke-Lean '--uninstall', '--yes'
    Assert-Eq 'NO_PROXY removed' (Get-UserEnv 'NO_PROXY') $null
    Assert-Eq 'ORCA_TELEMETRY_DISABLED removed' (Get-UserEnv 'ORCA_TELEMETRY_DISABLED') $null
  }

  # 3. Optional Orca app: an older release is adopted by --update and moved to the pin; --uninstall leaves it alone.
  # The env test above set HTTPS_PROXY to an unroutable host: drop it so the release download can reach GitHub.
  Remove-Item Env:HTTPS_PROXY -ErrorAction SilentlyContinue
  $appdir = Join-Path $dir 'app'
  New-Item -ItemType Directory -Path "$appdir\AppData\Local" -Force | Out-Null
  $env:USERPROFILE = $appdir
  $env:HOME = $appdir
  $env:APPDATA = "$appdir\AppData\Roaming"
  $env:LOCALAPPDATA = "$appdir\AppData\Local"
  $orcaPin = (Get-Content "$repo\core\pins.json" -Raw | ConvertFrom-Json).pins.'orca-app'.version
  # One release behind the pin: enough for --update to move it.
  $oldOrca = '1.4.257'
  $oldExe = "$dir\orca-old.exe"
  Invoke-WebRequest -Uri "https://github.com/stablyai/orca/releases/download/v$oldOrca/orca-windows-setup.exe" -OutFile $oldExe -UseBasicParsing
  Start-Process -FilePath $oldExe -ArgumentList '/currentuser', '/S' -Wait
  for ($i = 0; $i -lt 30 -and -not (Get-OrcaVersion); $i++) { Start-Sleep 2 }
  Assert-Eq 'seeded Orca version' (Get-OrcaVersion) $oldOrca

  Invoke-Lean '--yes', '--agents', 'cursor', '--no-tools', '--terminal', 'orca', '--privacy', 'standard', '--lang', 'en'
  Invoke-Lean '--update', '--install-terminal', 'orca', '--yes'
  Assert-Eq 'Orca after --update' (Get-OrcaVersion) $orcaPin
  Invoke-Lean '--uninstall', '--yes'
  Assert-Eq 'adopted Orca kept by --uninstall' (Get-OrcaVersion) $orcaPin

  $uninstallOrca = "$env:LOCALAPPDATA\Programs\Orca\Uninstall Orca.exe"
  if (Test-Path $uninstallOrca) {
    Start-Process -FilePath $uninstallOrca -ArgumentList '/S' -Wait
    for ($i = 0; $i -lt 60 -and (Test-Path $uninstallOrca); $i++) { Start-Sleep 2 }
  }
} finally {
  foreach ($n in $names) { Write-UserEnv $n $saved[$n] }
  $env:USERPROFILE = $saveProfile
  $env:LOCALAPPDATA = $saveLocalAppData
}
