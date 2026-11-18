# Native PowerShell half of tests/real-upgrade-opencode.sh (#80 part 2, P3): real OpenCode 1.19 (-Binary, default `opencode` on PATH),
# three sessions seeded through the local mock LLM (tests/fixtures/mock-llm.mjs, read only, no login), then
# `--upgrade-agent opencode --backup`: the dry run leaves the whole HOME tree unchanged, the apply makes a backup and a
# frozen copy whose sha256 equal the live files (3 sessions counted on a temp copy), and a run while `opencode serve` is up is refused.
# Then `--opencode1` (P4): opencode1.cmd reports 1.19.0 from cmd and from Git Bash (through the user PATH), a new session made
# through it lands in the frozen copy (3 -> 4) while the live data hash stays equal, and `--uninstall` removes the shim, the copy and
# the PATH entry but keeps the backup and the frozen copy.
param([string]$Binary = 'opencode')
$opencodeBin = $Binary
$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot
$root = Join-Path ([IO.Path]::GetTempPath()) "p3-$([guid]::NewGuid())"
$live = Join-Path $root 'home'
$proj = Join-Path $root 'proj'
$data = "$live\.local\share\opencode"
$cfgDir = "$live\.config\opencode"
$leanDir = "$live\.local\share\lean-agents"
New-Item -ItemType Directory -Force -Path $cfgDir, $proj | Out-Null

$saved = @{}
foreach ($n in 'HOME', 'USERPROFILE', 'XDG_DATA_HOME', 'XDG_STATE_HOME', 'XDG_CONFIG_HOME', 'OPENCODE_DB', 'OPENCODE_CONFIG_DIR', 'Path') { $saved[$n] = [Environment]::GetEnvironmentVariable($n) }
function Use-Env([hashtable]$vars) { foreach ($k in $vars.Keys) { [Environment]::SetEnvironmentVariable($k, $vars[$k]) } }
function Restore-Env { foreach ($k in $saved.Keys) { [Environment]::SetEnvironmentVariable($k, $saved[$k]) } }

