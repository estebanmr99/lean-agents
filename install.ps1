# lean-agents bootstrap for Windows (PowerShell 5.1 and 7).
# Makes sure git and Node.js 22.20+ exist, downloads the latest release (npm tarball), checks it against
# the release's SHA256SUMS, then hands over to the Node engine (scripts/lean.mjs), which shows the full
# plan before changing anything. Node users can skip this: npx lean-agents@latest
#
#   & ([scriptblock]::Create((irm https://github.com/estebanmr99/lean-agents/releases/latest/download/install.ps1))) -DryRun
#
# Env: LEAN_AGENTS_VERSION=0.7.0 pins a release; LEAN_AGENTS_DIST=<folder or https url> reads the release
# files from there instead (CI and mirrors; prints a warning); LEAN_AGENTS_SRC moves the install folder.
[CmdletBinding(PositionalBinding = $false)]
param(
  [switch]$DryRun,
  [switch]$Yes,
  [string[]]$Agents,
  [string[]]$Tools,
  [switch]$AllTools,
  [switch]$NoTools,
  [switch]$NoCore,
  [switch]$NoBun,
  [switch]$NoApp,
  [switch]$NoGh,
  [string]$Privacy,
  # $Profile is a PowerShell automatic variable, so -Profile binds through an alias.
  [Alias('Profile')][string]$ModelProfile,
  [string]$Lang,
  [switch]$Update,
  [switch]$Uninstall,
  [switch]$Doctor,
  [string]$Project,
  [string]$Migrate,
  # Other engine flags pass through as they are (--no-exec, --adhd-always, --ponytail-mode lite).
  [Parameter(ValueFromRemainingArguments = $true)][string[]]$Rest
)

$ErrorActionPreference = 'Stop'

$Repo = 'estebanmr99/lean-agents'
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
if ([version]$nodeVersion.TrimStart('v') -lt [version]'22.20.0') {
  throw "lean-agents: Node.js 22.20 or newer is required (found $nodeVersion). Update from https://nodejs.org/"
}

# The OpenCode 2 upstream script (Git Bash) installs here and only edits ~/.bashrc, so PowerShell never sees it.
$OpenCodeBin = Join-Path $env:USERPROFILE '.opencode\bin'
if (-not (Test-Command 'opencode') -and (Test-Path (Join-Path $OpenCodeBin 'opencode.exe'))) {
  Write-Warning "OpenCode is in $OpenCodeBin but not on your PATH. Detecting it for this run only; to fix it for good, add that folder to your user PATH."
  $env:Path = "$env:Path;$OpenCodeBin"
}

function Get-Sha256($Path) { (Get-FileHash -Algorithm SHA256 -LiteralPath $Path).Hash.ToLower() }

