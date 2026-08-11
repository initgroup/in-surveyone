param(
    [string]$PythonCommand = "py",

    [string]$PythonVersion = "3.12",

    [switch]$Recreate,

    [switch]$SkipPipUpgrade,

    [switch]$ProductionOnly
)

$ErrorActionPreference = "Stop"

. (Join-Path $PSScriptRoot "codex-utf8.ps1")

$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
$venvDir = Join-Path $repoRoot "venv"
$venvPython = Join-Path $venvDir "Scripts\python.exe"
$requirementsFile = Join-Path $repoRoot "requirements.txt"
$devRequirementsFile = Join-Path $repoRoot "requirements-dev.txt"
$pathComparison = [System.StringComparison]::OrdinalIgnoreCase

if (-not (Test-Path -LiteralPath $requirementsFile -PathType Leaf)) {
    throw "requirements.txt was not found: $requirementsFile"
}
if (-not $ProductionOnly -and -not (Test-Path -LiteralPath $devRequirementsFile -PathType Leaf)) {
    throw "requirements-dev.txt was not found: $devRequirementsFile"
}

function Assert-Python312 {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Executable,

        [string[]]$PrefixArguments = @()
    )

    & $Executable @PrefixArguments -c "import sys; raise SystemExit(0 if sys.version_info[:2] == (3, 12) else 1)"
    if ($LASTEXITCODE -ne 0) {
        throw "Python 3.12 is required. Interpreter: $Executable"
    }
}

$needsCreation = $Recreate -or -not (Test-Path -LiteralPath $venvPython -PathType Leaf)
$pythonExecutable = $null
$pythonPrefixArguments = @()

if ($needsCreation) {
    $pythonCommandInfo = Get-Command $PythonCommand -ErrorAction SilentlyContinue
    if (-not $pythonCommandInfo) {
        throw "Python command was not found: $PythonCommand"
    }

    $pythonExecutable = $pythonCommandInfo.Source
    if ([string]::IsNullOrWhiteSpace($pythonExecutable)) {
        $pythonExecutable = $pythonCommandInfo.Path
    }
    if ([string]::IsNullOrWhiteSpace($pythonExecutable)) {
        throw "Python executable could not be resolved: $PythonCommand"
    }

    if ([System.IO.Path]::GetFileNameWithoutExtension($pythonCommandInfo.Name) -eq "py") {
        if ([string]::IsNullOrWhiteSpace($PythonVersion)) {
            throw "PythonVersion is required when PythonCommand is py."
        }
        $pythonPrefixArguments = @("-$PythonVersion")
    }

    Assert-Python312 -Executable $pythonExecutable -PrefixArguments $pythonPrefixArguments
}

if ($Recreate -and (Test-Path -LiteralPath $venvDir)) {
    $resolvedRepo = (Resolve-Path -LiteralPath $repoRoot).Path.TrimEnd('\', '/')
    $resolvedVenv = (Resolve-Path -LiteralPath $venvDir).Path.TrimEnd('\', '/')
    $expectedVenv = [System.IO.Path]::GetFullPath((Join-Path $resolvedRepo "venv")).TrimEnd('\', '/')
    if (-not $resolvedVenv.Equals($expectedVenv, $pathComparison)) {
        throw "Refusing to remove an unexpected virtual environment path: $resolvedVenv"
    }

    $venvItem = Get-Item -LiteralPath $resolvedVenv -Force
    if (($venvItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw "Refusing to remove a virtual environment that is a reparse point: $resolvedVenv"
    }

    Write-Host "Removing existing virtual environment: $resolvedVenv" -ForegroundColor Yellow
    Remove-Item -LiteralPath $resolvedVenv -Recurse -Force
}

if (-not (Test-Path -LiteralPath $venvPython -PathType Leaf)) {
    Write-Host "Creating Python 3.12 virtual environment: $venvDir" -ForegroundColor Cyan
    & $pythonExecutable @pythonPrefixArguments -m venv $venvDir
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $venvPython -PathType Leaf)) {
        throw "Virtual environment creation failed."
    }
}
else {
    Write-Host "Using existing virtual environment: $venvDir" -ForegroundColor Cyan
}

Assert-Python312 -Executable $venvPython

if (-not $SkipPipUpgrade) {
    Write-Host "Upgrading pip..." -ForegroundColor Cyan
    & $venvPython -m pip install --upgrade pip
    if ($LASTEXITCODE -ne 0) {
        throw "pip upgrade failed."
    }
}

$installFile = if ($ProductionOnly) { $requirementsFile } else { $devRequirementsFile }
$installLabel = if ($ProductionOnly) { "runtime" } else { "runtime and development" }
Write-Host "Installing $installLabel requirements..." -ForegroundColor Cyan
& $venvPython -m pip install -r $installFile
if ($LASTEXITCODE -ne 0) {
    throw "Dependency installation failed."
}

Write-Host ""
Write-Host "Virtual environment is ready." -ForegroundColor Green
Write-Host "Python: $venvPython"
Write-Host "Mode: $installLabel"
