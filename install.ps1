# lean-agents bootstrap for Windows (PowerShell 5.1 and 7).
# Makes sure git and Node.js 20+ exist, fetches lean-agents, then hands over to the
# Node engine (scripts/lean.mjs), which shows the full plan before changing anything.
#
#   & ([scriptblock]::Create((irm https://raw.githubusercontent.com/estebanmr99/lean-agents/main/install.ps1))) -DryRun
[CmdletBinding(PositionalBinding = $false)]
param(
  [switch]$DryRun,
  [switch]$Yes,
  [string[]]$Agents,
  [string[]]$Tools,
  [switch]$AllTools,
  [switch]$NoTools,
  [string]$Privacy,
  # $Profile is a PowerShell automatic variable, so -Profile binds through an alias.
  [Alias('Profile')][string]$ModelProfile,
  [string]$Lang,
  [switch]$Update,
  [switch]$Uninstall,
  [switch]$Doctor,
  # Other engine flags pass through as they are (--no-exec, --adhd-always, --ponytail-mode lite).
  [Parameter(ValueFromRemainingArguments = $true)][string[]]$Rest
)

$ErrorActionPreference = 'Stop'

$RepoUrl = if ($env:LEAN_AGENTS_REPO) { $env:LEAN_AGENTS_REPO } else { 'https://github.com/estebanmr99/lean-agents' }
$Ref = if ($env:LEAN_AGENTS_REF) { $env:LEAN_AGENTS_REF } else { 'main' }
$Src = if ($env:LEAN_AGENTS_SRC) { $env:LEAN_AGENTS_SRC } else { Join-Path $env:USERPROFILE '.config\lean-agents\src' }

function Test-Command($Name) { [bool](Get-Command $Name -ErrorAction SilentlyContinue) }

function Assert-Success($What) { if ($LASTEXITCODE -ne 0) { throw "lean-agents: $What failed" } }

function Install-Prerequisite($Bin, $Id, $Url) {
  if (Test-Command $Bin) { return }
  if (-not (Test-Command 'winget')) { throw "lean-agents: $Bin is required. Install it from $Url and run this again." }
  $command = "winget install --id $Id -e --scope user --accept-source-agreements --accept-package-agreements"
  if ($DryRun) { Write-Output "Would run: $command"; return }
  if (-not $Yes -and (Read-Host "$Bin is missing. Install it with '$command'? [y/N]") -notmatch '^(y|yes|s|si)$') {
    throw "lean-agents: $Bin is required. Install it from $Url and run this again."
  }
  winget install --id $Id -e --scope user --accept-source-agreements --accept-package-agreements
  Assert-Success 'winget install'
  $env:Path = @('Machine', 'User' | ForEach-Object { [Environment]::GetEnvironmentVariable('Path', $_) }) -join ';'
}

Install-Prerequisite 'git' 'Git.Git' 'https://git-scm.com/downloads'
Install-Prerequisite 'node' 'OpenJS.NodeJS.LTS' 'https://nodejs.org/'
if (-not (Test-Command 'node')) { throw 'lean-agents: Node.js is required for the engine. Install it and run this again.' }
$nodeVersion = & node --version
if ([int]$nodeVersion.TrimStart('v').Split('.')[0] -lt 20) {
  throw "lean-agents: Node.js 20 or newer is required (found $nodeVersion). Update from https://nodejs.org/"
}

# Use the checkout this script lives in, if any; otherwise clone or update the source folder.
if ($PSScriptRoot -and (Test-Path (Join-Path $PSScriptRoot 'scripts\lean.mjs'))) {
  $Src = $PSScriptRoot
} elseif (Test-Path (Join-Path $Src '.git')) {
  git -C $Src fetch --quiet --depth 1 origin $Ref
  Assert-Success 'git fetch'
  git -C $Src checkout --quiet FETCH_HEAD
  Assert-Success 'git checkout'
} else {
  New-Item -ItemType Directory -Force -Path (Split-Path $Src) | Out-Null
  git clone --quiet --depth 1 --branch $Ref $RepoUrl $Src
  Assert-Success 'git clone'
}

if (-not (Test-Path (Join-Path $Src 'node_modules\jsonc-parser'))) {
  npm ci --prefix $Src --omit=dev --silent --no-audit --no-fund
  Assert-Success "npm install in $Src"
}

# RTK from the release zip (when winget is not available) lives here. See docs/manual-install.md.
$rtkDir = Join-Path $env:USERPROFILE 'tools\rtk'
$userPath = @([Environment]::GetEnvironmentVariable('Path', 'User') -split ';' | Where-Object { $_ })
if (-not $DryRun -and (Test-Path (Join-Path $rtkDir 'rtk.exe'))) {
  if (-not $Uninstall -and $userPath -notcontains $rtkDir) {
    [Environment]::SetEnvironmentVariable('Path', (($userPath + $rtkDir) -join ';'), 'User')
    Write-Output "Added $rtkDir to your user PATH. Open a new terminal after this install."
  }
  if (-not (Test-Command 'rtk')) { $env:Path += ";$rtkDir" }
}

$engineArgs = @()
$switches = [ordered]@{ DryRun = '--dry-run'; Yes = '--yes'; AllTools = '--all-tools'; NoTools = '--no-tools'; Update = '--update'; Uninstall = '--uninstall'; Doctor = '--doctor' }
foreach ($name in $switches.Keys) { if ($PSBoundParameters[$name]) { $engineArgs += $switches[$name] } }
$lists = [ordered]@{ Agents = '--agents'; Tools = '--tools' }
foreach ($name in $lists.Keys) { if ($PSBoundParameters[$name]) { $engineArgs += $lists[$name], ($PSBoundParameters[$name] -join ',') } }
$values = [ordered]@{ Privacy = '--privacy'; ModelProfile = '--profile'; Lang = '--lang' }
foreach ($name in $values.Keys) { if ($PSBoundParameters[$name]) { $engineArgs += $values[$name], $PSBoundParameters[$name] } }
if ($Rest) { $engineArgs += $Rest }

& node (Join-Path $Src 'scripts\lean.mjs') @engineArgs
$code = $LASTEXITCODE

# After the engine, because its uninstall still needs rtk on PATH.
if ($Uninstall -and -not $DryRun -and $code -eq 0 -and $userPath -contains $rtkDir) {
  [Environment]::SetEnvironmentVariable('Path', (($userPath | Where-Object { $_ -ne $rtkDir }) -join ';'), 'User')
  Write-Output "Removed $rtkDir from your user PATH."
}

# throw, not exit: piped into a scriptblock, exit would close the user's shell.
if ($code -ne 0) { throw "lean-agents: the engine exited with code $code" }
