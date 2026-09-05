# Dot-source once in each PowerShell development session.
$env:Path = "D:\tools\node24;$env:Path"
$script:GeoPnpmCli = Join-Path (Split-Path (Get-Command pnpm.cmd -CommandType Application | Select-Object -First 1).Source) 'node_modules\pnpm\bin\pnpm.mjs'
if (-not (Test-Path -LiteralPath $script:GeoPnpmCli)) { throw 'Cannot locate the installed pnpm CLI' }
function global:pnpm.cmd {
    & 'D:\tools\node24\node.exe' $script:GeoPnpmCli @args
}
if ((node -v) -ne 'v24.20.0') { throw 'Expected project Node v24.20.0' }
if ((pnpm.cmd -v) -ne '11.1.0') { throw 'Expected pnpm 11.1.0' }
