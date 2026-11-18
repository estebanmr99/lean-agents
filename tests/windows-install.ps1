# Checks install.ps1 in throwaway USERPROFILE folders, with no external commands (--no-exec).
# The Node.js zip fallback runs against a fake nodejs.org folder (LEAN_AGENTS_NODE_DIST). Used by CI on PowerShell 5.1 and 7.
$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot

function Initialize-TempProfile {
  $dir = Join-Path $env:RUNNER_TEMP ([guid]::NewGuid().ToString())
  New-Item -ItemType Directory -Path $dir | Out-Null
  $env:USERPROFILE = $dir
  $env:APPDATA = "$dir\AppData\Roaming"
  $dir
}

function Assert-That($Condition, $Message) { if (-not $Condition) { throw "FAIL: $Message" } }

# Dot-source install.ps1's helpers (running the script would install things). The names are the contract.
$ast = [Management.Automation.Language.Parser]::ParseFile("$repo\install.ps1", [ref]$null, [ref]$null)
foreach ($name in 'Test-NoProxy', 'Get-ProxyUrl', 'Get-PathWith', 'Get-PathWithout', 'Get-UserPath', 'Write-UserPath') {
  $fn = $ast.Find({ param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $name }, $true)
  Assert-That $fn "install.ps1 has no function $name"
  . ([scriptblock]::Create($fn.Extent.Text))
}

Write-Output '--- NO_PROXY and HTTPS_PROXY'
Assert-That (Test-NoProxy 'api.corp.example' 'localhost, .corp.example') 'a leading dot matches subdomains'
Assert-That (Test-NoProxy 'api.corp.example' '*.corp.example') '*. matches subdomains'
Assert-That (Test-NoProxy 'localhost' 'localhost:8080') 'a port is ignored'
Assert-That (Test-NoProxy 'anything.test' '*') '* matches everything'
Assert-That (-not (Test-NoProxy 'notcorp.example' '.corp.example')) 'a partial label must not match'
Assert-That (-not (Test-NoProxy 'github.com' '')) 'empty NO_PROXY matches nothing'
$savedProxy = @{ HTTPS_PROXY = $env:HTTPS_PROXY; NO_PROXY = $env:NO_PROXY }
try {
  $env:HTTPS_PROXY = 'http://proxy.invalid:3128'
  $env:NO_PROXY = 'nodejs.org'
  Assert-That ((Get-ProxyUrl 'https://github.com/x') -eq 'http://proxy.invalid:3128') 'HTTPS_PROXY is used'
  Assert-That ($null -eq (Get-ProxyUrl 'https://nodejs.org/dist')) 'NO_PROXY hosts do not use HTTPS_PROXY'
  Remove-Item Env:HTTPS_PROXY
  Assert-That ($null -eq (Get-ProxyUrl 'https://github.com/x')) 'no HTTPS_PROXY means the system proxy (null)'
} finally {
  $env:HTTPS_PROXY = $savedProxy.HTTPS_PROXY
  $env:NO_PROXY = $savedProxy.NO_PROXY
}

