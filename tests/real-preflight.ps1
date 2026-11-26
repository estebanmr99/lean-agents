# --preflight (#471), Windows: an old rtk (a stub that prints 0.42.0) sits earlier on PATH than the real pinned rtk. One report must name both
# copies, say the old one wins, give the fix line and exit 1. A throwaway HOME; --preflight writes nothing. Needs the real `rtk` on PATH. PowerShell 5.1 compatible.
$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot
$realRtk = (Get-Command rtk -CommandType Application | Select-Object -First 1).Source
$realDir = Split-Path $realRtk
$oldDir = Join-Path $env:RUNNER_TEMP "old-rtk-$([guid]::NewGuid())"
New-Item -ItemType Directory -Path $oldDir -Force | Out-Null
Set-Content -Path "$oldDir\rtk.cmd" -Value "@echo off`r`necho rtk 0.42.0" -Encoding ASCII
$caseHome = Join-Path $env:RUNNER_TEMP "preflight-home-$([guid]::NewGuid())"
New-Item -ItemType Directory -Path $caseHome -Force | Out-Null

$env:PATH = "$oldDir;$env:PATH"
$out = (& node "$repo\scripts\lean.mjs" --preflight --home $caseHome 2>&1 | Out-String)
$exit = $LASTEXITCODE
Write-Output $out
if ($exit -ne 1) { throw "expected exit 1 (a blocker), got $exit" }
foreach ($needle in @($oldDir, $realDir, 'wins', 'fix:', '0.42.0')) {
  if (-not $out.Contains($needle)) { throw "the report lacks: $needle" }
}
if (@(Get-ChildItem $caseHome -Recurse -Force).Count -ne 0) { throw '--preflight wrote into HOME' }
Write-Output 'ok    --preflight named the old rtk, the newer one and the fix; HOME untouched'
