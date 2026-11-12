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

function Merge-MockProvider([string]$configPath, [int]$port) {
  # Case (b) only: the real installer already wrote this file (with its own `shell` key); add the mock
  # provider and model on top without touching anything the installer wrote.
  $cfg = Get-Content $configPath -Raw | ConvertFrom-Json -AsHashtable
  $cfg['model'] = 'mock/mock-model'
  if ($Major -eq 'v1') {
    $cfg['provider'] = @{ mock = @{ npm = '@ai-sdk/openai-compatible'; name = 'Mock'; options = @{ baseURL = "http://127.0.0.1:$port/v1" }; models = @{ 'mock-model' = @{ name = 'Mock Model' } } } }
  } else {
    $cfg['providers'] = @{ mock = @{ name = 'Mock'; package = '@opencode/ai/providers/openai-compatible'; settings = @{ baseURL = "http://127.0.0.1:$port/v1" }; models = @{ 'mock-model' = @{ name = 'Mock Model' } } } }
  }
  ($cfg | ConvertTo-Json -Depth 8) | Set-Content $configPath -Encoding utf8
}

function Write-MockConfig([string]$configPath, [int]$port, [string]$shellValue) {
  # Schema differs by major: 1.19.0 uses the singular `provider` key with `npm` + `options`
  # (opencode.ai/v1/docs/providers); 2.x uses plural `providers` with `package` + `settings`
  # (opencode.ai/docs/providers). Confirmed against the current docs for each, 2026-11-12.
  if ($Major -eq 'v1') {
    $cfg = [ordered]@{
      '$schema' = 'https://opencode.ai/config.json'
      model     = 'mock/mock-model'
      provider  = [ordered]@{
        mock = [ordered]@{
          npm     = '@ai-sdk/openai-compatible'
          name    = 'Mock'
          options = @{ baseURL = "http://127.0.0.1:$port/v1" }
          models  = @{ 'mock-model' = @{ name = 'Mock Model' } }
        }
      }
    }
  } else {
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
  $env:MOCK_LLM_DEBUG = '1'
  $mock = Start-Process node -ArgumentList "$repo\tests\fixtures\mock-llm.mjs" -RedirectStandardOutput $mockLog -NoNewWindow -PassThru
  Start-Sleep -Seconds 1
  $configPath = "$caseHome\.config\opencode\opencode.jsonc"

  $savedHome = $env:HOME; $savedProfile = $env:USERPROFILE; $savedXdg = $env:XDG_CONFIG_HOME; $savedPath = $env:Path
  try {
    $env:HOME = $caseHome
    $env:USERPROFILE = $caseHome
    $env:XDG_CONFIG_HOME = "$caseHome\.config"
    if ($name -eq 'b-gitbash') {
      # Step 2: run the real installer (not a hand-written config) and prove it wrote the Git Bash path itself.
      # -NoCore -NoTools: the shell edit is unconditional in the adapter, not gated by any tool, so skip every
      # prerequisite (rtk, Bun, gh) this probe does not need - keeps the job fast and winget-free.
      $agent = if ($Major -eq 'v1') { 'opencode-v1' } else { 'opencode-v2' }
      & "$repo\install.ps1" -Yes -Agents $agent -NoCore -NoTools -NoBun -NoGh -NoApp -Privacy strict -ModelProfile none -Lang en --no-exec
      if ($LASTEXITCODE -ne 0) { throw "install.ps1 failed for $Major" }
      $installed = (Get-Content $configPath -Raw | ConvertFrom-Json).shell
      if ($installed -ne $gitBash) { throw "installer wrote shell='$installed', expected '$gitBash'" }
      Write-Output "ok    installer wrote shell=$installed"
      Merge-MockProvider $configPath $port
      # Prove the absolute path still works with Git's own dirs off PATH, not found through PATH lookup.
      $env:Path = ($savedPath -split ';' | Where-Object { $_ -notmatch '(?i)\\git(\\|$)' }) -join ';'
    } else {
      Write-MockConfig $configPath $port $cases[$name]
    }
    # 2.x: --standalone alone was not enough on a real Windows run (first real run of this job, PR #133) -
    # a prior case's server was still bound to the shared default "managed service" port, even under
    # --standalone, and the runner had to reap an orphaned opencode process at cleanup. Give each case its
    # own port (scoped to that case's HOME: opencode service get/set write <HOME>/.config/opencode/service.json,
    # confirmed locally) and stop whatever is listening before moving to the next case.
    # 1.19.0 has no managed service or either flag: each `opencode run` already starts its own server on a
    # random port (opencode.ai/v1/docs/cli).
    $standalone = if ($Major -eq 'v2') {
      $servicePort = Get-Random -Minimum 20000 -Maximum 60000
      & opencode service set port $servicePort | Out-Null
      '--standalone'
    } else { @() }
    $out = & opencode run --format json @standalone 'say hi' 2>"$caseHome\err.txt"
    $exit = $LASTEXITCODE
  } finally {
    if ($Major -eq 'v2') { & opencode service stop 2>$null | Out-Null }
    $env:HOME = $savedHome; $env:USERPROFILE = $savedProfile; $env:XDG_CONFIG_HOME = $savedXdg; $env:Path = $savedPath
    Stop-Process -Id $mock.Id -Force -ErrorAction SilentlyContinue
  }

  $joined = ($out -join "`n")
  Write-Output "--- $Major case $name (shell=$($cases[$name])) exit=$exit ---"
  Write-Output $joined
  if ($exit -ne 0) {
    Write-Output '--- stderr ---'; Get-Content "$caseHome\err.txt" | Write-Output
    Write-Output '--- mock log (tools the model saw) ---'; Get-Content $mockLog | Write-Output
  }
  $results[$name] = $joined
}

# Git Bash signal: $0 (SHELL0) is the actual interpreter path, so it names "bash" regardless of which
# MSYSTEM flavor Git for Windows reports (MINGW64, UCRT64, CLANG64, ...). Checking MSYSTEM for a fixed
# value like "MINGW" undercounts a real pass - that was this script's own bug on the first real run.
$gitBashPattern = 'SHELL0=.*[Bb]ash'
Write-Output "=== $Major summary ==="
foreach ($name in $results.Keys) {
  $ran = if ($results[$name] -match $gitBashPattern) { 'Git Bash' } elseif ($results[$name] -match 'SHELL0=.*[Pp]ower[Ss]hell') { 'PowerShell' } elseif ($results[$name] -match 'MSYS=(\\\\[rn])*SHELL0=') { 'empty vars (likely PowerShell or cmd, not Git Bash)' } else { 'undetermined' }
  Write-Output "  $name -> $ran"
}

# The one hard requirement: an absolute Git Bash path in `shell` must select Git Bash, PATH or not.
# If upstream does not honor it (opencode#38799), this throws and the follow-up records "not proven" for $Major.
if ($results['b-gitbash'] -notmatch $gitBashPattern) {
  throw "shell=<git bash path> did not select Git Bash on $Major - see output above. Treat as NOT PROVEN for this major."
}
Write-Output "PROVEN on $Major`: shell=<Git Bash path> selects Git Bash."
