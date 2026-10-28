param(
    [string]$Url = "https://www.insurveyone.com/",
    [string]$DestinationDirectory = ""
)

$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
$sourceIcon = Join-Path $repoRoot "frontend/assets/images/surveyone.ico"
$targetUri = $null
if (-not [Uri]::TryCreate($Url, [UriKind]::Absolute, [ref]$targetUri) -or
    $targetUri.Scheme -notin @("http", "https") -or
    $targetUri.UserInfo -or $Url -match '[\r\n]') {
    throw "Use an absolute HTTP(S) URL without credentials or line breaks."
}
if (-not (Test-Path -LiteralPath $sourceIcon -PathType Leaf)) {
    throw "The IN-SURVEYONE icon was not found."
}
if ([string]::IsNullOrWhiteSpace($DestinationDirectory)) {
    $DestinationDirectory = [Environment]::GetFolderPath("DesktopDirectory")
}
if ([string]::IsNullOrWhiteSpace($DestinationDirectory) -or
    -not (Test-Path -LiteralPath $DestinationDirectory -PathType Container)) {
    throw "The shortcut destination directory does not exist."
}
$DestinationDirectory = (Resolve-Path -LiteralPath $DestinationDirectory).Path
$iconDirectory = Join-Path ([Environment]::GetFolderPath("LocalApplicationData")) "IN-SURVEYONE/icons"
[void][System.IO.Directory]::CreateDirectory($iconDirectory)
$installedIcon = Join-Path $iconDirectory "surveyone.ico"
Copy-Item -LiteralPath $sourceIcon -Destination $installedIcon -Force
$shortcutPath = Join-Path $DestinationDirectory "IN-SURVEYONE.url"
$content = "[InternetShortcut]`r`nURL=$($targetUri.AbsoluteUri)`r`nIconFile=$installedIcon`r`nIconIndex=0`r`n"
# Windows InternetShortcut uses Unicode so localized profile paths remain valid.
[System.IO.File]::WriteAllText($shortcutPath, $content, [System.Text.Encoding]::Unicode)
Write-Output "Created IN-SURVEYONE desktop shortcut."
Write-Output "URL: $($targetUri.AbsoluteUri)"
