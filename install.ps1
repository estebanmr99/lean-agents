# lean-agents bootstrap for Windows (PowerShell 5.1 and 7).
# Makes sure Node.js 22.20+ exists (git is not needed: the release is an npm tarball), downloads the latest
# release, checks it against the release's SHA256SUMS, then hands over to the Node engine (scripts/lean.mjs),
# which shows the full plan before changing anything. Node users can skip this: npx lean-agents@latest
# No Node yet: winget (user scope), or without winget the nodejs.org zip (SHA-256 checked) in
# %USERPROFILE%\tools\node. Never needs admin. A -DryRun without Node uses a temporary copy and keeps your profile clean.
#
#   & ([scriptblock]::Create((irm https://github.com/estebanmr99/lean-agents/releases/latest/download/install.ps1))) -DryRun
#
# Env: LEAN_AGENTS_VERSION=0.7.0 pins a release; LEAN_AGENTS_DIST=<folder or https url> reads the release
# files from there instead (CI and mirrors; prints a warning); LEAN_AGENTS_SRC moves the install folder;
# LEAN_AGENTS_NODE_DIST does the same for the Node.js zip. Downloads honor HTTPS_PROXY and NO_PROXY (read from the
# environment, never saved) and otherwise the Windows system proxy.
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

function Get-Sha256($Path) { (Get-FileHash -Algorithm SHA256 -LiteralPath $Path).Hash.ToLower() }

function Initialize-TempDir {
  $dir = Join-Path ([IO.Path]::GetTempPath()) ([guid]::NewGuid().ToString())
  New-Item -ItemType Directory -Path $dir | Out-Null
  $dir
}

# Windows PowerShell 5.1 offers TLS 1.0/1.1 by default; GitHub and nodejs.org need 1.2. It also does not send
# your Windows login to an authenticating system proxy unless asked, so it is asked here.
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
if ($PSVersionTable.PSVersion.Major -lt 6 -and [Net.WebRequest]::DefaultWebProxy) {
  [Net.WebRequest]::DefaultWebProxy.Credentials = [Net.CredentialCache]::DefaultNetworkCredentials
}

# NO_PROXY as curl and Node read it: comma-separated host names; a leading dot or * matches subdomains, * alone matches
# everything. shortcut: no CIDR or IPv6 ranges, add them when a user needs them.
function Test-NoProxy($HostName, $NoProxy) {
  foreach ($entry in @($NoProxy -split '[,;\s]+' | Where-Object { $_ })) {
    if ($entry -eq '*') { return $true }
    $suffix = ($entry -replace ':\d+$', '').TrimStart('*').TrimStart('.').ToLower()
    if ($HostName -eq $suffix -or $HostName.EndsWith(".$suffix")) { return $true }
  }
  $false
}

# The proxy for a URL from HTTPS_PROXY unless NO_PROXY excludes its host; nothing means "use the system proxy"
# (Invoke-WebRequest has no switch for a direct connection).
function Get-ProxyUrl($Uri) {
  if ($env:HTTPS_PROXY -and -not (Test-NoProxy ([uri]$Uri).Host $env:NO_PROXY)) { $env:HTTPS_PROXY }
}

function Invoke-Download($Uri, $Out) {
  $ProgressPreference = 'SilentlyContinue'
  $web = @{ UseBasicParsing = $true; Uri = $Uri; OutFile = $Out }
  $proxy = Get-ProxyUrl $Uri
  if ($proxy) { $web.Proxy = $proxy; $web.ProxyUseDefaultCredentials = $true }
  try { Invoke-WebRequest @web }
  catch {
    # The proxy URL can hold a password, so it is never printed.
    throw "lean-agents: could not download $Uri ($($_.Exception.Message)). Behind a proxy? Set HTTPS_PROXY (and NO_PROXY) or the Windows system proxy. PowerShell trusts the Windows certificate store, not NODE_EXTRA_CA_CERTS, so a TLS-inspecting proxy's CA must be installed there."
  }
}

