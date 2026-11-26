# RTK on OpenCode 2 (#478), Windows: does OpenCode 2 load the plugins/rtk.ts that `rtk init -g --opencode` writes, without a
# LoadError, and does its hook rewrite a shell call? Real opencode 2 and real rtk (CI installs the pinned one) in a throwaway
# USERPROFILE; a local mock LLM (tests/fixtures/mock-llm.mjs) asks for `ls`, so no login and no model.
# rtk ignores USERPROFILE and writes to the OS profile folder (here the disposable runner's): the file is copied into the
# throwaway profile before OpenCode starts. The rewrite proof is rtk's own counter: `rtk gain` counts the `rtk ls` the
# rewritten command ran. Needs `opencode` (2.x) and `rtk` on PATH. PowerShell 5.1 compatible.
$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot

& rtk init -g --opencode
if ($LASTEXITCODE -ne 0) { throw 'rtk init -g --opencode failed' }
$candidates = @("$env:USERPROFILE\.config\opencode\plugins\rtk.ts", "$env:APPDATA\opencode\plugins\rtk.ts", "$env:LOCALAPPDATA\opencode\plugins\rtk.ts")
$plugin = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $plugin) { throw "rtk init wrote no plugins/rtk.ts in: $($candidates -join ', ')" }
Write-Output "ok    rtk init wrote $plugin"

function Get-RtkCommandCount {
  $text = (& rtk gain 2>&1 | Out-String)
  if ($text -match 'Total commands:\s+(\d+)') { return [int]$Matches[1] }
  return 0
}
$before = Get-RtkCommandCount
# Evidence for a failing rewrite: what rtk answers to the plugin's own question.
Write-Output "rtk hook opencode answers: $(& rtk hook opencode --agent build ls 2>&1 | Out-String) (exit $LASTEXITCODE)"
Write-Output "rtk rewrite answers: $(& rtk rewrite ls 2>&1 | Out-String) (exit $LASTEXITCODE)"

$caseHome = Join-Path $env:RUNNER_TEMP "rtk-v2-$([guid]::NewGuid())"
$cfgDir = "$caseHome\.config\opencode"
New-Item -ItemType Directory -Path "$cfgDir\plugins" -Force | Out-Null
Copy-Item $plugin "$cfgDir\plugins\rtk.ts"

$probe = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
$probe.Start(); $port = $probe.LocalEndpoint.Port; $probe.Stop()
$config = @"
{
  "model": "mock/mock-model",
  "providers": {
    "mock": {
      "name": "Mock",
      "package": "@opencode/ai/providers/openai-compatible",
      "settings": { "baseURL": "http://127.0.0.1:$port/v1" },
      "models": { "mock-model": { "name": "Mock Model", "limit": { "context": 300000, "output": 8000 } } }
    }
  }
}
"@
Set-Content -Path "$cfgDir\opencode.jsonc" -Value $config -Encoding UTF8

$env:MOCK_LLM_PORT = "$port"; $env:MOCK_LLM_COMMAND = 'ls'; $env:MOCK_LLM_TOOL = 'shell'
$mock = Start-Process node -ArgumentList "$repo\tests\fixtures\mock-llm.mjs" -RedirectStandardOutput "$caseHome\mock.log" -NoNewWindow -PassThru
Start-Sleep -Seconds 1
$saved = @{ HOME = $env:HOME; USERPROFILE = $env:USERPROFILE; XDG_CONFIG_HOME = $env:XDG_CONFIG_HOME; XDG_DATA_HOME = $env:XDG_DATA_HOME }
try {
  $env:HOME = $caseHome; $env:USERPROFILE = $caseHome
  $env:XDG_CONFIG_HOME = "$caseHome\.config"; $env:XDG_DATA_HOME = "$caseHome\.local\share"
  & opencode service set port (Get-Random -Minimum 20000 -Maximum 60000) | Out-Null
  $out = & opencode run --format json --standalone 'list files' 2>"$caseHome\err.txt"
  $exit = $LASTEXITCODE
} finally {
  & opencode service stop 2>$null | Out-Null
  foreach ($k in $saved.Keys) { Set-Item -Path "Env:$k" -Value $saved[$k] }
  Stop-Process -Id $mock.Id -Force -ErrorAction SilentlyContinue
}

$logs = @("$caseHome\err.txt") + @(Get-ChildItem "$caseHome\.local\share\opencode\log" -Filter *.log -ErrorAction SilentlyContinue | ForEach-Object { $_.FullName })
$text = (($out -join "`n") + "`n" + (($logs | Where-Object { Test-Path $_ } | ForEach-Object { Get-Content $_ -Raw }) -join "`n"))
$failed = $false
if ($exit -ne 0) { Write-Output "FAIL  opencode run exit $exit"; $failed = $true }
if ($text -match 'LoadError|failed to load plugin') { Write-Output 'FAIL  OpenCode 2 logged a plugin load error for plugins/rtk.ts'; $failed = $true }
else { Write-Output 'ok    OpenCode 2 loads plugins/rtk.ts (no LoadError)' }
$after = Get-RtkCommandCount
if ($after -gt $before) { Write-Output "ok    the 2.x hook rewrote the shell call: rtk ran it (commands $before -> $after)" }
else { Write-Output "FAIL  rtk did not run the shell call (commands $before -> $after)"; $failed = $true }
if ($failed) { Write-Output '--- output ---'; Write-Output $text; exit 1 }
