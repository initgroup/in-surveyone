param(
    [ValidateSet("Git", "Working")]
    [string]$Mode = "Working"
)

$ErrorActionPreference = "Stop"

. (Join-Path $PSScriptRoot "codex-utf8.ps1")

$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
$repoRootFull = [System.IO.Path]::GetFullPath($repoRoot).TrimEnd('\', '/')
$gitSafeDirectory = "safe.directory=$($repoRootFull -replace '\\', '/')"
$projectName = Split-Path -Leaf $repoRootFull
$pathComparison = [System.StringComparison]::OrdinalIgnoreCase

if (-not $projectName.Equals("in-surveyone", $pathComparison)) {
    throw "Backup is restricted to an in-surveyone project root. Resolved source: $repoRootFull"
}

$backupBase = [System.IO.Path]::GetFullPath("D:\work\backup").TrimEnd('\', '/')
$modeFolder = if ($Mode -eq "Git") {
    "in-surveyone_GIT_BACKUP"
}
else {
    "in-surveyone_WORKING_BACKUP"
}
$allowedModeRoot = [System.IO.Path]::GetFullPath((Join-Path $backupBase $modeFolder)).TrimEnd('\', '/')
$stamp = Get-Date -Format "yyyyMMdd-HHmmssfff"
$backupDir = [System.IO.Path]::GetFullPath((Join-Path $allowedModeRoot $stamp)).TrimEnd('\', '/')
$allowedPrefix = $allowedModeRoot + [System.IO.Path]::DirectorySeparatorChar

if (-not $backupDir.StartsWith($allowedPrefix, $pathComparison)) {
    throw "Computed backup destination escaped the allowed folder: $backupDir"
}
if ($allowedModeRoot.Equals($repoRootFull, $pathComparison) -or
    $allowedModeRoot.StartsWith($repoRootFull + [System.IO.Path]::DirectorySeparatorChar, $pathComparison)) {
    throw "Backup destination must remain outside the project: $allowedModeRoot"
}
if (Test-Path -LiteralPath $backupDir) {
    throw "Backup destination already exists: $backupDir"
}

function Assert-NoExistingReparsePoint {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path
    )

    $candidate = [System.IO.Path]::GetFullPath($Path)
    while (-not (Test-Path -LiteralPath $candidate)) {
        $parent = [System.IO.Directory]::GetParent($candidate)
        if ($null -eq $parent) {
            throw "No existing parent was found for backup path: $Path"
        }
        $candidate = $parent.FullName
    }

    while (-not [string]::IsNullOrWhiteSpace($candidate)) {
        $item = Get-Item -LiteralPath $candidate -Force
        if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
            throw "Backup path must not traverse a symbolic link, junction, or reparse point: $candidate"
        }
        $parent = [System.IO.Directory]::GetParent($candidate)
        if ($null -eq $parent) {
            break
        }
        $candidate = $parent.FullName
    }
}

function Test-SensitivePath {
    param([string]$RelativePath)

    $normalized = ($RelativePath -replace '\\', '/').TrimStart('/')
    if ($normalized.Equals(".env.example", [System.StringComparison]::OrdinalIgnoreCase)) {
        return $false
    }

    return $normalized -match '(?i)(^|/)(\.env($|\.)|secrets?(/|$)|\.secrets?(/|$)|wallet[^/]*(/|$)|instantclient(/|$))' -or
        $normalized -match '(?i)\.(pem|key|p12|pfx|jks)$' -or
        $normalized -match '(?i)(^|/)[^/]*wallet[^/]*\.zip$'
}

Assert-NoExistingReparsePoint -Path $backupBase

if ($Mode -eq "Git") {
    $gitCommand = Get-Command git -ErrorAction SilentlyContinue
    if (-not $gitCommand) {
        throw "git command was not found."
    }

    & $gitCommand.Source -c $gitSafeDirectory -C $repoRoot rev-parse --is-inside-work-tree | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "Git metadata was not found. Use -Mode Working for an unpacked or new source directory."
    }
    & $gitCommand.Source -c $gitSafeDirectory -C $repoRoot rev-parse --verify --quiet "HEAD^{commit}" | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "The repository has no commit to archive. Use -Mode Working until the first commit exists."
    }

    $trackedSensitivePaths = @(
        & $gitCommand.Source -c $gitSafeDirectory -C $repoRoot ls-files |
            Where-Object { Test-SensitivePath -RelativePath $_ }
    )
    if ($LASTEXITCODE -ne 0) {
        throw "Unable to inspect tracked files before backup."
    }
    if ($trackedSensitivePaths.Count -gt 0) {
        throw "Git backup refused because sensitive file paths are tracked. Remove them from Git before retrying."
    }
}
else {
    $robocopyCommand = Get-Command robocopy -ErrorAction SilentlyContinue
    if (-not $robocopyCommand) {
        throw "robocopy command was not found."
    }
}

New-Item -ItemType Directory -Force -Path $allowedModeRoot | Out-Null
Assert-NoExistingReparsePoint -Path $allowedModeRoot