Write-Output '--- user PATH edits keep %VARS% and never duplicate'
$raw = '%USERPROFILE%\bin;D:\tools\x'
Assert-That ((Get-PathWith $raw 'D:\tools\x\') -eq $raw) 'an entry that is already there is not added again'
Assert-That ((Get-PathWith $raw 'D:\tools\y') -eq "$raw;D:\tools\y") 'a new entry is appended, %USERPROFILE% untouched'
Assert-That ((Get-PathWithout "$raw;D:\tools\y" 'D:\tools\y') -eq $raw) 'removing the entry restores the original'
Assert-That ((Get-PathWithout $raw (Join-Path $env:USERPROFILE 'bin')) -eq 'D:\tools\x') 'an unexpanded entry matches its expansion'

Write-Output '--- dry run from a file changes nothing'
$dir = Initialize-TempProfile
& "$repo\install.ps1" -DryRun -Yes -Agents claude, opencode-v1 -AllTools -Privacy strict -Profile vertex-gemini -Lang en --no-exec
if (Get-ChildItem -Force $dir) { throw 'dry run wrote to USERPROFILE' }

Write-Output '--- -NoBun turns Bun off in the plan'
$dir = Initialize-TempProfile
# The Bun line only exists when Context Mode is planned, which needs Node 24.15+; fake it so Node 22 still checks the flag.
$env:LEAN_AGENTS_NODE = '24.22.2'
$plan = & "$repo\install.ps1" -DryRun -Yes -Agents claude -NoBun -Privacy standard -Lang en --no-exec | Out-String
Remove-Item Env:LEAN_AGENTS_NODE
if ($plan -notmatch 'bun: off') { throw "-NoBun did not reach the engine: $plan" }

Write-Output '--- install, doctor and uninstall'
$dir = Initialize-TempProfile
& "$repo\install.ps1" -Yes -Agents claude, opencode-v1 -AllTools -Privacy strict -Profile anthropic-api -Lang en --no-exec
& "$repo\install.ps1" -Doctor --no-exec
& "$repo\install.ps1" -Uninstall -Yes --no-exec
$left = @(Get-ChildItem -Recurse -File -Force $dir | Where-Object { $_.FullName -notlike '*\.config\lean-agents\*' })
if ($left) { throw "uninstall left files: $($left.FullName)" }

Write-Output '--- no Node and no winget: the nodejs.org zip (dry run keeps the profile empty, install and uninstall are undone)'
$savedPath = $env:Path
$arch = if ($env:PROCESSOR_ARCHITEW6432) { $env:PROCESSOR_ARCHITEW6432 } else { $env:PROCESSOR_ARCHITECTURE }
$pkg = "node-v24.0.0-win-$(if ($arch -eq 'ARM64') { 'arm64' } else { 'x64' })"
$fake = Join-Path $env:RUNNER_TEMP ([guid]::NewGuid().ToString())
New-Item -ItemType Directory -Path "$fake\src\$pkg" | Out-Null
Copy-Item (Get-Command node).Source "$fake\src\$pkg\node.exe"
Add-Type -AssemblyName System.IO.Compression.FileSystem
[IO.Compression.ZipFile]::CreateFromDirectory("$fake\src", "$fake\$pkg.zip")
Set-Content -Path "$fake\SHASUMS256.txt" -Value "$((Get-FileHash -Algorithm SHA256 "$fake\$pkg.zip").Hash.ToLower())  $pkg.zip" -Encoding ascii
$env:LEAN_AGENTS_NODE_DIST = $fake
$noNode = @($env:Path -split ';' | Where-Object { $_ -and -not (Test-Path (Join-Path $_ 'node.exe')) -and -not (Test-Path (Join-Path $_ 'winget.exe')) }) -join ';'
$userPathBefore = Get-UserPath
try {
  $dir = Initialize-TempProfile
  $env:Path = $noNode
  $plan = & "$repo\install.ps1" -DryRun -Yes -Agents claude -NoTools -Privacy standard -Lang en --no-exec 3>$null | Out-String
  Assert-That ($plan -match 'temporary copy') "dry run did not use a temporary Node: $plan"
  Assert-That (-not (Get-ChildItem -Force $dir)) 'dry run without Node wrote to USERPROFILE'

  $env:Path = $noNode
  & "$repo\install.ps1" -Yes -Agents claude -NoTools -Privacy standard -Lang en --no-exec 3>$null | Out-Null
  Assert-That (Test-Path "$dir\tools\node\node.exe") 'the portable node.exe was not installed'
  Assert-That ((Get-UserPath).ToLower().Contains("$dir\tools\node".ToLower())) 'Node was not added to the user PATH'
  & "$repo\install.ps1" -Uninstall -Yes --no-exec 3>$null | Out-Null
  Assert-That (-not (Test-Path "$dir\tools\node")) 'uninstall left the portable Node'
  Assert-That ((Get-UserPath) -eq $userPathBefore) 'uninstall left the user PATH changed'
} finally {
  if ((Get-UserPath) -ne $userPathBefore) { Write-UserPath $userPathBefore }
  $env:Path = $savedPath
  Remove-Item Env:LEAN_AGENTS_NODE_DIST
}
