# #44, #104 on Windows: install nvm-windows (the SHA256-checked installer in $env:NVM_SETUP) into a throwaway folder, give it Node 22.20.0
# and 24.22.2, put 22.20.0 first on PATH, then run the shared assertions in Git Bash (real-tool-node.sh). Used by CI.
# VERIFY (nvm-windows v2.0.1, not testable off Windows): the Inno Setup silent flags, `nvm root`, and the v<version>\node.exe layout.
$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot
if (-not $env:NVM_SETUP) { throw 'NVM_SETUP (the pinned nvm-windows installer) is not set' }

$dir = Join-Path $(if ($env:RUNNER_TEMP) { $env:RUNNER_TEMP } else { [IO.Path]::GetTempPath() }) "lean agents nvm $([guid]::NewGuid())"
New-Item -ItemType Directory -Path $dir | Out-Null
$nvmDir = Join-Path $dir 'nvm'
$p = Start-Process -FilePath $env:NVM_SETUP -ArgumentList '/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', "/DIR=$nvmDir" -Wait -PassThru
if ($p.ExitCode -ne 0) { throw "nvm-windows installer exited $($p.ExitCode)" }
$nvm = Get-ChildItem -Path $nvmDir -Recurse -Filter nvm.exe | Select-Object -First 1
if (-not $nvm) { throw "nvm.exe not found under $nvmDir" }
$env:Path = "$($nvm.DirectoryName);$env:Path"
& nvm version
& nvm root
foreach ($v in '22.20.0', '24.22.2') {
  & nvm install $v
  if ($LASTEXITCODE -ne 0) { throw "nvm install $v failed" }
}
Get-ChildItem -Path $nvmDir -Recurse -Filter node.exe | ForEach-Object { Write-Host "node.exe: $($_.FullName)" }
$old = Get-ChildItem -Path $nvmDir -Recurse -Filter node.exe | Where-Object { $_.DirectoryName -match 'v22\.20\.0' } | Select-Object -First 1
if (-not $old) { throw 'no v22.20.0\node.exe under the nvm folder' }
# The versions live next to each other: <root>\v22.20.0\node.exe, <root>\v24.22.2\node.exe.
$env:NVM_HOME = Split-Path $old.DirectoryName
$env:Path = "$($old.DirectoryName);$env:Path"
& node --version

$bash = "$env:ProgramFiles\Git\bin\bash.exe"
if (-not (Test-Path $bash)) { throw 'Git Bash is not on the runner' }
& $bash "$repo/tests/real-tool-node.sh"
if ($LASTEXITCODE -ne 0) { throw "real-tool-node.sh failed ($LASTEXITCODE)" }
