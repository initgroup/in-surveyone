<#
.SYNOPSIS
Stages all changes, creates an auto-numbered daily commit, rebases from the
configured remote branch, and pushes.

.DESCRIPTION
Default commit message: in-surveyone-yyyyMMdd-N
#>

param(
    [string]$Remote = "origin",
    [string]$Branch = "main",
    [string]$MessagePrefix = "",
    [string]$RepositoryUrl = "https://github.com/initgroup/in-surveyone.git"
)

$ErrorActionPreference = "Stop"

$utf8NoBom = [System.Text.UTF8Encoding]::new($false)
[Console]::InputEncoding = $utf8NoBom
[Console]::OutputEncoding = $utf8NoBom
$OutputEncoding = $utf8NoBom
chcp.com 65001 | Out-Null

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = (Resolve-Path (Join-Path $scriptDir "..")).Path
Set-Location $repoRoot

if ([string]::IsNullOrWhiteSpace($MessagePrefix)) {
    $MessagePrefix = Split-Path -Leaf $repoRoot
}

function Invoke-Git {
    param([Parameter(ValueFromRemainingArguments = $true)][string[]]$GitArgs)

    Write-Host ""
    Write-Host "git $($GitArgs -join ' ')" -ForegroundColor Cyan
    & git @GitArgs
    if ($LASTEXITCODE -ne 0) {
        throw "Git command failed: git $($GitArgs -join ' ')"
    }
}

function Test-RemoteBranch {
    param(
        [Parameter(Mandatory = $true)][string]$RemoteName,
        [Parameter(Mandatory = $true)][string]$BranchName
    )

    Write-Host ""
    Write-Host "Checking remote branch: $RemoteName/$BranchName" -ForegroundColor Cyan
    & git ls-remote --exit-code --heads $RemoteName "refs/heads/$BranchName" | Out-Null
    if ($LASTEXITCODE -eq 0) {
        return $true
    }
    if ($LASTEXITCODE -eq 2) {
        return $false
    }
    throw "Unable to inspect remote branch '$RemoteName/$BranchName'."
}

function Get-NextCommitMessage {
    param([string]$Prefix, [string]$DateText)

    $pattern = "^$([regex]::Escape($Prefix))-$([regex]::Escape($DateText))-(\d+)$"
    $commitCount = & git rev-list --all --count
    if ($LASTEXITCODE -ne 0) {
        throw "Unable to count Git commits."
    }

    $subjects = @()
    if ([int]$commitCount -gt 0) {
        $subjects = & git log --all --format=%s --grep="$Prefix-$DateText-"
        if ($LASTEXITCODE -ne 0) {
            throw "Unable to read git log for commit sequence."
        }
    }

    $maxSequence = 0
    foreach ($subject in $subjects) {
        $match = [regex]::Match($subject, $pattern)
        if ($match.Success) {
            $sequence = [int]$match.Groups[1].Value
            if ($sequence -gt $maxSequence) {
                $maxSequence = $sequence
            }
        }
    }
    return "$Prefix-$DateText-$($maxSequence + 1)"
}

if (-not (Test-Path -LiteralPath (Join-Path $repoRoot ".git"))) {
    throw "Git metadata was not found: $repoRoot"
}

$remoteUrl = (& git remote get-url $Remote | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($remoteUrl)) {
    throw "Git remote '$Remote' is not configured. Add it before publishing."
}

$normalizedRemoteUrl = $remoteUrl.TrimEnd('/')
$normalizedRepositoryUrl = $RepositoryUrl.Trim().TrimEnd('/')
if (-not $normalizedRemoteUrl.Equals(
        $normalizedRepositoryUrl,
        [System.StringComparison]::OrdinalIgnoreCase
    )) {
    throw "Git remote '$Remote' points to '$remoteUrl'. Expected '$RepositoryUrl'."
}

$currentBranch = (& git branch --show-current).Trim()
if ($LASTEXITCODE -ne 0) {
    throw "Unable to read the current Git branch."
}
if ($currentBranch -ne $Branch) {
    throw "Current branch is '$currentBranch'. Switch to '$Branch' before publishing."
}

Invoke-Git status --short
$remoteBranchExists = Test-RemoteBranch -RemoteName $Remote -BranchName $Branch
if ($remoteBranchExists) {
    Invoke-Git fetch $Remote $Branch
}
else {
    Write-Host "Remote branch '$Remote/$Branch' does not exist. Preparing first publish." -ForegroundColor Yellow
}

Invoke-Git add -A
$staged = & git diff --cached --name-only
if ($LASTEXITCODE -ne 0) {
    throw "Unable to inspect staged changes."
}
if (-not $staged) {
    Write-Host "No staged changes. Nothing to commit or push." -ForegroundColor Yellow
    exit 0
}

$dateText = Get-Date -Format "yyyyMMdd"
$commitMessage = Get-NextCommitMessage -Prefix $MessagePrefix -DateText $dateText
Write-Host "Commit message: $commitMessage" -ForegroundColor Green
Invoke-Git commit -m $commitMessage

if ($remoteBranchExists) {
    Invoke-Git pull --rebase $Remote $Branch
    Invoke-Git push $Remote $Branch
}
else {
    Invoke-Git push --set-upstream $Remote $Branch
}

Write-Host "Publish complete." -ForegroundColor Green
