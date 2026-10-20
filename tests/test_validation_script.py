from __future__ import annotations

import base64
import json
from pathlib import Path
import shutil
import subprocess

import pytest

ROOT = Path(__file__).resolve().parents[1]


def _run_inventory_probe(tail: str) -> str:
    shell = shutil.which("powershell") or shutil.which("pwsh")
    if shell is None:
        pytest.skip("PowerShell is unavailable")
    script_path = str(ROOT / "scripts" / "validate-source.ps1").replace("'", "''")
    source = r"""
$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$tokens = $null
$errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile('__SCRIPT_PATH__', [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw "Validator parse failed" }
$function = $ast.Find({ param($node)
    $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Get-ProjectFiles'
}, $true)
. ([scriptblock]::Create($function.Extent.Text))
$repoRoot = Join-Path ([System.IO.Path]::GetTempPath()) 'source-validation-fixture'
$script:visited = New-Object 'System.Collections.Generic.List[string]'
function New-Entry($parent, $name, [bool]$directory, [bool]$link = $false) {
    $attributes = [System.IO.FileAttributes]::Normal
    if ($directory) { $attributes = [System.IO.FileAttributes]::Directory }
    if ($link) { $attributes = $attributes -bor [System.IO.FileAttributes]::ReparsePoint }
    [pscustomobject]@{Name=$name; FullName=(Join-Path $parent $name); PSIsContainer=$directory; Attributes=$attributes}
}
$sourceRoot = Join-Path $repoRoot 'source'
$unicodeRoot = Join-Path $repoRoot '검증 자료'
$script:children = @{}
$script:children[$repoRoot] = @(
    (New-Entry $repoRoot 'main.py' $false),
    (New-Entry $repoRoot '.pytest_cache' $true),
    (New-Entry $repoRoot 'venv' $true),
    (New-Entry $repoRoot 'runtime' $true),
    (New-Entry $repoRoot '.tmp' $true),
    (New-Entry $repoRoot 'external-source' $true $true),
    (New-Entry $repoRoot 'external.py' $false $true),
    (New-Entry $repoRoot 'source' $true),
    (New-Entry $repoRoot '검증 자료' $true)
)
$script:children[$sourceRoot] = @(
    (New-Entry $sourceRoot 'service.py' $false),
    (New-Entry $sourceRoot '.pytest_cache' $true),
    (New-Entry $sourceRoot 'NODE_MODULES' $true)
)
$script:children[$unicodeRoot] = @((New-Entry $unicodeRoot '테스트.py' $false))
function Get-ChildItem {
    [CmdletBinding()]
    param([string]$LiteralPath, [switch]$Force, [switch]$Recurse, [switch]$File)
    $script:visited.Add($LiteralPath)
    if ($script:denySource -and $LiteralPath -eq $sourceRoot) {
        throw [System.UnauthorizedAccessException]::new('source denied')
    }
    if ($Recurse -or -not $script:children.ContainsKey($LiteralPath)) {
        throw [System.UnauthorizedAccessException]::new('excluded folder denied')
    }
    return $script:children[$LiteralPath]
}
""".replace("__SCRIPT_PATH__", script_path) + tail
    encoded = base64.b64encode(source.encode("utf-16-le")).decode("ascii")
    result = subprocess.run(
        [shell, "-NoProfile", "-NonInteractive", "-EncodedCommand", encoded],
        capture_output=True, text=True, encoding="utf-8", timeout=30,
    )
    assert result.returncode == 0, result.stdout + result.stderr
    return result.stdout.strip()


def test_inventory_does_not_enter_inaccessible_excluded_or_linked_folders() -> None:
    output = _run_inventory_probe(r"""
$script:denySource = $false
$files = @(Get-ProjectFiles)
@{files=@($files | ForEach-Object {$_.Name}); visited=@($script:visited)} | ConvertTo-Json -Compress
""")
    result = json.loads(output)
    assert set(result["files"]) == {"main.py", "service.py", "테스트.py"}
    assert len(result["visited"]) == 3
    assert not any(
        name in path.lower()
        for path in result["visited"]
        for name in [".pytest_cache", "node_modules", "venv", "runtime", ".tmp", "external-source"]
    )


def test_inventory_still_fails_for_inaccessible_source_folders() -> None:
    output = _run_inventory_probe(r"""
$script:denySource = $true
try {
    Get-ProjectFiles | Out-Null
    throw 'Source access error was swallowed'
} catch [System.UnauthorizedAccessException] {
    if ($_.Exception.Message -ne 'source denied') { throw }
    Write-Output 'Source access error preserved'
}
""")
    assert output == "Source access error preserved"
