param(
    [switch]$SkipJavaScript,

    [switch]$SkipTests
)

$ErrorActionPreference = "Stop"

. (Join-Path $PSScriptRoot "codex-utf8.ps1")

$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
$venvPython = Join-Path $repoRoot "venv\Scripts\python.exe"
$frontendRoot = Join-Path $repoRoot "frontend"
$databaseRoot = Join-Path $repoRoot "database"
$testsRoot = Join-Path $repoRoot "tests"
$mainFile = Join-Path $repoRoot "main.py"
$isApplicationScaffolded = Test-Path -LiteralPath $mainFile -PathType Leaf

function Get-ProjectFiles {
    $excludedDirectories = @(
        ".git", "venv", ".venv", "node_modules", "__pycache__", ".pytest_cache",
        ".mypy_cache", ".ruff_cache", ".uv-cache", "runtime", "uploads", "exports",
        "artifacts", "htmlcov", "dist", "build", ".render-static", ".tmp", "tmp"
    )
    $pendingDirectories = New-Object 'System.Collections.Generic.Stack[string]'
    $sourceFiles = New-Object 'System.Collections.Generic.List[object]'
    $pendingDirectories.Push($repoRoot)
    while ($pendingDirectories.Count -gt 0) {
        $currentDirectory = $pendingDirectories.Pop()
        # Prune excluded folders before entering them. Post-filtering a recursive
        # listing still tries to read inaccessible caches, venvs and runtime data.
        foreach ($item in Get-ChildItem -LiteralPath $currentDirectory -Force -ErrorAction Stop) {
            if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
                continue
            }
            if ($item.PSIsContainer) {
                if ($excludedDirectories -notcontains $item.Name) {
                    $pendingDirectories.Push($item.FullName)
                }
            }
            else {
                $sourceFiles.Add($item)
            }
        }
    }
    return @($sourceFiles.ToArray())
}

function Resolve-Python312 {
    $script:pythonExecutable = $null
    $script:pythonPrefixArguments = @()

    if (Test-Path -LiteralPath $venvPython -PathType Leaf) {
        $script:pythonExecutable = $venvPython
    }
    else {
        $pyCommand = Get-Command py -ErrorAction SilentlyContinue
        if ($pyCommand) {
            $script:pythonExecutable = $pyCommand.Source
            $script:pythonPrefixArguments = @("-3.12")
        }
        else {
            $pythonCommand = Get-Command python -ErrorAction SilentlyContinue
            if ($pythonCommand) {
                $script:pythonExecutable = $pythonCommand.Source
            }
        }
    }

    if ([string]::IsNullOrWhiteSpace($script:pythonExecutable)) {
        throw "Python was not found. Run scripts\setup-venv.ps1 first."
    }

    & $script:pythonExecutable @script:pythonPrefixArguments -c "import sys; raise SystemExit(0 if sys.version_info[:2] == (3, 12) else 1)"
    if ($LASTEXITCODE -ne 0) {
        throw "Source validation requires Python 3.12."
    }
}

$projectFiles = Get-ProjectFiles
$textExtensions = @(
    ".css", ".csv", ".html", ".ini", ".js", ".json", ".md", ".ps1",
    ".py", ".sql", ".svg", ".toml", ".txt", ".yaml", ".yml"
)
$textFileNames = @(".env.example", ".gitattributes", ".gitignore", ".python-version")
$textFiles = @(
    $projectFiles | Where-Object {
        $textExtensions -contains $_.Extension.ToLowerInvariant() -or
        $textFileNames -contains $_.Name.ToLowerInvariant()
    }
)

$strictUtf8 = New-Object System.Text.UTF8Encoding($false, $true)
foreach ($textFile in $textFiles) {
    $bytes = [System.IO.File]::ReadAllBytes($textFile.FullName)
    if ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF) {
        throw "UTF-8 BOM is not allowed: $($textFile.FullName)"
    }
    try {
        $null = $strictUtf8.GetString($bytes)
    }
    catch {
        throw "File is not valid UTF-8: $($textFile.FullName)"
    }
}
Write-Host "UTF-8 text encoding OK: $($textFiles.Count) files" -ForegroundColor Green

Resolve-Python312

