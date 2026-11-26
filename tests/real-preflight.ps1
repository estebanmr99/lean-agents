# --preflight (#471), Windows: an old rtk (a stub that prints 0.42.0, in a folder whose name has a space) sits earlier on PATH than the real pinned
# rtk. The --json report must hold a `shadowed` and a `below-min` finding for rtk that name both copies, and exit 1. A second stub in a folder with `&`
# in its name must be skipped, not run (#475): it would create a marker file. A throwaway HOME; --preflight writes nothing.
# Needs the real `rtk` on PATH. PowerShell 5.1 compatible.
$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot
$realRtk = (Get-Command rtk -CommandType Application | Select-Object -First 1).Source
$realDir = Split-Path $realRtk
$stamp = [guid]::NewGuid()
$oldDir = Join-Path $env:RUNNER_TEMP "old rtk $stamp"
$ampDir = Join-Path $env:RUNNER_TEMP "amp&dir $stamp"
$marker = Join-Path $env:RUNNER_TEMP "ran-$stamp.txt"
New-Item -ItemType Directory -Path $oldDir, $ampDir -Force | Out-Null
Set-Content -Path "$oldDir\rtk.cmd" -Value "@echo off`r`necho rtk 0.42.0" -Encoding ASCII
Set-Content -Path "$ampDir\jq.cmd" -Value "@echo off`r`necho ran> `"$marker`"`r`necho jq 9.9.9" -Encoding ASCII
$caseHome = Join-Path $env:RUNNER_TEMP "preflight-home-$stamp"
New-Item -ItemType Directory -Path $caseHome -Force | Out-Null

$env:PATH = "$ampDir;$oldDir;$env:PATH"
$text = (& node "$repo\scripts\lean.mjs" --preflight --json --home $caseHome 2>$null | Out-String)
$exit = $LASTEXITCODE
Write-Output $text
if ($exit -ne 1) { throw "expected exit 1 (a blocker), got $exit" }
$report = $text | ConvertFrom-Json
$shadowed = @($report.findings | Where-Object { $_.tool -eq 'rtk' -and $_.kind -eq 'shadowed' })
$below = @($report.findings | Where-Object { $_.tool -eq 'rtk' -and $_.kind -eq 'below-min' })
if ($shadowed.Count -ne 1 -or $below.Count -ne 1) { throw 'expected one shadowed and one below-min finding for rtk' }
if ($shadowed[0].copies[0].path -ne "$oldDir\rtk.CMD" -and $shadowed[0].copies[0].path -ne "$oldDir\rtk.cmd") { throw "the winning copy is not the old one: $($shadowed[0].copies[0].path)" }
if ($shadowed[0].copies[0].version -ne '0.42.0') { throw 'the old copy was not probed (a path with a space)' }
if (-not (@($shadowed[0].copies | ForEach-Object { $_.path }) -like "$realDir\*")) { throw 'the real rtk copy is not listed' }
if (-not $shadowed[0].blocker -or $below[0].fix -notmatch 'winget upgrade') { throw 'the shadowed finding is no blocker or the fix line is missing' }
if (Test-Path $marker) { throw 'the stub in the folder with & was executed' }
if (@(Get-ChildItem $caseHome -Recurse -Force).Count -ne 0) { throw '--preflight wrote into HOME' }
Write-Output 'ok    --preflight named the old rtk, the newer one and the fix; the & stub was skipped; HOME untouched'
exit 0
