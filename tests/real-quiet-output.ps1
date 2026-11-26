# Quiet step output (#491), Windows PowerShell 5.1: an install in a throwaway HOME whose planned commands (stub claude and npx) write to stderr.
# On success nothing of that stderr may reach the terminal (stdout or stderr); the per-run log under the state dir must hold it.
$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot
$stamp = [guid]::NewGuid()
$tmp = if ($env:RUNNER_TEMP) { $env:RUNNER_TEMP } else { [IO.Path]::GetTempPath() }
$bin = Join-Path $tmp "quiet-bin-$stamp"
$caseHome = Join-Path $tmp "quiet-home-$stamp"
New-Item -ItemType Directory -Path $bin, $caseHome -Force | Out-Null
foreach ($n in 'claude', 'npx') {
  Set-Content -Path "$bin\$n.cmd" -Value "@echo off`r`necho STUB-ERR-$n %* 1>&2`r`necho STUB-OUT-$n`r`nexit /b 0" -Encoding ASCII
}
Set-Content -Path "$bin\rtk.cmd" -Value "@echo off`r`nexit /b 0" -Encoding ASCII
$env:PATH = "$bin;$env:PATH"
$errFile = Join-Path $tmp "quiet-err-$stamp.txt"
$ErrorActionPreference = 'Continue'
$text = (& node "$repo\scripts\lean.mjs" --home $caseHome --yes --agents claude --tools context-mode 2>$errFile | Out-String)
$exit = $LASTEXITCODE
$ErrorActionPreference = 'Stop'
$errText = if (Test-Path $errFile) { Get-Content -Raw $errFile } else { '' }
Write-Output $text
if ($exit -ne 0) { throw "expected exit 0, got $exit`n$errText" }
if ($text -notmatch '\[\d+/\d+\] ') { throw 'no [n/N] step lines on the terminal' }
if (($text + $errText) -match 'STUB-(ERR|OUT)-') { throw 'a stub command output reached the terminal' }
$log = Get-ChildItem -Path (Join-Path $caseHome '.config\lean-agents\logs') -Filter *.log | Select-Object -First 1
if (-not $log -or -not ((Get-Content -Raw $log.FullName) -match 'STUB-ERR-claude')) { throw 'the log does not hold the stub stderr' }

# A failing step: the stub npx exits 3 (the lean-update skill step, non-fatal by design: exit 0). The terminal shows the failure line, the last lines of that step and the log path; one failure message.
$failHome = Join-Path $tmp "quiet-fail-home-$stamp"
New-Item -ItemType Directory -Path $failHome -Force | Out-Null
Set-Content -Path "$bin\npx.cmd" -Value "@echo off`r`necho STUB-ERR-npx %* 1>&2`r`nexit /b 3" -Encoding ASCII
$ErrorActionPreference = 'Continue'
$failText = (& node "$repo\scripts\lean.mjs" --home $failHome --yes --agents claude --tools context-mode 2>$errFile | Out-String)
$failExit = $LASTEXITCODE
$ErrorActionPreference = 'Stop'
Write-Output $failText
if ($failExit -ne 0) { throw "the lean-update skill step is non-fatal by design: expected exit 0, got $failExit" }
if (([regex]::Matches($failText, 'failed')).Count -ne 1) { throw 'one failure must print one failed message' }
if ($failText -notmatch 'STUB-ERR-npx') { throw 'the failing step tail is missing' }
if ($failText -notmatch 'full output: ~[\\/]\.config[\\/]lean-agents[\\/]logs') { throw 'the log path (with ~) is missing' }
