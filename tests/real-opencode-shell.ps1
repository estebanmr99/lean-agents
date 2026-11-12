# Spike for issue #124 follow-up: does OpenCode's `shell` config key govern the Windows bash/shell tool?
# Real OpenCode binary (1.19.0 or 2.2.5, picked by -Major), throwaway USERPROFILE, no login and no paid
# model: a local mock LLM (tests/fixtures/mock-llm.mjs) answers with one shell-tool call, OpenCode is
# pointed at it through a custom OpenAI-compatible provider, and the tool's own output
# ("MSYS=<value>", "SHELL0=<argv0>") says which binary actually ran the command.
# This is exploratory: it prints the evidence for every case. Only case (b) is asserted, because that is
# the one the follow-up needs proven before it can ship a default (opencode#57656 vs opencode#38799).
param(
  [Parameter(Mandatory = $true)][ValidateSet('v1', 'v2')] [string]$Major,
  # OpenCode 2.x names the tool "shell" (confirmed locally on 2.1.4); 1.19.0 may still call it "bash".
  [string]$ToolName = $(if ($Major -eq 'v1') { 'bash' } else { 'shell' })
)
$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot
$command = 'echo "MSYS=$MSYSTEM"; echo "SHELL0=$0"'

$gitBash = "$env:ProgramFiles\Git\bin\bash.exe"
if (-not (Test-Path $gitBash)) { throw 'Git Bash not found on the runner (expected at $env:ProgramFiles\Git\bin\bash.exe)' }

function New-CaseHome([string]$name) {
  $dir = Join-Path $env:RUNNER_TEMP "shell-$Major-$name-$([guid]::NewGuid())"
  New-Item -ItemType Directory -Path "$dir\.config\opencode" -Force | Out-Null
  return $dir
}

function Write-MockConfig([string]$configPath, [int]$port, [string]$shellValue) {
  $cfg = [ordered]@{
    '$schema'  = 'https://opencode.ai/config.json'
    model      = 'mock/mock-model'
    providers  = [ordered]@{
      mock = [ordered]@{
        name     = 'Mock'
        package  = '@opencode/ai/providers/openai-compatible'
        settings = @{ baseURL = "http://127.0.0.1:$port/v1" }
        models   = @{ 'mock-model' = @{ name = 'Mock Model' } }
      }
    }
  }
  if ($shellValue) { $cfg['shell'] = $shellValue }
  ($cfg | ConvertTo-Json -Depth 8) | Set-Content $configPath -Encoding utf8
}

# Case label -> the `shell` config value to write ($null = key absent, case a).
$cases = [ordered]@{
  'a-no-key'   = $null
  'b-gitbash'  = $gitBash
  'c-powershell' = 'powershell.exe'
}

$results = @{}
foreach ($name in $cases.Keys) {
  # Not $home: that shadows PowerShell's own read-only automatic $HOME variable.
  $caseHome = New-CaseHome $name
  $port = Get-Random -Minimum 20000 -Maximum 60000
  $mockLog = "$caseHome\mock.log"
  # Env vars, not argv: a Windows command line full of quotes and `$` is fragile to pass as a process argument.
  $env:MOCK_LLM_PORT = "$port"
  $env:MOCK_LLM_COMMAND = $command
  $env:MOCK_LLM_TOOL = $ToolName
  $mock = Start-Process node -ArgumentList "$repo\tests\fixtures\mock-llm.mjs" -RedirectStandardOutput $mockLog -NoNewWindow -PassThru
  Start-Sleep -Seconds 1
  Write-MockConfig "$caseHome\.config\opencode\opencode.jsonc" $port $cases[$name]

  $savedHome = $env:HOME; $savedProfile = $env:USERPROFILE; $savedXdg = $env:XDG_CONFIG_HOME; $savedPath = $env:Path
  try {
    $env:HOME = $caseHome
    $env:USERPROFILE = $caseHome
    $env:XDG_CONFIG_HOME = "$caseHome\.config"
    # Case (b): prove the absolute path works even with Git's own dirs off PATH, not found through PATH lookup.
    if ($name -eq 'b-gitbash') {
      $env:Path = ($savedPath -split ';' | Where-Object { $_ -notmatch '(?i)\\git(\\|$)' }) -join ';'
    }
    $out = & opencode run --format json 'say hi' 2>"$caseHome\err.txt"
    $exit = $LASTEXITCODE
  } finally {
    $env:HOME = $savedHome; $env:USERPROFILE = $savedProfile; $env:XDG_CONFIG_HOME = $savedXdg; $env:Path = $savedPath
    Stop-Process -Id $mock.Id -Force -ErrorAction SilentlyContinue
  }

  $joined = ($out -join "`n")
  Write-Host "--- $Major case $name (shell=$($cases[$name])) exit=$exit ---"
  Write-Host $joined
  if ($exit -ne 0) { Write-Host '--- stderr ---'; Get-Content "$caseHome\err.txt" | Write-Host }
  $results[$name] = $joined
}

Write-Host "=== $Major summary ==="
foreach ($name in $results.Keys) {
  $ran = if ($results[$name] -match 'MSYS=MINGW') { 'Git Bash' } elseif ($results[$name] -match 'SHELL0=.*[Pp]ower[Ss]hell') { 'PowerShell' } elseif ($results[$name] -match 'MSYS=\\n?SHELL0=') { 'unknown (no MSYSTEM)' } else { 'undetermined' }
  Write-Host "  $name -> $ran"
}

# The one hard requirement: an absolute Git Bash path in `shell` must select Git Bash, PATH or not.
# If upstream does not honor it (opencode#38799), this throws and the follow-up records "not proven" for $Major.
if ($results['b-gitbash'] -notmatch 'MSYS=MINGW') {
  throw "shell=<git bash path> did not select Git Bash on $Major - see output above. Treat as NOT PROVEN for this major."
}
Write-Host "PROVEN on $Major`: shell=<Git Bash path> selects Git Bash."
