# Spike (#80 part 2, P1), native PowerShell half: 1.19 on a frozen copy through XDG_DATA_HOME + XDG_STATE_HOME
# (and with XDG_CONFIG_HOME), set the way `opencode1.cmd` will set them, with backslash paths. The live dirs of a
# throwaway HOME must stay byte-identical and the new session must land in the frozen copy.
# Real 1.19 (-Binary, default `opencode` on PATH), a local mock LLM (tests/fixtures/mock-llm.mjs, read only), no login.
param([string]$Binary = 'opencode')
$opencodeBin = $Binary
$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot
$root = Join-Path ([IO.Path]::GetTempPath()) "p1-$([guid]::NewGuid())"
$live = Join-Path $root 'home'
$proj = Join-Path $root 'proj'
New-Item -ItemType Directory -Force -Path "$live\.config\opencode", "$live\.local\share", "$live\.local\state", $proj | Out-Null

$saved = @{}
foreach ($n in 'HOME', 'USERPROFILE', 'XDG_DATA_HOME', 'XDG_STATE_HOME', 'XDG_CONFIG_HOME', 'OPENCODE_DB', 'OPENCODE_CONFIG_DIR') { $saved[$n] = [Environment]::GetEnvironmentVariable($n) }
function Use-Env([hashtable]$vars) { foreach ($k in $vars.Keys) { [Environment]::SetEnvironmentVariable($k, $vars[$k]) } }
function Restore-Env { foreach ($k in $saved.Keys) { [Environment]::SetEnvironmentVariable($k, $saved[$k]) } }

function Get-Tree([string]$dir) {
  if (-not (Test-Path $dir)) { return '' }
  $files = Get-ChildItem $dir -Recurse -File | Sort-Object FullName
  return (($files | ForEach-Object { $_.FullName.Substring($dir.Length) + ':' + (Get-FileHash $_.FullName -Algorithm SHA256).Hash }) -join "`n")
}
# Windows PowerShell 5.1 turns native stderr into a terminating error under 'Stop', so native calls run under 'Continue'.
function Invoke-OpenCode {
  $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  try { & $opencodeBin @args 2>&1 | Where-Object { $_ -isnot [System.Management.Automation.ErrorRecord] } } finally { $ErrorActionPreference = $prev }
}
function Get-SessionCount {
  $out = Invoke-OpenCode session list --format json | Out-String
  try { return @($out | ConvertFrom-Json).Count } catch { return -1 }
}

$mockLog = Join-Path $root 'mock.log'
$env:MOCK_LLM_PORT = '0'; $env:MOCK_LLM_COMMAND = 'echo p1'; $env:MOCK_LLM_TOOL = 'bash'
$mock = Start-Process node -ArgumentList "`"$repo\tests\fixtures\mock-llm.mjs`"" -RedirectStandardOutput $mockLog -NoNewWindow -PassThru
$failed = $false
try {
  $port = $null
  for ($i = 0; $i -lt 10 -and -not $port; $i++) {
    Start-Sleep -Seconds 1
    $m = Select-String -Path $mockLog -Pattern '^MOCK_LLM_PORT=(\d+)' -ErrorAction SilentlyContinue
    if ($m) { $port = $m.Matches[0].Groups[1].Value }
  }
  if (-not $port) { throw 'mock LLM did not start' }
  $cfg = @{
    '$schema' = 'https://opencode.ai/config.json'; model = 'mock/mock-model'; autoupdate = $false; share = 'disabled'
    provider = @{ mock = @{ npm = '@ai-sdk/openai-compatible'; name = 'Mock'; options = @{ baseURL = "http://127.0.0.1:$port/v1" }; models = @{ 'mock-model' = @{ name = 'Mock Model' } } } }
  }
  # WriteAllText: Set-Content -Encoding utf8 writes a BOM on Windows PowerShell 5.1.
  [IO.File]::WriteAllText("$live\.config\opencode\opencode.jsonc", ($cfg | ConvertTo-Json -Depth 8))
  Set-Location $proj

  Use-Env @{ HOME = $live; USERPROFILE = $live; XDG_DATA_HOME = $null; XDG_STATE_HOME = $null; XDG_CONFIG_HOME = $null; OPENCODE_DB = $null; OPENCODE_CONFIG_DIR = $null }
  Invoke-OpenCode run 'p1 seed live' --model mock/mock-model | Out-Null
  $liveCount = Get-SessionCount
  $liveDirs = @{ data = "$live\.local\share\opencode"; state = "$live\.local\state\opencode"; config = "$live\.config\opencode" }
  $before = @{}; foreach ($k in $liveDirs.Keys) { $before[$k] = Get-Tree $liveDirs[$k] }
  Write-Output "P1 live: sessions=$liveCount"
  if ($liveCount -lt 1 -or -not $before.data) { throw 'the live seed made no session' }

  foreach ($case in 'a1', 'a2') {
    $frozen = Join-Path $root "frozen-$case"
    New-Item -ItemType Directory -Force -Path "$frozen\data", "$frozen\state", "$frozen\config" | Out-Null
    Copy-Item $liveDirs.data "$frozen\data\opencode" -Recurse
    Copy-Item $liveDirs.state "$frozen\state\opencode" -Recurse
    Copy-Item $liveDirs.config "$frozen\config\opencode" -Recurse
    $env:XDG_DATA_HOME = "$frozen\data"; $env:XDG_STATE_HOME = "$frozen\state"
    $env:XDG_CONFIG_HOME = $(if ($case -eq 'a1') { "$frozen\config" } else { $null })
    $n0 = Get-SessionCount
    Invoke-OpenCode run "p1 seed $case" --model mock/mock-model | Out-Null
    $n1 = Get-SessionCount
    Use-Env @{ XDG_DATA_HOME = $null; XDG_STATE_HOME = $null; XDG_CONFIG_HOME = $null }
    $changed = @(foreach ($k in $liveDirs.Keys) { if ((Get-Tree $liveDirs[$k]) -ne $before[$k]) { $k } })
    $ok = ($changed.Count -eq 0) -and ($n0 -eq $liveCount) -and ($n1 -eq $n0 + 1)
    Write-Output "P1 ${case}: live dirs changed=[$($changed -join ',')] | frozen sessions $n0 -> $n1 (live had $liveCount) | $(if ($ok) { 'PASS' } else { 'FAIL' })"
    if (-not $ok) { $failed = $true }
  }
} finally {
  Restore-Env
  Set-Location $repo
  if ($mock -and -not $mock.HasExited) { Stop-Process -Id $mock.Id -Force }
  Remove-Item $root -Recurse -Force -ErrorAction SilentlyContinue
}
if ($failed) { throw 'isolation proof failed (see the P1 lines above)' }
Write-Output 'P1 ps1 OK: XDG_DATA_HOME + XDG_STATE_HOME (with and without XDG_CONFIG_HOME) isolate 1.19'
