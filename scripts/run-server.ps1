param(
    [string]$HostAddress = "127.0.0.1",

    [ValidateRange(1, 65535)]
    [int]$Port = 8300,

    [switch]$NoReload
)

$ErrorActionPreference = "Stop"

. (Join-Path $PSScriptRoot "codex-utf8.ps1")

$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
$venvPython = Join-Path $repoRoot "venv\Scripts\python.exe"
$venvActivate = Join-Path $repoRoot "venv\Scripts\Activate.ps1"
$mainFile = Join-Path $repoRoot "main.py"

if (-not (Test-Path -LiteralPath $venvPython -PathType Leaf) -or
    -not (Test-Path -LiteralPath $venvActivate -PathType Leaf)) {
    throw "The project venv was not found. Run scripts\setup-venv.ps1 first."
}
if (-not (Test-Path -LiteralPath $mainFile -PathType Leaf)) {
    throw "FastAPI entry point was not found: $mainFile"
}

Set-Location -LiteralPath $repoRoot
. $venvActivate

$env:SURVEYONE_HOST = $HostAddress
$env:SURVEYONE_PORT = [string]$Port
$env:UVICORN_HOST = $HostAddress
$env:UVICORN_PORT = [string]$Port

$bindAddress = $null
if (-not [System.Net.IPAddress]::TryParse($HostAddress, [ref]$bindAddress)) {
    $bindAddress = [System.Net.Dns]::GetHostAddresses($HostAddress) |
        Where-Object { $_.AddressFamily -eq [System.Net.Sockets.AddressFamily]::InterNetwork } |
        Select-Object -First 1
}
if (-not $bindAddress) {
    throw "Host address could not be resolved: $HostAddress"
}

$portProbe = New-Object System.Net.Sockets.TcpListener($bindAddress, $Port)
try {
    $portProbe.Start()
}
catch {
    throw "Server port is already in use or unavailable: $HostAddress`:$Port"
}
finally {
    $portProbe.Stop()
}

Push-Location $repoRoot
try {
    & $venvPython -c "import main; assert hasattr(main, 'app')"
    if ($LASTEXITCODE -ne 0) {
        throw "FastAPI application import validation failed."
    }
}
finally {
    Pop-Location
}

$serverArguments = @(
    "-m",
    "uvicorn",
    "main:app",
    "--host",
    $HostAddress,
    "--port",
    [string]$Port
)
if (-not $NoReload) {
    $serverArguments += @("--reload", "--reload-dir", $repoRoot)
}

$serverExitCode = $null
$pipelineInterrupted = $false
Push-Location $repoRoot
try {
    Write-Host "Starting IN-SURVEYONE: http://$HostAddress`:$Port" -ForegroundColor Green
    try {
        & $venvPython @serverArguments
        $serverExitCode = $LASTEXITCODE
    }
    catch [System.Management.Automation.PipelineStoppedException] {
        $pipelineInterrupted = $true
    }
}
finally {
    Pop-Location
}

$gracefulExitCodes = @(0, 130, -1073741510)
$reloadControlCExit = -not $NoReload -and $serverExitCode -eq 1
if ($pipelineInterrupted -or $serverExitCode -in $gracefulExitCodes -or $reloadControlCExit) {
    Write-Host "Server stopped normally. The terminal remains in the active (venv) session." -ForegroundColor Green
    Set-Location -LiteralPath $repoRoot
    return
}

throw "Server process exited with code $serverExitCode."