$pythonFiles = @($projectFiles | Where-Object { $_.Extension -eq ".py" })
if ($pythonFiles.Count -gt 0) {
    $pythonFilePathsJson = ConvertTo-Json -InputObject @($pythonFiles | ForEach-Object { $_.FullName }) -Compress
    $pythonCompileCode = @"
import json
import sys
from pathlib import Path

files = [Path(name) for name in json.load(sys.stdin)]
for path in files:
    source = path.read_text(encoding='utf-8')
    compile(source, str(path), 'exec')
print(f'Python syntax OK: {len(files)} files')
"@
    $pythonFilePathsJson | & $pythonExecutable @pythonPrefixArguments -X utf8 -c $pythonCompileCode
    if ($LASTEXITCODE -ne 0) {
        throw "Python syntax validation failed."
    }
}
else {
    Write-Host "Python syntax skipped: no Python files yet." -ForegroundColor Yellow
}

if ($isApplicationScaffolded -and (Test-Path -LiteralPath $venvPython -PathType Leaf)) {
    Push-Location $repoRoot
    $validationPreviousDbMode = $env:SURVEYONE_DB_MODE
    $validationPreviousSharedDbMode = $env:DB_MODE
    $validationPreviousEnvironment = $env:SURVEYONE_ENV
    try {
        $env:SURVEYONE_DB_MODE = "memory"
        $env:DB_MODE = "memory"
        $env:SURVEYONE_ENV = "development"
        & $venvPython -c "import main; assert hasattr(main, 'app')"
        if ($LASTEXITCODE -ne 0) {
            throw "FastAPI application import validation failed."
        }
        Write-Host "FastAPI import OK" -ForegroundColor Green
    }
    finally {
        $env:SURVEYONE_DB_MODE = $validationPreviousDbMode
        $env:DB_MODE = $validationPreviousSharedDbMode
        $env:SURVEYONE_ENV = $validationPreviousEnvironment
        Pop-Location
    }
}
elseif ($isApplicationScaffolded) {
    Write-Warning "FastAPI import was skipped because the project venv is not installed."
}

if (Test-Path -LiteralPath $venvPython -PathType Leaf) {
    & $venvPython -c "import importlib.util; raise SystemExit(0 if importlib.util.find_spec('ruff') else 1)"
    if ($LASTEXITCODE -eq 0) {
        $ruffTargets = @()
        if (Test-Path -LiteralPath $mainFile -PathType Leaf) {
            $ruffTargets += $mainFile
        }
        foreach ($candidateDirectory in @((Join-Path $repoRoot "backend"), $testsRoot)) {
            if (Test-Path -LiteralPath $candidateDirectory -PathType Container) {
                $ruffTargets += $candidateDirectory
            }
        }
        if ($ruffTargets.Count -gt 0) {
            & $venvPython -m ruff check @ruffTargets
            if ($LASTEXITCODE -ne 0) {
                throw "Ruff validation failed."
            }
        }
    }
    else {
        Write-Warning "Ruff is not installed. Install requirements-dev.txt for lint validation."
    }
}

$jsonFiles = @($projectFiles | Where-Object { $_.Extension -eq ".json" })
foreach ($jsonFile in $jsonFiles) {
    # Windows PowerShell ConvertFrom-Json rejects the empty object key used by
    # modern npm package-lock.json files. Python's standard JSON parser accepts
    # the complete JSON specification and is already required by this project.
    & $venvPython -m json.tool $jsonFile.FullName | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "JSON syntax validation failed: $($jsonFile.FullName)"
    }
}
Write-Host "JSON syntax OK: $($jsonFiles.Count) files" -ForegroundColor Green

$powerShellParseErrors = @()
$powerShellFiles = @($projectFiles | Where-Object { $_.Extension -eq ".ps1" })
foreach ($powerShellFile in $powerShellFiles) {
    $tokens = $null
    $parseErrors = $null
    [System.Management.Automation.Language.Parser]::ParseFile(
        $powerShellFile.FullName,
        [ref]$tokens,
        [ref]$parseErrors
    ) | Out-Null
    $powerShellParseErrors += $parseErrors
}
if ($powerShellParseErrors.Count -gt 0) {
    $messages = $powerShellParseErrors | ForEach-Object {
        "$($_.Extent.File):$($_.Extent.StartLineNumber): $($_.Message)"
    }
    throw "PowerShell syntax validation failed.`n$($messages -join [Environment]::NewLine)"
}
Write-Host "PowerShell syntax OK: $($powerShellFiles.Count) files" -ForegroundColor Green

