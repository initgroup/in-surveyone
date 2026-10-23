param(
    [ValidatePattern('^[0-9]{4}\.[0-9]{2}\.[0-9]{2}\.[1-9][0-9]{0,3}$')]
    [string]$Version = ""
)

$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
$utf8NoBom = [System.Text.UTF8Encoding]::new($false)
$versionPath = Join-Path $repoRoot "VERSION"
$currentVersion = [System.IO.File]::ReadAllText($versionPath).Trim()
if ([string]::IsNullOrWhiteSpace($Version)) {
    $today = Get-Date -Format "yyyy.MM.dd"
    $revision = 1
    if ($currentVersion -match ('^' + [regex]::Escape($today) + '\.([0-9]+)$')) {
        $revision = [int]$Matches[1] + 1
    }
    $Version = "$today.$revision"
}
if ($Version -notmatch '^[0-9]{4}\.[0-9]{2}\.[0-9]{2}\.[1-9][0-9]{0,3}$') {
    throw "Version must use YYYY.MM.DD.N with a positive revision up to 9999."
}
$versionDate = $Version.Substring(0, 10)
[void][datetime]::ParseExact($versionDate, "yyyy.MM.dd", [System.Globalization.CultureInfo]::InvariantCulture)

# Prepare and validate all changes before writing any source file.
$changes = [ordered]@{}
$changes[$versionPath] = "$Version`n"
$configPath = Join-Path $repoRoot "frontend/config/app.config.js"
$config = [System.IO.File]::ReadAllText($configPath)
$configPattern = '(?<prefix>assetVersion\s*:\s*")[^"]+(?<suffix>")'
if ([regex]::Matches($config, $configPattern).Count -ne 1) { throw "Expected exactly one assetVersion." }
$changes[$configPath] = [regex]::Replace($config, $configPattern, [System.Text.RegularExpressions.MatchEvaluator]{
    param($match)
    $match.Groups["prefix"].Value + $Version + $match.Groups["suffix"].Value
})
foreach ($relativePath in @("frontend/index.html", "frontend/public.html")) {
    $path = Join-Path $repoRoot $relativePath
    $html = [System.IO.File]::ReadAllText($path)
    $pattern = '(?<prefix>(?:src|href)="/frontend/[^"\r\n]*[?&]v=)[^"&]+'
    if ([regex]::Matches($html, $pattern).Count -eq 0) { throw "No frontend version references in $relativePath." }
    $changes[$path] = [regex]::Replace($html, $pattern, [System.Text.RegularExpressions.MatchEvaluator]{
        param($match)
        $match.Groups["prefix"].Value + $Version
    })
}
foreach ($path in $changes.Keys) {
    $content = $changes[$path].Replace("`r`n", "`n").Replace("`r", "`n")
    [System.IO.File]::WriteAllText($path, $content, $utf8NoBom)
}
Write-Output "Application and frontend assets: v$Version"
Write-Output "Restart the server or deploy these source changes to apply the version."
