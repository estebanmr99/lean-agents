# #44, #104 on Windows: install nvm-windows (the SHA256-checked installer in $env:NVM_SETUP), give it Node 22.20.0
# and 24.22.2, put 22.20.0 first on PATH, then run the shared assertions in Git Bash (real-tool-node.sh). Used by CI.
# nvm-windows v2.0.1 community installer (Inno Setup): /VERYSILENT /SUPPRESSMSGBOXES /NORESTART; /DIR is ignored and a custom one stops a silent install (NVM4100),
# so it installs under %LOCALAPPDATA%\Author Software\nvm (the disposable runner's profile). Sources: docs.nvm-windows.com install/installers.md, 2026-11-11.
# VERIFY (not testable off Windows): where the version trees live (`nvm env` prints the roots) and that `node.exe` sits directly in <root>\v<version>.
$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot
if (-not $env:NVM_SETUP) { throw 'NVM_SETUP (the pinned nvm-windows installer) is not set' }

$dir = Join-Path $(if ($env:RUNNER_TEMP) { $env:RUNNER_TEMP } else { [IO.Path]::GetTempPath() }) "lean agents nvm $([guid]::NewGuid())"
New-Item -ItemType Directory -Path $dir | Out-Null
$log = Join-Path $dir 'nvm-setup.log'
$p = Start-Process -FilePath $env:NVM_SETUP -ArgumentList '/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/OFFICIALNODE=drop', "/LOG=$log" -Wait -PassThru
if ($p.ExitCode -ne 0) {
  if (Test-Path $log) { Get-Content $log -Tail 40 | ForEach-Object { Write-Output $_ } }
  throw "nvm-windows installer exited $($p.ExitCode)"
}
$nvmDir = Join-Path $env:LOCALAPPDATA 'Author Software'
$nvm = Get-ChildItem -Path $nvmDir -Recurse -Filter nvm.exe -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $nvm) { throw "nvm.exe not found under $nvmDir" }
$env:Path = "$($nvm.DirectoryName);$env:Path"
& nvm version
& nvm env
foreach ($v in '22.20.0', '24.22.2') {
  & nvm install $v
  if ($LASTEXITCODE -ne 0) { throw "nvm install $v failed" }
}
Get-ChildItem -Path $nvmDir -Recurse -Filter node.exe | ForEach-Object { Write-Output "node.exe: $($_.FullName)" }
$old = Get-ChildItem -Path $nvmDir -Recurse -Filter node.exe | Where-Object { $_.DirectoryName -match 'v22\.20\.0' } | Select-Object -First 1
if (-not $old) { throw 'no v22.20.0\node.exe under the nvm folder' }
# The versions live next to each other: <root>\v22.20.0\node.exe, <root>\v24.22.2\node.exe.
$env:NVM_HOME = Split-Path $old.DirectoryName
$env:Path = "$($old.DirectoryName);$env:Path"
& node --version

$bash = "$env:ProgramFiles\Git\bin\bash.exe"
if (-not (Test-Path $bash)) { throw 'Git Bash is not on the runner' }
# TOOL_NODE_TEST names another script that needs the same nvm-windows setup (real-adopt.sh).
$test = if ($env:TOOL_NODE_TEST) { $env:TOOL_NODE_TEST } else { 'real-tool-node.sh' }
& $bash "$repo/tests/$test"
if ($LASTEXITCODE -ne 0) { throw "$test failed ($LASTEXITCODE)" }