# Base is an https URL or a folder (CI and mirrors).
function Get-File($Base, $Name, $Out) {
  if ($Base -match '^https://') { Invoke-Download "$Base/$Name" $Out } else { Copy-Item -LiteralPath (Join-Path $Base $Name) -Destination $Out }
}

# The user PATH is read and written unexpanded (the registry value), so %VARS% in it survive; .NET's
# GetEnvironmentVariable would freeze them. Pure helpers first, then the registry access.
function Get-PathWith($Raw, $Dir) {
  $parts = @($Raw -split ';' | Where-Object { $_ })
  $same = @($parts | Where-Object { [Environment]::ExpandEnvironmentVariables($_).TrimEnd('\') -eq $Dir.TrimEnd('\') })
  if ($same.Count) { $Raw } else { ($parts + $Dir) -join ';' }
}
function Get-PathWithout($Raw, $Dir) {
  @($Raw -split ';' | Where-Object { $_ -and [Environment]::ExpandEnvironmentVariables($_).TrimEnd('\') -ne $Dir.TrimEnd('\') }) -join ';'
}
function Get-UserPath {
  $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment')
  try { [string]$key.GetValue('Path', '', [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames) } finally { $key.Close() }
}
function Write-UserPath($Value) {
  $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment', $true)
  try { $key.SetValue('Path', $Value, [Microsoft.Win32.RegistryValueKind]::ExpandString) } finally { $key.Close() }
  # Registry writes do not notify other programs; setting and clearing a user variable makes Windows broadcast the change. VERIFY
  [Environment]::SetEnvironmentVariable('LEAN_AGENTS_PATH_REFRESH', '1', 'User')
  [Environment]::SetEnvironmentVariable('LEAN_AGENTS_PATH_REFRESH', $null, 'User')
}
# True when the entry was added or removed.
function Write-UserPathWith($Dir) {
  $raw = Get-UserPath
  $new = Get-PathWith $raw $Dir
  if ($new -eq $raw) { return $false }
  Write-UserPath $new
  $true
}
function Write-UserPathWithout($Dir) {
  $raw = Get-UserPath
  # Present when adding it would change nothing; otherwise leave the PATH alone (even if it has empty segments).
  if ((Get-PathWith $raw $Dir) -ne $raw) { return $false }
  Write-UserPath (Get-PathWithout $raw $Dir)
  $true
}

# Node.js zip from nodejs.org: no admin, no winget. SHASUMS256.txt in the same folder names the newest 24.x and the
# zip's SHA-256 (a corruption check from the same origin as the zip, not authenticity). 24 is what Context Mode and
# GSD need; the engine itself runs on 22.20+. VERIFY on a machine with neither winget nor Node.
$NodeMajor = 24
$nodeHome = Join-Path $env:USERPROFILE 'tools\node'
$nodeStamp = Join-Path $nodeHome '.lean-agents-node'
function Install-NodeZip($Dest) {
  if ((Test-Path $Dest) -and -not (Test-Path (Join-Path $Dest '.lean-agents-node')) -and (Get-ChildItem -Force $Dest)) {
    throw "lean-agents: $Dest exists and was not made by lean-agents. Move it away and run this again."
  }
  $cpu = if ($env:PROCESSOR_ARCHITEW6432) { $env:PROCESSOR_ARCHITEW6432 } else { $env:PROCESSOR_ARCHITECTURE }
  $arch = switch ($cpu) { 'AMD64' { 'x64' } 'ARM64' { 'arm64' } default { throw "lean-agents: there is no portable Node.js for $cpu. Install Node.js 22.20+ from https://nodejs.org/ and run this again." } }
  if ($env:LEAN_AGENTS_NODE_DIST) {
    $base = $env:LEAN_AGENTS_NODE_DIST.TrimEnd('/', '\')
    Write-Warning "lean-agents: LEAN_AGENTS_NODE_DIST is set, so Node.js comes from $base and not from nodejs.org."
  } else {
    $base = "https://nodejs.org/dist/latest-v$NodeMajor.x"
  }
  $work = Initialize-TempDir
  try {
    Get-File $base 'SHASUMS256.txt' (Join-Path $work 'SHASUMS256.txt')
    $line = Get-Content (Join-Path $work 'SHASUMS256.txt') | Where-Object { $_ -match "^[0-9a-f]{64}  node-v\d+\.\d+\.\d+-win-$arch\.zip$" } | Select-Object -First 1
    if (-not $line) { throw "lean-agents: SHASUMS256.txt has no win-$arch zip." }
    $want, $zip = $line -split '  '
    Get-File $base $zip (Join-Path $work $zip)
    $got = Get-Sha256 (Join-Path $work $zip)
    if ($got -ne $want) { throw "lean-agents: checksum mismatch for $zip (expected $want, got $got). Nothing was installed." }
    # tar is not used here: a GNU tar earlier on PATH (Git for Windows) cannot read zip files.
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [IO.Compression.ZipFile]::ExtractToDirectory((Join-Path $work $zip), (Join-Path $work 'x'))
    $inner = Join-Path $work ('x\' + ($zip -replace '\.zip$', ''))
    if (-not (Test-Path (Join-Path $inner 'node.exe'))) { throw "lean-agents: $zip has no node.exe." }
    New-Item -ItemType Directory -Force -Path (Split-Path $Dest) | Out-Null
    if (Test-Path $Dest) { Remove-Item -Recurse -Force $Dest }
    Move-Item $inner $Dest
    Set-Content -Path (Join-Path $Dest '.lean-agents-node') -Value $zip -Encoding ascii
  } finally {
    Remove-Item -Recurse -Force $work -ErrorAction SilentlyContinue
  }
}

$nodeTmp = $null
if (-not (Test-Command 'node') -and (Test-Path $nodeStamp)) { $env:Path = "$nodeHome;$env:Path" }
if (-not (Test-Command 'node')) {
  $nodeHelp = 'lean-agents: Node.js is required for the engine. Install Node.js 22.20+ from https://nodejs.org/ and run this again.'
  if ($DryRun) {
    # The plan comes from the engine, which needs Node: preview with a throwaway copy that leaves PATH and the profile alone.
    Write-Output 'Node.js is missing. This dry run uses a temporary copy from nodejs.org and changes nothing on your machine.'
    $nodeTmp = Initialize-TempDir
    try { Install-NodeZip (Join-Path $nodeTmp 'node') } catch { Remove-Item -Recurse -Force $nodeTmp -ErrorAction SilentlyContinue; throw }
    $env:Path = "$(Join-Path $nodeTmp 'node');$env:Path"
  } else {
    if (Test-Command 'winget') {
      $wingetArgs = @('install', '--id', 'OpenJS.NodeJS.LTS', '-e', '--scope', 'user', '--accept-source-agreements', '--accept-package-agreements')
      if (-not $Yes -and (Read-Host "Node.js is missing. Install it with 'winget $($wingetArgs -join ' ')'? [y/N]") -notmatch '^(y|yes|s|si)$') { throw $nodeHelp }
      & winget @wingetArgs
      if ($LASTEXITCODE -ne 0) { Write-Warning 'lean-agents: winget could not install Node.js; trying the nodejs.org zip instead.' }
      $env:Path = @('Machine', 'User' | ForEach-Object { [Environment]::GetEnvironmentVariable('Path', $_) }) -join ';'
    }
    if (-not (Test-Command 'node')) {
      if (-not $Yes -and (Read-Host "Node.js is missing. Download the Node.js $NodeMajor zip from nodejs.org into $nodeHome (your user only, no admin)? [y/N]") -notmatch '^(y|yes|s|si)$') { throw $nodeHelp }
      Install-NodeZip $nodeHome
      $env:Path = "$nodeHome;$env:Path"
      if (Write-UserPathWith $nodeHome) { Write-Output "Added $nodeHome to your user PATH. Open a new terminal after this install." }
    }
  }
}
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
  # An old bootstrap clone is clean, on one branch and fully pushed, so it goes. Anything else (local changes,
  # no upstream, unpushed commits, a stash, extra branches) or any clone the user pointed LEAN_AGENTS_SRC at stays.
  if (Test-Path (Join-Path $Src '.git')) {
    $keep = $null
    # Git writes warnings and "no upstream" to stderr, which would stop a 5.1 script before the message below.
    $ErrorActionPreference = 'Continue'
    if ($env:LEAN_AGENTS_SRC) {
      $keep = 'LEAN_AGENTS_SRC points at a git clone'
    } elseif (-not (Test-Command 'git')) {
      # git is not a prerequisite, so without it nothing can prove the clone holds no work.
      $keep = 'git is not installed, so it cannot be checked'
    } else {
      $dirty = git -C $Src status --porcelain 2>&1
      if ($LASTEXITCODE -ne 0 -or $dirty) {
        $keep = 'it has local changes (or git cannot read it)'
      } else {
        $unpushed = git -C $Src log '@{u}..' --oneline 2>$null
        $unpushedCode = $LASTEXITCODE
        $stash = git -C $Src stash list 2>$null
        $branches = @(git -C $Src for-each-ref refs/heads 2>$null)
        if ($unpushedCode -ne 0) {
          $keep = 'it has no upstream branch'
        } elseif ($unpushed) {
          $keep = 'it has commits that are not pushed'
        } elseif ($stash) {
          $keep = 'it has a stash'
        } elseif ($branches.Count -gt 1) {
          $keep = 'it has more than one local branch'
        }
      }
    }
    $ErrorActionPreference = 'Stop'
    if ($keep) { throw "lean-agents: $Src is a git clone and is left alone ($keep). Move it away, or set LEAN_AGENTS_SRC to another folder." }
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
  $tmp = Initialize-TempDir
  try {
    Get-File $base 'SHA256SUMS' (Join-Path $tmp 'SHA256SUMS')
    $line = Get-Content (Join-Path $tmp 'SHA256SUMS') | Where-Object { $_ -match '^[0-9a-f]{64}  lean-agents-[0-9A-Za-z._-]+\.tgz$' } | Select-Object -First 1
    if (-not $line) { throw 'lean-agents: SHA256SUMS has no lean-agents tarball.' }
    $want, $name = $line -split '  '
    $version = $name -replace '^lean-agents-', '' -replace '\.tgz$', ''
    if ((Test-Path $stamp) -and (Test-Path (Join-Path $Src 'scripts\lean.mjs')) -and ((Get-Content $stamp -Raw).Trim() -eq $want)) {
      Write-Output "lean-agents v$version already installed."
    } else {
      Get-File $base $name (Join-Path $tmp $name)
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
if (-not $DryRun -and (Test-Path (Join-Path $rtkDir 'rtk.exe'))) {
  if (-not $Uninstall -and (Write-UserPathWith $rtkDir)) { Write-Output "Added $rtkDir to your user PATH. Open a new terminal after this install." }
  if (-not (Test-Command 'rtk')) { $env:Path += ";$rtkDir" }
}

# -Everything (#179 PR2) is not wired yet. When the engine has its --everything preset, add the switch to param()
# and `Everything = '--everything'` to $switches below; until then `--everything` passes through $Rest.
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
if ($nodeTmp) { Remove-Item -Recurse -Force $nodeTmp -ErrorAction SilentlyContinue }

# After the engine, because its uninstall still needs rtk and Node on PATH.
if ($Uninstall -and -not $DryRun -and $code -eq 0) {
  if (Write-UserPathWithout $rtkDir) { Write-Output "Removed $rtkDir from your user PATH." }
  if (Test-Path $nodeStamp) {
    Write-UserPathWithout $nodeHome | Out-Null
    Remove-Item -Recurse -Force $nodeHome
    Write-Output "Removed the Node.js that this installer put in $nodeHome."
  }
}

# throw, not exit: piped into a scriptblock, exit would close the user's shell.
if ($code -ne 0) { throw "lean-agents: the engine exited with code $code" }