$resolvedModeRoot = (Resolve-Path -LiteralPath $allowedModeRoot).Path.TrimEnd('\', '/')
if (-not $resolvedModeRoot.Equals($allowedModeRoot, $pathComparison)) {
    throw "Resolved backup group differs from the allowed path: $resolvedModeRoot"
}

New-Item -ItemType Directory -Path $backupDir | Out-Null
$resolvedBackupDir = (Resolve-Path -LiteralPath $backupDir).Path.TrimEnd('\', '/')
if (-not $resolvedBackupDir.StartsWith($allowedPrefix, $pathComparison)) {
    throw "Created backup directory escaped the allowed folder: $resolvedBackupDir"
}

if ($Mode -eq "Git") {
    $archivePath = Join-Path $resolvedBackupDir "source.zip"
    $bundlePath = Join-Path $resolvedBackupDir "repository.bundle"

    & $gitCommand.Source -c $gitSafeDirectory -C $repoRoot archive --format=zip "--output=$archivePath" HEAD
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $archivePath -PathType Leaf)) {
        throw "git archive failed. Partial backup remains for inspection: $resolvedBackupDir"
    }

    & $gitCommand.Source -c $gitSafeDirectory -C $repoRoot bundle create $bundlePath --branches --tags
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $bundlePath -PathType Leaf)) {
        throw "git bundle failed. Partial backup remains for inspection: $resolvedBackupDir"
    }
}
else {
    $excludeDirectories = @(
        ".git",
        "venv",
        ".venv",
        "node_modules",
        "__pycache__",
        ".pytest_cache",
        ".mypy_cache",
        ".ruff_cache",
        ".uv-cache",
        "secrets",
        ".secrets",
        "instantclient",
        ".instantclient",
        "Wallet*",
        "wallet*",
        "runtime",
        "uploads",
        "exports",
        "artifacts",
        "test-results",
        "coverage",
        "htmlcov",
        "dist",
        "build",
        ".render-static",
        ".tmp",
        "tmp",
        "screenshots",
        "prompt"
    )
    $excludeFiles = @(
        ".env",
        ".env.*",
        "*.env.local",
        ".envrc",
        "*.pyc",
        ".coverage",
        ".coverage.*",
        "coverage.xml",
        "*.log",
        "*.db",
        "*.sqlite",
        "*.sqlite3",
        "*Wallet*.zip",
        "*wallet*.zip",
        "*.pem",
        "*.key",
        "*.p12",
        "*.pfx",
        "*.jks",
        "*.whl",
        ".DS_Store",
        "Thumbs.db"
    )
    $robocopyArguments = @(
        $repoRoot,
        $resolvedBackupDir,
        "/E",
        "/COPY:DAT",
        "/DCOPY:DAT",
        "/XJ",
        "/R:2",
        "/W:1",
        "/NFL",
        "/NDL",
        "/NJH",
        "/NJS",
        "/NP",
        "/XD"
    ) + $excludeDirectories + @("/XF") + $excludeFiles

    & $robocopyCommand.Source @robocopyArguments
    $robocopyExitCode = $LASTEXITCODE
    if ($robocopyExitCode -gt 7) {
        throw "robocopy failed with exit code $robocopyExitCode. Partial backup remains for inspection: $resolvedBackupDir"
    }

    $environmentTemplate = Join-Path $repoRoot ".env.example"
    if (Test-Path -LiteralPath $environmentTemplate -PathType Leaf) {
        Copy-Item -LiteralPath $environmentTemplate -Destination (Join-Path $resolvedBackupDir ".env.example") -Force
    }
}

$branch = "N/A"
$headCommit = "N/A"
$gitForManifest = Get-Command git -ErrorAction SilentlyContinue
if ($gitForManifest) {
    & $gitForManifest.Source -c $gitSafeDirectory -C $repoRoot rev-parse --is-inside-work-tree 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) {
        $branchValue = (& $gitForManifest.Source -c $gitSafeDirectory -C $repoRoot branch --show-current 2>$null | Out-String).Trim()
        if (-not [string]::IsNullOrWhiteSpace($branchValue)) {
            $branch = $branchValue
        }
        else {
            $branch = "DETACHED_OR_UNBORN"
        }

        & $gitForManifest.Source -c $gitSafeDirectory -C $repoRoot rev-parse --verify --quiet HEAD | Out-Null
        if ($LASTEXITCODE -eq 0) {
            $headValue = (& $gitForManifest.Source -c $gitSafeDirectory -C $repoRoot rev-parse HEAD | Out-String).Trim()
            $headCommit = if ([string]::IsNullOrWhiteSpace($headValue)) { "UNBORN" } else { $headValue }
        }
        else {
            $headCommit = "UNBORN"
        }
    }
}

$manifest = @(
    "Project: in-surveyone",
    "Mode: $Mode",
    "Created: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss K')",
    "Source: $repoRootFull",
    "Branch: $branch",
    "HEAD: $headCommit",
    "Destination policy: $allowedModeRoot"
)
if ($Mode -eq "Git") {
    $manifest += "Contents: source.zip and repository.bundle"
    $manifest += "Restore example: git clone repository.bundle restored-in-surveyone"
}
else {
    $manifest += "Contents: committed, modified, and untracked working source"
    $manifest += "Excludes: Git metadata, environments, dependencies, credentials, wallets, runtime data, exports, caches, logs, and generated captures"
}

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllLines(
    (Join-Path $resolvedBackupDir "BACKUP_INFO.txt"),
    $manifest,
    $utf8NoBom
)

Write-Host ""
Write-Host "Backup completed." -ForegroundColor Green
Write-Host "Mode: $Mode"
Write-Host "Backup group: $resolvedModeRoot"
Write-Host "Path: $resolvedBackupDir"
