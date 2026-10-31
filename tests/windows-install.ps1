# Checks install.ps1 in throwaway USERPROFILE folders, with no external commands (--no-exec).
# Used by CI on PowerShell 5.1 and 7.
$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot

function New-TempProfile {
  $dir = Join-Path $env:RUNNER_TEMP ([guid]::NewGuid().ToString())
  New-Item -ItemType Directory -Path $dir | Out-Null
  $env:USERPROFILE = $dir
  $env:APPDATA = "$dir\AppData\Roaming"
  $dir
}

Write-Output '--- dry run from a file changes nothing'
$dir = New-TempProfile
& "$repo\install.ps1" -DryRun -Yes -Agents claude, opencode-v1 -AllTools -Privacy strict -Profile vertex-gemini -Lang en --no-exec
if (Get-ChildItem -Force $dir) { throw 'dry run wrote to USERPROFILE' }

Write-Output '--- dry run piped into a scriptblock clones the source and nothing else'
$dir = New-TempProfile
& ([scriptblock]::Create((Get-Content "$repo\install.ps1" -Raw))) -DryRun -Yes -Agents claude -NoTools -Privacy standard -Lang en --no-exec
$found = @(Get-ChildItem -Force "$dir\.config\lean-agents").Name
if (($found -join ',') -ne 'src') { throw "piped dry run wrote: $found" }
if (@(Get-ChildItem -Force $dir).Count -ne 1) { throw 'piped dry run wrote outside .config' }

Write-Output '--- install, doctor and uninstall'
$dir = New-TempProfile
& "$repo\install.ps1" -Yes -Agents claude, opencode-v1 -AllTools -Privacy strict -Profile anthropic-api -Lang en --no-exec
& "$repo\install.ps1" -Doctor --no-exec
& "$repo\install.ps1" -Uninstall -Yes --no-exec
$left = @(Get-ChildItem -Recurse -File -Force $dir | Where-Object { $_.FullName -notlike '*\.config\lean-agents\*' })
if ($left) { throw "uninstall left files: $($left.FullName)" }