$cssFiles = @($projectFiles | Where-Object { $_.Extension -eq ".css" })
foreach ($cssFile in $cssFiles) {
    $cssSource = Get-Content -LiteralPath $cssFile.FullName -Raw -Encoding UTF8
    if ($null -eq $cssSource) {
        $cssSource = ""
    }
    $withoutComments = [regex]::Replace($cssSource, '/\*.*?\*/', '', [System.Text.RegularExpressions.RegexOptions]::Singleline)
    $openBraces = ([regex]::Matches($withoutComments, '\{')).Count
    $closeBraces = ([regex]::Matches($withoutComments, '\}')).Count
    if ($openBraces -ne $closeBraces) {
        throw "CSS brace validation failed: $($cssFile.FullName) ($openBraces/$closeBraces)"
    }
}
Write-Host "CSS braces OK: $($cssFiles.Count) files" -ForegroundColor Green

if (-not $SkipJavaScript) {
    $javascriptFiles = @($projectFiles | Where-Object { $_.Extension -eq ".js" })
    $nodeCommand = Get-Command node -ErrorAction SilentlyContinue
    if ($javascriptFiles.Count -eq 0) {
        Write-Host "JavaScript syntax skipped: no JavaScript files yet." -ForegroundColor Yellow
    }
    elseif (-not $nodeCommand) {
        Write-Warning "Node.js was not found. JavaScript syntax validation was skipped; Node is not a runtime dependency."
    }
    else {
        foreach ($javascriptFile in $javascriptFiles) {
            & $nodeCommand.Source --check $javascriptFile.FullName
            if ($LASTEXITCODE -ne 0) {
                throw "JavaScript syntax validation failed: $($javascriptFile.FullName)"
            }
        }
        Write-Host "JavaScript syntax OK: $($javascriptFiles.Count) files" -ForegroundColor Green
    }
}

$requiredMenuFiles = @(
    "M01001.html",
    "M02001.html",
    "M02002.html",
    "M02003.html",
    "M03001.html",
    "M04001.html",
    "M05001.html",
    "M05002.html",
    "M06001.html"
)
if (Test-Path -LiteralPath $frontendRoot -PathType Container) {
    $frontendPrefix = $frontendRoot + [System.IO.Path]::DirectorySeparatorChar
    $htmlFiles = @($projectFiles | Where-Object {
        $_.Extension -eq ".html" -and $_.FullName.StartsWith($frontendPrefix, [System.StringComparison]::OrdinalIgnoreCase)
    })
    $htmlNames = @($htmlFiles | ForEach-Object { $_.Name })
    $missingMenuFiles = @($requiredMenuFiles | Where-Object { $htmlNames -notcontains $_ })
    if ($isApplicationScaffolded -and $missingMenuFiles.Count -gt 0) {
        throw "Required menu HTML files are missing: $($missingMenuFiles -join ', ')"
    }
    elseif ($missingMenuFiles.Count -gt 0) {
        Write-Warning "Menu scaffold is not complete yet: $($missingMenuFiles -join ', ')"
    }

    $documentFiles = @($htmlFiles | Where-Object {
        $candidateSource = Get-Content -LiteralPath $_.FullName -Raw -Encoding UTF8
        $candidateSource -match '(?i)<!doctype\s+html|<html(?:\s|>)'
    })
    foreach ($htmlFile in $documentFiles) {
        $htmlSource = Get-Content -LiteralPath $htmlFile.FullName -Raw -Encoding UTF8
        $mainCount = ([regex]::Matches($htmlSource, '(?i)<main(?:\s|>)')).Count
        $h1Count = ([regex]::Matches($htmlSource, '(?i)<h1(?:\s|>)')).Count
        if ($mainCount -ne 1) {
            throw "HTML must contain exactly one main element: $($htmlFile.FullName)"
        }
        if ($h1Count -ne 1) {
            throw "HTML must contain exactly one h1 element: $($htmlFile.FullName)"
        }
        if ($htmlSource -notmatch '(?i)<meta\s+name=["'']viewport["'']') {
            throw "HTML viewport metadata is missing: $($htmlFile.FullName)"
        }
    }
    Write-Host "HTML document contract OK: $($documentFiles.Count) documents; $($htmlFiles.Count - $documentFiles.Count) SPA fragments" -ForegroundColor Green
}