# A checkout is used only when this script is a real file next to scripts\lean.mjs ($PSScriptRoot is
# empty when piped into a scriptblock, so a scripts\lean.mjs in the current folder never runs).
# A checkout you run as a file is trusted as it is (you chose it); only the release download is checksum-verified.
$stamp = Join-Path $Src '.lean-agents-release'
$tmp = $null
if ($PSScriptRoot -and (Test-Path (Join-Path $PSScriptRoot 'scripts\lean.mjs'))) {
  $Src = $PSScriptRoot
  # node_modules\.lean-agents-lock holds the package-lock.json hash from the last npm ci, so a changed lockfile reinstalls.
  $lockFile = Join-Path $Src 'package-lock.json'
  $lock = if (Test-Path $lockFile) { Get-Sha256 $lockFile } else { '' }
  $lockStamp = Join-Path $Src 'node_modules\.lean-agents-lock'
  $lockSeen = if (Test-Path $lockStamp) { (Get-Content $lockStamp -Raw).Trim() } else { $null }
  if (-not (Test-Path (Join-Path $Src 'node_modules\jsonc-parser')) -or -not (Test-Path (Join-Path $Src 'node_modules\@clack\prompts')) -or $lockSeen -ne $lock) {
    npm ci --prefix $Src --omit=dev --silent --no-audit --no-fund
    Assert-Success "npm install in $Src"
    Set-Content -Path $lockStamp -Value $lock -Encoding ascii
  }
} elseif (($DryRun -or $Doctor -or $Uninstall) -and -not $Update -and (Test-Path $stamp) -and (Test-Path (Join-Path $Src 'scripts\lean.mjs'))) {
  # Already installed: --dry-run, --doctor and --uninstall (without --update) run it with no network.
} else {
  # Never replace a folder that is not a lean-agents install (the old git clone has scripts\lean.mjs and goes).
  if ((Test-Path $Src) -and -not (Test-Path (Join-Path $Src 'scripts\lean.mjs'))) {
    throw "lean-agents: $Src exists and is not a lean-agents install. Move it away or set LEAN_AGENTS_SRC."
  }
  # An old bootstrap clone is clean and goes; a clone with local changes is never deleted.
  if (Test-Path (Join-Path $Src '.git')) {
    $dirty = git -C $Src status --porcelain 2>&1
    if ($LASTEXITCODE -ne 0 -or $dirty) {
      throw "lean-agents: $Src is a git clone with local changes (or git cannot read it), so it is left alone. Commit or move it, or set LEAN_AGENTS_SRC to another folder."
    }
  }
  if ($env:LEAN_AGENTS_DIST) {
    $base = $env:LEAN_AGENTS_DIST.TrimEnd('/', '\')
    if ($base -notmatch '^https://' -and -not (Test-Path $base -PathType Container)) { throw 'lean-agents: LEAN_AGENTS_DIST must be an https URL or an existing folder.' }
    Write-Warning "lean-agents: LEAN_AGENTS_DIST is set, so lean-agents comes from $base and not from GitHub releases."
  } elseif ($env:LEAN_AGENTS_VERSION) {
    $base = "https://github.com/$Repo/releases/download/v$($env:LEAN_AGENTS_VERSION.TrimStart('v'))"
  } else {
    $base = "https://github.com/$Repo/releases/latest/download"
  }
  $tmp = Join-Path ([IO.Path]::GetTempPath()) ([guid]::NewGuid().ToString())
  New-Item -ItemType Directory -Path $tmp | Out-Null
  $ProgressPreference = 'SilentlyContinue'
  function Get-ReleaseFile($Name, $Out) {
    if ($base -match '^https://') { Invoke-WebRequest -UseBasicParsing -Uri "$base/$Name" -OutFile $Out } else { Copy-Item -LiteralPath (Join-Path $base $Name) -Destination $Out }
  }
  try {
    Get-ReleaseFile 'SHA256SUMS' (Join-Path $tmp 'SHA256SUMS')
    $line = Get-Content (Join-Path $tmp 'SHA256SUMS') | Where-Object { $_ -match '^[0-9a-f]{64}  lean-agents-[0-9A-Za-z._-]+\.tgz$' } | Select-Object -First 1
    if (-not $line) { throw 'lean-agents: SHA256SUMS has no lean-agents tarball.' }
    $want, $name = $line -split '  '
    $version = $name -replace '^lean-agents-', '' -replace '\.tgz$', ''
    if ((Test-Path $stamp) -and (Test-Path (Join-Path $Src 'scripts\lean.mjs')) -and ((Get-Content $stamp -Raw).Trim() -eq $want)) {
      Write-Output "lean-agents v$version already installed."
    } else {
      Get-ReleaseFile $name (Join-Path $tmp $name)
      $got = Get-Sha256 (Join-Path $tmp $name)
      if ($got -ne $want) { throw "lean-agents: checksum mismatch for $name (expected $want, got $got). Nothing was installed." }
      if ($DryRun -and -not (Test-Path $stamp)) {
        # A dry run with nothing installed leaves the profile untouched: the engine runs from a temp folder.
        $Src = Join-Path $tmp 'src'
        New-Item -ItemType Directory -Path $Src | Out-Null
        tar -xzf (Join-Path $tmp $name) -C $Src --strip-components 1
        Assert-Success 'tar extract'
      } else {
        New-Item -ItemType Directory -Force -Path (Split-Path $Src) | Out-Null
        if (Test-Path "$Src.new") { Remove-Item -Recurse -Force "$Src.new" }
        New-Item -ItemType Directory -Path "$Src.new" | Out-Null
        tar -xzf (Join-Path $tmp $name) -C "$Src.new" --strip-components 1
        Assert-Success 'tar extract'
        if (-not (Test-Path (Join-Path "$Src.new" 'scripts\lean.mjs'))) { throw "lean-agents: $name has no scripts\lean.mjs." }
        Set-Content -Path (Join-Path "$Src.new" '.lean-agents-release') -Value $want -Encoding ascii
        if (Test-Path $Src) { Remove-Item -Recurse -Force $Src }
        Move-Item "$Src.new" $Src
        Write-Output "lean-agents v$version installed in $Src"
      }
    }
  } catch {
    Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
    throw
  }
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
$switches = [ordered]@{ DryRun = '--dry-run'; Yes = '--yes'; AllTools = '--all-tools'; NoTools = '--no-tools'; NoCore = '--no-core'; NoBun = '--no-bun'; NoApp = '--no-app'; NoGh = '--no-gh'; Update = '--update'; Uninstall = '--uninstall'; Doctor = '--doctor' }
foreach ($name in $switches.Keys) { if ($PSBoundParameters[$name]) { $engineArgs += $switches[$name] } }
$lists = [ordered]@{ Agents = '--agents'; Tools = '--tools' }
foreach ($name in $lists.Keys) { if ($PSBoundParameters[$name]) { $engineArgs += $lists[$name], ($PSBoundParameters[$name] -join ',') } }
$values = [ordered]@{ Privacy = '--privacy'; ModelProfile = '--profile'; Lang = '--lang' }
foreach ($name in $values.Keys) { if ($PSBoundParameters[$name]) { $engineArgs += $values[$name], $PSBoundParameters[$name] } }
if ($Project) { $engineArgs += '--project', $Project }
if ($Migrate) { $engineArgs += '--migrate', $Migrate }
if ($Rest) { $engineArgs += $Rest }

& node (Join-Path $Src 'scripts\lean.mjs') @engineArgs
$code = $LASTEXITCODE
if ($tmp) { Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue }

# After the engine, because its uninstall still needs rtk on PATH.
if ($Uninstall -and -not $DryRun -and $code -eq 0 -and $userPath -contains $rtkDir) {
  [Environment]::SetEnvironmentVariable('Path', (($userPath | Where-Object { $_ -ne $rtkDir }) -join ';'), 'User')
  Write-Output "Removed $rtkDir from your user PATH."
}

# throw, not exit: piped into a scriptblock, exit would close the user's shell.
if ($code -ne 0) { throw "lean-agents: the engine exited with code $code" }
