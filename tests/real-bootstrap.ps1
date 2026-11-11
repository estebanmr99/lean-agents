# Runs install.ps1 piped into a scriptblock (the way `irm | iex` does) against a packed release folder
# (dist\, built by scripts\release.mjs) in throwaway USERPROFILE folders, with no external commands (--no-exec).
# Used by CI on PowerShell 5.1 and 7. Usage: pwsh tests\real-bootstrap.ps1 [dist-dir]
param([string]$Dist)
$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot
if (-not $Dist) { $Dist = Join-Path $repo 'dist' }
$Dist = (Resolve-Path $Dist).Path
$work = Join-Path ([IO.Path]::GetTempPath()) ([guid]::NewGuid().ToString())
New-Item -ItemType Directory -Path $work | Out-Null
$boot = Join-Path $Dist 'install.ps1'
Remove-Item Env:LEAN_AGENTS_SRC, Env:LEAN_AGENTS_VERSION -ErrorAction SilentlyContinue
$flags = @{ Yes = $true; Agents = 'claude'; NoTools = $true; Privacy = 'standard'; Lang = 'en'; Rest = @('--no-exec') }

function Fail($Message) { throw "FAIL: $Message" }
function Sha($Path) { (Get-FileHash -Algorithm SHA256 -LiteralPath $Path).Hash.ToLower() }
function New-TempProfile {
  $script:dir = Join-Path $work ([guid]::NewGuid().ToString())
  New-Item -ItemType Directory -Path $script:dir | Out-Null
  $env:USERPROFILE = $script:dir
  $env:APPDATA = "$($script:dir)\AppData\Roaming"
}
# Invoke-Boot <dist> <params>: output in $out, 0 or 1 in $rc. Runs from $work\cwd, which holds no lean-agents.
function Invoke-Boot($From, $Params) {
  New-Item -ItemType Directory -Force -Path "$work\cwd" | Out-Null
  Push-Location "$work\cwd"
  $env:LEAN_AGENTS_DIST = $From
  $script:rc = 0
  try { $script:out = (& ([scriptblock]::Create((Get-Content $boot -Raw))) @Params *>&1 | Out-String) }
  catch { $script:rc = 1; $script:out = $_.Exception.Message }
  finally { Pop-Location }
}
function Merge($Extra) { $m = $flags.Clone(); foreach ($k in $Extra.Keys) { $m[$k] = $Extra[$k] }; $m }
$tgz = (Get-ChildItem $Dist -Filter 'lean-agents-*.tgz' | Select-Object -First 1).Name
$stampPath = { Join-Path $env:USERPROFILE '.config\lean-agents\src\.lean-agents-release' }
function Get-Stamp { (Get-Content (& $stampPath) -Raw).Trim() }