if (Test-Path -LiteralPath $databaseRoot -PathType Container) {
    $ddlFiles = @(Get-ChildItem -LiteralPath $databaseRoot -File -Filter "*_DDL.sql")
    $altFiles = @(Get-ChildItem -LiteralPath $databaseRoot -File -Filter "*_ALT.sql")
    $requiredAdministrationFiles = @(
        "SURVEYONE_SYSTEM_DROP.sql",
        "SURVEYONE_SYSTEM_TRUC.sql"
    )
    if ($isApplicationScaffolded -and ($ddlFiles.Count -eq 0 -or $altFiles.Count -eq 0)) {
        throw "database must contain at least one matching *_DDL.sql and *_ALT.sql pair."
    }
    foreach ($administrationFile in $requiredAdministrationFiles) {
        $administrationPath = Join-Path $databaseRoot $administrationFile
        if (-not (Test-Path -LiteralPath $administrationPath -PathType Leaf)) {
            throw "Required explicit database administration script is missing: $administrationFile"
        }
    }

    foreach ($ddlFile in $ddlFiles) {
        $baseName = $ddlFile.BaseName.Substring(0, $ddlFile.BaseName.Length - 4)
        $matchingAlt = Join-Path $databaseRoot ($baseName + "_ALT.sql")
        if (-not (Test-Path -LiteralPath $matchingAlt -PathType Leaf)) {
            throw "DDL has no matching ALT migration file: $($ddlFile.Name)"
        }
    }
    foreach ($altFile in $altFiles) {
        $baseName = $altFile.BaseName.Substring(0, $altFile.BaseName.Length - 4)
        $matchingDdl = Join-Path $databaseRoot ($baseName + "_DDL.sql")
        if (-not (Test-Path -LiteralPath $matchingDdl -PathType Leaf)) {
            throw "ALT has no matching fresh-install DDL file: $($altFile.Name)"
        }

        $altSource = Get-Content -LiteralPath $altFile.FullName -Raw -Encoding UTF8
        if ($altSource -match '(?i)\b(DROP|TRUNCATE)\s+(TABLE|INDEX|SEQUENCE|VIEW|MATERIALIZED|SCHEMA|USER|PARTITION)\b') {
            throw "ALT migrations must not contain DROP or TRUNCATE statements: $($altFile.FullName)"
        }

        $ddlSource = Get-Content -LiteralPath $matchingDdl -Raw -Encoding UTF8
        $tableDefinitionPattern = '(?ms)CREATE\s+TABLE\s+"([^"]+)"\s*\((.*?)\r?\n\)\s*\r?\n\]'
        $ddlTableDefinitions = @{}
        $altTableDefinitions = @{}
        foreach ($match in [regex]::Matches($ddlSource, $tableDefinitionPattern)) {
            $tableName = $match.Groups[1].Value.ToUpperInvariant()
            $ddlTableDefinitions[$tableName] = ($match.Groups[2].Value -replace "`r`n", "`n").Trim()
        }
        foreach ($match in [regex]::Matches($altSource, $tableDefinitionPattern)) {
            $tableName = $match.Groups[1].Value.ToUpperInvariant()
            $altTableDefinitions[$tableName] = ($match.Groups[2].Value -replace "`r`n", "`n").Trim()
        }
        $ddlTables = @($ddlTableDefinitions.Keys | Sort-Object)
        $altTables = @($altTableDefinitions.Keys | Sort-Object)
        if ($ddlTables.Count -eq 0 -or $altTables.Count -eq 0) {
            throw "DDL/ALT CREATE TABLE definitions could not be parsed for basename '$baseName'."
        }
        $tableDifferences = @(Compare-Object -ReferenceObject $ddlTables -DifferenceObject $altTables)
        if ($tableDifferences.Count -gt 0) {
            throw "DDL/ALT table definitions differ for basename '$baseName'."
        }
        foreach ($tableName in $ddlTables) {
            $ddlDefinition = ([regex]::Replace($ddlTableDefinitions[$tableName], '\s+', ' ')).Trim()
            $altDefinition = ([regex]::Replace($altTableDefinitions[$tableName], '\s+', ' ')).Trim()
            if ($ddlDefinition -cne $altDefinition) {
                throw "DDL/ALT CREATE TABLE source or column order differs for '$tableName'."
            }
        }

        $persistentObjectPatterns = @(
            '(?im)CREATE\s+TABLE\s+"([A-Z0-9_$#]+)"',
            '(?im)CREATE\s+(?:UNIQUE\s+)?INDEX\s+"([A-Z0-9_$#]+)"',
            '(?im)CREATE\s+(?:OR\s+REPLACE\s+)?(?:FUNCTION|PROCEDURE|TRIGGER|VIEW|SEQUENCE|PACKAGE(?:\s+BODY)?)\s+"?([A-Z0-9_$#]+)"?',
            '(?im)CONSTRAINT\s+"([A-Z0-9_$#]+)"'
        )
        foreach ($schemaSource in @($ddlSource, $altSource)) {
            foreach ($objectPattern in $persistentObjectPatterns) {
                foreach ($objectMatch in [regex]::Matches($schemaSource, $objectPattern)) {
                    $objectName = $objectMatch.Groups[1].Value.ToUpperInvariant()
                    if (-not $objectName.StartsWith('INIT$SVY_', [System.StringComparison]::Ordinal)) {
                        throw "Oracle object must start with INIT`$SVY_: $objectName"
                    }
                    if ($objectName.Length -gt 30) {
                        throw "Oracle object name exceeds 30 characters: $objectName"
                    }
                }
            }
        }
    }
    Write-Host "DDL/ALT/admin file policy OK: $($ddlFiles.Count) pairs; object prefix and source order verified" -ForegroundColor Green
}
elseif ($isApplicationScaffolded) {
    throw "database directory is missing."
}
else {
    Write-Warning "Database scaffold is not present yet."
}