# Relative path -> sha256 for every file under $dir (skipping $skip, a relative folder); $filter 'data' keeps only what the backup copies.
function Get-FileMap([string]$dir, [string]$skip, [string]$filter) {
  $map = @{}
  if (-not (Test-Path $dir)) { return $map }
  foreach ($f in Get-ChildItem $dir -Recurse -File) {
    $rel = $f.FullName.Substring($dir.Length).TrimStart('\').Replace('\', '/')
    if ($skip -and $rel.StartsWith($skip)) { continue }
    if ($rel -match '(^|/)node_modules/') { continue } # the backup leaves it out
    if ($filter -eq 'data' -and $rel -notmatch '^(opencode\.db(-wal|-shm)?$|storage/|snapshot/)') { continue }
    $map[$rel] = (Get-FileHash $f.FullName -Algorithm SHA256).Hash
  }
  return $map
}
function Get-Tree([string]$dir, [string]$skip) { $m = Get-FileMap $dir $skip ''; return (($m.Keys | Sort-Object | ForEach-Object { "${_}:$($m[$_])" }) -join "`n") }
function Test-SameFile([string]$a, [string]$b, [string]$filter) {
  $x = Get-FileMap $a '' $filter; $y = Get-FileMap $b '' $filter
  if ($x.Count -eq 0 -or $x.Count -ne $y.Count) { return $false }
  foreach ($k in $x.Keys) { if ($x[$k] -ne $y[$k]) { return $false } }
  return $true
}
# Windows PowerShell 5.1 turns native stderr into a terminating error under 'Stop', so native calls run under 'Continue'.
function Invoke-OpenCode {
  $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  try { & $opencodeBin @args 2>&1 | Where-Object { $_ -isnot [System.Management.Automation.ErrorRecord] } } finally { $ErrorActionPreference = $prev }
}
function Invoke-Lean {
  $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  try {
    $out = & node "$repo\scripts\lean.mjs" --home $live --no-exec --upgrade-agent opencode --backup @args 2>&1 | ForEach-Object { "$_" }
    return [pscustomobject]@{ Code = $LASTEXITCODE; Text = ($out -join "`n") }
  } finally { $ErrorActionPreference = $prev }
}
function Invoke-LeanSide {
  $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  try {
    $out = & node "$repo\scripts\lean.mjs" --home $live --upgrade-agent opencode --opencode1 @args 2>&1 | ForEach-Object { "$_" }
    return [pscustomobject]@{ Code = $LASTEXITCODE; Text = ($out -join "`n") }
  } finally { $ErrorActionPreference = $prev }
}
function Invoke-LeanUninstall {
  $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  try {
    $out = & node "$repo\scripts\lean.mjs" --home $live --no-exec --uninstall --yes 2>&1 | ForEach-Object { "$_" }
    return [pscustomobject]@{ Code = $LASTEXITCODE; Text = ($out -join "`n") }
  } finally { $ErrorActionPreference = $prev }
}
# The user PATH as stored (unexpanded), like install.ps1 reads it.
function Get-UserPathRaw {
  $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment')
  try { [string]$key.GetValue('Path', '', [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames) } finally { $key.Close() }
}
# What a new terminal would see: machine + user PATH from the registry.
function Get-FreshPath { return (@('Machine', 'User' | ForEach-Object { [Environment]::GetEnvironmentVariable('Path', $_) }) -join ';') }
function Invoke-Cmd([string]$line) {
  $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  try { return ((& cmd.exe /d /c $line 2>&1 | ForEach-Object { "$_" }) -join "`n").Trim() } finally { $ErrorActionPreference = $prev }
}
# Same count as the engine (COUNT_SCRIPT in scripts/lib/adopt.mjs): node:sqlite on a COPY of the db (+wal/shm), never the original.
$countScript = "const{DatabaseSync}=require('node:sqlite');const d=new DatabaseSync(process.argv[1],{readOnly:true});console.log(d.prepare('SELECT count(*) AS n FROM session').get().n)"
function Get-SessionCount([string]$dataDir) {
  $db = Join-Path $dataDir 'opencode.db'
  if (-not (Test-Path $db)) { return -1 }
  $tmp = Join-Path $root "count-$([guid]::NewGuid())"
  New-Item -ItemType Directory -Force -Path $tmp | Out-Null
  $prev = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  try {
    foreach ($ext in '', '-wal', '-shm') { if (Test-Path "$db$ext") { Copy-Item "$db$ext" "$tmp\c.db$ext" } }
    $out = (& node -e $countScript "$tmp\c.db" 2>$null | Out-String).Trim()
    if ($out -match '^\d+$') { return [int]$out } else { return -1 }
  } finally { $ErrorActionPreference = $prev; Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue }
}
$failed = $false
function Assert-That([string]$label, [bool]$ok) {
  Write-Output "$(if ($ok) { 'ok   ' } else { 'FAIL ' }) $label"
  if (-not $ok) { $script:failed = $true }
}

$mockLog = Join-Path $root 'mock.log'
$env:MOCK_LLM_PORT = '0'; $env:MOCK_LLM_COMMAND = 'echo seed'; $env:MOCK_LLM_TOOL = 'bash'
$mock = Start-Process node -ArgumentList "`"$repo\tests\fixtures\mock-llm.mjs`"" -RedirectStandardOutput $mockLog -NoNewWindow -PassThru
$serve = $null
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
  [IO.File]::WriteAllText("$cfgDir\opencode.jsonc", ($cfg | ConvertTo-Json -Depth 8))
  Set-Location $proj
  Use-Env @{ HOME = $live; USERPROFILE = $live; XDG_DATA_HOME = $null; XDG_STATE_HOME = $null; XDG_CONFIG_HOME = $null; OPENCODE_DB = $null; OPENCODE_CONFIG_DIR = $null }

  Write-Output '== seed 3 sessions on real 1.19'
  foreach ($i in 1, 2, 3) { Invoke-OpenCode run "seed $i" --model mock/mock-model | Out-Null }
  for ($i = 0; $i -lt 20 -and (Get-Process -Name opencode -ErrorAction SilentlyContinue); $i++) { Start-Sleep -Seconds 1 }
  $n0 = Get-SessionCount $data
  Write-Output "live sessions: $n0"
  if ($n0 -ne 3) { throw 'expected 3 live sessions' }
  $skip = '.local/share/lean-agents'
  $before = Get-Tree $live $skip

  Write-Output '== dry run changes nothing'
  $dry = Invoke-Lean --dry-run
  Write-Output $dry.Text
  Assert-That 'dry run exits 0 and names 3 sessions' (($dry.Code -eq 0) -and ($dry.Text -match '3 sessions'))
  Assert-That 'whole HOME tree unchanged by the dry run' ((Get-Tree $live $skip) -eq $before)
  Assert-That 'no lean-agents folder after the dry run' (-not (Test-Path $leanDir))

  Write-Output '== apply: permanent backup + frozen copy'
  $apply = Invoke-Lean --yes
  Write-Output $apply.Text
  Assert-That 'apply exits 0' ($apply.Code -eq 0)
  $bk = @(Get-ChildItem "$leanDir\backups" -Directory -Filter 'opencode1-sessions-*' -ErrorAction SilentlyContinue)
  Assert-That 'one backup folder' ($bk.Count -eq 1)
  if ($bk.Count -eq 1) {
    $frozen = "$leanDir\opencode1\data\opencode"
    Assert-That 'RESTORE.md and MANIFEST.sha256 written' ((Test-Path "$($bk[0].FullName)\RESTORE.md") -and (Test-Path "$($bk[0].FullName)\MANIFEST.sha256"))
    Assert-That 'backup data sha256 = live data' (Test-SameFile $data "$($bk[0].FullName)\data" 'data')
    Assert-That 'backup config sha256 = live config' (Test-SameFile $cfgDir "$($bk[0].FullName)\config" '')
    Assert-That 'frozen copy sha256 = live data' (Test-SameFile $data $frozen 'data')
    Assert-That 'backup has 3 sessions (temp copy)' ((Get-SessionCount "$($bk[0].FullName)\data") -eq 3)
    Assert-That 'frozen copy has 3 sessions (temp copy)' ((Get-SessionCount $frozen) -eq 3)
  }
  Assert-That 'everything outside lean-agents byte-identical' ((Get-Tree $live $skip) -eq $before)
  $again = Invoke-Lean --yes
  Assert-That 'a second apply is refused (frozen copy exists)' ($again.Code -eq 1)

  Write-Output '== opencode1: binary copy + shim + user PATH (P4)'
  $oc1 = "$leanDir\opencode1"
  $pathBefore = Get-UserPathRaw
  $dataTree = Get-Tree $data ''
  $side = Invoke-LeanSide --dry-run
  Write-Output $side.Text
  Assert-That 'opencode1 dry run exits 0 and names 1.19.0' (($side.Code -eq 0) -and ($side.Text -match 'OpenCode 1\.19\.0'))
  Assert-That 'dry run leaves the user PATH unchanged and makes no binary copy' (((Get-UserPathRaw) -eq $pathBefore) -and (-not (Test-Path "$oc1\1.19.0")))
  $side = Invoke-LeanSide --yes
  Write-Output $side.Text
  Assert-That 'opencode1 apply exits 0' ($side.Code -eq 0)
  Assert-That 'binary copied to opencode1\1.19.0' (Test-Path "$oc1\1.19.0\opencode.exe")
  Assert-That 'opencode1.cmd and the sh shim written' ((Test-Path "$oc1\bin\opencode1.cmd") -and (Test-Path "$oc1\bin\opencode1"))
  Assert-That 'user PATH (HKCU, unexpanded) holds the shim folder' ((Get-UserPathRaw).Split(';') -contains "$oc1\bin")
  Assert-That 'cmd: opencode1.cmd --version = 1.19.0 (by path)' ((Invoke-Cmd "$oc1\bin\opencode1.cmd --version").EndsWith('1.19.0'))
  $env:Path = Get-FreshPath
  Assert-That 'cmd: opencode1 --version = 1.19.0 (found through the new user PATH)' ((Invoke-Cmd 'opencode1 --version').EndsWith('1.19.0'))
  $gitBash = Join-Path $env:ProgramFiles 'Git\bin\bash.exe'
  if (Test-Path $gitBash) {
    $prevEap = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    $gb = ((& $gitBash -c 'opencode1 --version' 2>&1 | ForEach-Object { "$_" }) -join "`n").Trim()
    $ErrorActionPreference = $prevEap
    Assert-That 'Git Bash: opencode1 --version = 1.19.0 (the sh shim)' ($gb.EndsWith('1.19.0'))
  } else { Write-Output 'skip  Git Bash not found' }
  Assert-That 'frozen copy still has 3 sessions' ((Get-SessionCount "$leanDir\opencode1\data\opencode") -eq 3)
  Set-Location $proj
  $prevEap = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  $oc1run = Start-Process "$oc1\bin\opencode1.cmd" -ArgumentList 'run', '"from opencode1"', '--model', 'mock/mock-model' -NoNewWindow -PassThru -RedirectStandardOutput "$root\oc1-run.out" -RedirectStandardError "$root\oc1-run.err"
  if (-not $oc1run.WaitForExit(120000)) { Stop-Process -Id $oc1run.Id -Force; Write-Output '  (opencode1 run killed after 120 s)' }
  $ErrorActionPreference = $prevEap
  Set-Location $repo
  for ($i = 0; $i -lt 20 -and (Get-Process -Name opencode -ErrorAction SilentlyContinue); $i++) { Start-Sleep -Seconds 1 }
  Assert-That 'the new 1.x session landed in the frozen copy (3 -> 4)' ((Get-SessionCount "$leanDir\opencode1\data\opencode") -eq 4)
  Assert-That 'live data hash unchanged by opencode1 (still 3 sessions)' (((Get-Tree $data '') -eq $dataTree) -and ((Get-SessionCount $data) -eq 3))
  $un = Invoke-LeanUninstall
  Write-Output $un.Text
  Assert-That 'uninstall exits 0' ($un.Code -eq 0)
  Assert-That 'binary copy and shim folder removed' ((-not (Test-Path "$oc1\1.19.0")) -and (-not (Test-Path "$oc1\bin")))
  Assert-That 'user PATH entry removed, the rest of the PATH untouched' ((Get-UserPathRaw).TrimEnd(';') -eq $pathBefore.TrimEnd(';'))
  Assert-That 'frozen copy kept (4 sessions) and the backup kept' (((Get-SessionCount "$leanDir\opencode1\data\opencode") -eq 4) -and (Test-Path "$($bk[0].FullName)\MANIFEST.sha256"))

  Write-Output '== refused while an opencode process runs'
  # npm installs an extensionless sh shim next to opencode.cmd; Start-Process needs the .cmd (or .exe).
  $serveBin = (Get-Command $opencodeBin -CommandType Application | Where-Object { $_.Extension -in '.exe', '.cmd' } | Select-Object -First 1).Source
  $serve = Start-Process $serveBin -ArgumentList 'serve', '--port', (Get-Random -Minimum 20000 -Maximum 60000), '--hostname', '127.0.0.1' -NoNewWindow -PassThru
  for ($i = 0; $i -lt 20 -and -not (Get-Process -Name opencode -ErrorAction SilentlyContinue); $i++) { Start-Sleep -Seconds 1 }
  $busy = Invoke-Lean --dry-run
  Assert-That 'exit 1 and names the running process while opencode serve runs' (($busy.Code -eq 1) -and ($busy.Text -match 'process is running'))
} finally {
  Restore-Env
  Set-Location $repo
  # A failed assert must not leave our entry in the machine's user PATH: undo through the engine, which knows what it added.
  if ($oc1 -and ((Get-UserPathRaw).Split(';') -contains "$oc1\bin")) { Invoke-LeanUninstall | Out-Null }
  if ($serve -and -not $serve.HasExited) { Stop-Process -Id $serve.Id -Force }
  # CI only: stopping by image name would also hit a developer's own sessions.
  if ($env:CI) { Get-Process -Name opencode -ErrorAction SilentlyContinue | Stop-Process -Force }
  if ($mock -and -not $mock.HasExited) { Stop-Process -Id $mock.Id -Force }
  Remove-Item $root -Recurse -Force -ErrorAction SilentlyContinue
}
if ($failed) { throw 'real-upgrade-opencode failed (see the FAIL lines above)' }
Write-Output 'real-upgrade-opencode ps1 OK'
# A native command earlier leaves a non-zero $LASTEXITCODE (the refused runs are expected); the step must report the script's result.
exit 0