try {
  Write-Output '--- (a) a scripts\lean.mjs in the current directory never runs'
  New-TempProfile
  New-Item -ItemType Directory -Force -Path "$work\cwd\scripts" | Out-Null
  Set-Content "$work\cwd\scripts\lean.mjs" "require('node:fs').writeFileSync(process.env.USERPROFILE + '/planted-ran', '1')"
  Invoke-Boot $Dist (Merge @{ DryRun = $true })
  if ($rc -ne 0) { Fail "dry run failed: $out" }
  if (Test-Path "$dir\planted-ran") { Fail 'the planted scripts\lean.mjs ran' }
  Remove-Item -Recurse -Force "$work\cwd"

  Write-Output '--- (b) a dry run without an install leaves USERPROFILE empty'
  New-TempProfile
  Invoke-Boot $Dist (Merge @{ DryRun = $true })
  if ($rc -ne 0) { Fail "dry run failed: $out" }
  if (@(Get-ChildItem -Force $dir).Count -ne 0) { Fail "dry run wrote: $((Get-ChildItem -Force $dir).Name)" }

  Write-Output '--- (c) install writes the stamp; the rerun says already installed'
  New-TempProfile
  Invoke-Boot $Dist (Merge @{})
  if ($rc -ne 0) { Fail "install failed: $out" }
  if ((Get-Stamp) -ne (Sha (Join-Path $Dist $tgz))) { Fail 'stamp is not the tarball sha256' }
  Invoke-Boot $Dist (Merge @{})
  if ($rc -ne 0 -or $out -notmatch 'already installed') { Fail "rerun did not say already installed: $out" }

  Write-Output '--- (d) installed: -DryRun, -Doctor and -Uninstall need no network'
  Invoke-Boot "$work\missing" (Merge @{ DryRun = $true })
  if ($rc -ne 0 -or $out -match 'LEAN_AGENTS_DIST is set') { Fail "offline dry run: $out" }
  Invoke-Boot "$work\missing" @{ Doctor = $true; Rest = @('--no-exec') }
  if ($rc -ne 0) { Fail "offline doctor failed: $out" }
  Invoke-Boot "$work\missing" @{ Uninstall = $true; Yes = $true; Rest = @('--no-exec') }
  if ($rc -ne 0) { Fail "offline uninstall failed: $out" }

  Write-Output '--- (e) a repacked tarball with new SHA256SUMS reinstalls'
  New-TempProfile
  Invoke-Boot $Dist (Merge @{})
  if ($rc -ne 0) { Fail "install failed: $out" }
  $old = Get-Stamp
  $re = Join-Path $work 'repack'
  New-Item -ItemType Directory -Path $re | Out-Null
  Copy-Item "$Dist\*" $re
  node -e "const z=require('node:zlib'),f=require('node:fs');f.writeFileSync(process.argv[2],z.gzipSync(z.gunzipSync(f.readFileSync(process.argv[1])),{level:1}))" (Join-Path $Dist $tgz) (Join-Path $re $tgz)
  $newsum = Sha (Join-Path $re $tgz)
  if ($newsum -eq $old) { Fail 'repack produced the same tarball' }
  (Get-Content "$Dist\SHA256SUMS") -replace "^$old", $newsum | Set-Content "$re\SHA256SUMS"
  Invoke-Boot $re (Merge @{})
  if ($rc -ne 0 -or $out -match 'already installed') { Fail "repack was not reinstalled: $out" }
  if ((Get-Stamp) -ne $newsum) { Fail 'stamp was not updated' }

  Write-Output '--- (f) a bad checksum exits 1 and leaves src untouched'
  $bad = Join-Path $work 'bad'
  New-Item -ItemType Directory -Path $bad | Out-Null
  Copy-Item "$Dist\*" $bad
  (Get-Content "$Dist\SHA256SUMS") -replace '^[0-9a-f]{64}  lean-agents-', ('0' * 64 + '  lean-agents-') | Set-Content "$bad\SHA256SUMS"
  $before = Get-Stamp
  Invoke-Boot $bad (Merge @{})
  if ($rc -ne 1 -or $out -notmatch 'checksum mismatch') { Fail "bad sum: $rc $out" }
  if ((Get-Stamp) -ne $before -or (Test-Path "$env:USERPROFILE\.config\lean-agents\src.new")) { Fail 'src changed after a bad checksum' }

  Write-Output '--- (g) LEAN_AGENTS_DIST prints a warning'
  New-TempProfile
  Invoke-Boot $Dist (Merge @{ DryRun = $true })
  if ($out -notmatch 'LEAN_AGENTS_DIST is set') { Fail "no override warning: $out" }

  Write-Output '--- (h) a foreign src folder is refused'
  New-TempProfile
  New-Item -ItemType Directory -Force -Path "$dir\.config\lean-agents\src" | Out-Null
  Set-Content "$dir\.config\lean-agents\src\keep" 'keep'
  Invoke-Boot $Dist (Merge @{})
  if ($rc -ne 1 -or $out -notmatch 'not a lean-agents install') { Fail "foreign src: $rc $out" }
  if ((Get-Content "$dir\.config\lean-agents\src\keep" -Raw).Trim() -ne 'keep') { Fail 'foreign src was modified' }

  Write-Output 'real-bootstrap: all cases passed'
} finally {
  Remove-Item Env:LEAN_AGENTS_DIST -ErrorAction SilentlyContinue
  Remove-Item -Recurse -Force $work -ErrorAction SilentlyContinue
}