$sourceCodeExtensions = @(".css", ".html", ".js", ".json", ".py", ".sql")
$coupledCodeFiles = @($projectFiles | Where-Object { $sourceCodeExtensions -contains $_.Extension.ToLowerInvariant() })
$forbiddenSiblingReferences = @("initgroup-members", "initgroup-homepage", "data-editing-system")
foreach ($codeFile in $coupledCodeFiles) {
    $codeSource = Get-Content -LiteralPath $codeFile.FullName -Raw -Encoding UTF8
    foreach ($forbiddenReference in $forbiddenSiblingReferences) {
        if ($codeSource -match [regex]::Escape($forbiddenReference)) {
            throw "Sibling-project coupling is not allowed in project code: $($codeFile.FullName)"
        }
    }
}
Write-Host "Independent-project reference check OK" -ForegroundColor Green

$environmentExample = Join-Path $repoRoot ".env.example"
if (-not (Test-Path -LiteralPath $environmentExample -PathType Leaf)) {
    throw ".env.example is missing."
}
$environmentText = Get-Content -LiteralPath $environmentExample -Raw -Encoding UTF8
$secretKeys = @(
    "SURVEYONE_DB_PASSWORD",
    "SURVEYONE_DB_WALLET_PASSWORD",
    "SURVEYONE_SESSION_SECRET",
    "DB_PASSWORD_LOC",
    "DB_PASSWORD_CLD",
    "DB_WALLET_PASSWORD",
    "INIT_SECRET_KEY"
)
foreach ($secretKey in $secretKeys) {
    if ($environmentText -match "(?m)^$([regex]::Escape($secretKey))=(.+)$") {
        throw ".env.example must not contain a value for $secretKey."
    }
}
Write-Host "Environment template secret check OK" -ForegroundColor Green

if (-not $SkipTests -and (Test-Path -LiteralPath $testsRoot -PathType Container)) {
    $testsPrefix = $testsRoot + [System.IO.Path]::DirectorySeparatorChar
    $testFiles = @($projectFiles | Where-Object {
        $_.Name -like "test_*.py" -and $_.FullName.StartsWith($testsPrefix, [System.StringComparison]::OrdinalIgnoreCase)
    })
    if ($testFiles.Count -gt 0) {
        & $pythonExecutable @pythonPrefixArguments -c "import pytest"
        if ($LASTEXITCODE -ne 0) {
            throw "pytest is required because tests are present. Run scripts\setup-venv.ps1."
        }

        Push-Location $repoRoot
        $validationPreviousDbMode = $env:SURVEYONE_DB_MODE
        $validationPreviousSharedDbMode = $env:DB_MODE
        $validationPreviousEnvironment = $env:SURVEYONE_ENV
        try {
            $env:SURVEYONE_DB_MODE = "memory"
            $env:DB_MODE = "memory"
            $env:SURVEYONE_ENV = "development"
            & $pythonExecutable @pythonPrefixArguments -m pytest -q -p no:cacheprovider
            if ($LASTEXITCODE -ne 0) {
                throw "Test suite failed."
            }
        }
        finally {
            $env:SURVEYONE_DB_MODE = $validationPreviousDbMode
            $env:DB_MODE = $validationPreviousSharedDbMode
            $env:SURVEYONE_ENV = $validationPreviousEnvironment
            Pop-Location
        }
    }
    else {
        Write-Host "Tests skipped: no test_*.py files yet." -ForegroundColor Yellow
    }
}

Write-Host ""
Write-Host "Source validation completed." -ForegroundColor Green
