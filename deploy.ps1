# SimpleChat Windows Deploy Script
# Usage: .\deploy.ps1       (Confirm)
#        .\deploy.ps1 -y    (No Confirm)
#        npm run deploy     (No Confirm / Auto)

param([switch]$y)

$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "====================================" -ForegroundColor Cyan
Write-Host "  SimpleChat Deploy Script" -ForegroundColor Cyan
Write-Host "====================================" -ForegroundColor Cyan
Write-Host ""

# 1. Read version from tauri.conf.json
$tauriConfPath = Join-Path $PSScriptRoot "src-tauri\tauri.conf.json"
if (-not (Test-Path $tauriConfPath)) {
    Write-Host "ERROR: tauri.conf.json not found at $tauriConfPath" -ForegroundColor Red
    exit 1
}

$tauriConf = Get-Content $tauriConfPath -Raw | ConvertFrom-Json
$currentVersion = $tauriConf.version
Write-Host "Current version: $currentVersion" -ForegroundColor Yellow

# 2. Increment patch version
$versionParts = $currentVersion.Split(".")
if ($versionParts.Length -ne 3) {
    Write-Host "ERROR: Invalid version format. Expected x.y.z" -ForegroundColor Red
    exit 1
}

$major = [int]$versionParts[0]
$minor = [int]$versionParts[1]
$patch = [int]$versionParts[2]
$patch++
$newVersion = "$major.$minor.$patch"
$tagName = "app-v$newVersion"

Write-Host "New version: $newVersion" -ForegroundColor Green
Write-Host "Tag name: $tagName" -ForegroundColor Green
Write-Host ""

# Confirm
if (-not $y) {
    Write-Host "Deploy v${newVersion}? (y/n): " -ForegroundColor White -NoNewline
    try {
        $confirm = [Console]::ReadLine()
        if ($confirm -ne "y" -and $confirm -ne "Y") {
            Write-Host "Deploy cancelled." -ForegroundColor Yellow
            exit 0
        }
    } catch {
        Write-Host "Deploy cancelled. (Non-interactive mode requires -y)" -ForegroundColor Yellow
        exit 1
    }
}

Write-Host "Deploying v$newVersion..." -ForegroundColor Green

# 3. Write new version to tauri.conf.json
$tauriConfRaw = Get-Content $tauriConfPath -Raw
$tauriConfRaw = $tauriConfRaw -replace [regex]::Escape("""version"": ""$currentVersion"""), """version"": ""$newVersion"""
$tauriConfRaw | Set-Content $tauriConfPath -NoNewline

Write-Host "[1/4] Updated tauri.conf.json version to $newVersion" -ForegroundColor Green

# 4. git add -> git commit
Write-Host "[2/4] Committing changes..." -ForegroundColor Green
git add -A
git commit -m "Release v$newVersion"

# 5. git tag
Write-Host "[3/4] Creating tag $tagName..." -ForegroundColor Green
git tag $tagName

# 6. git push
Write-Host "[4/4] Pushing to GitHub..." -ForegroundColor Green
git push origin main --tags

Write-Host ""
Write-Host "====================================" -ForegroundColor Cyan
Write-Host "  Deploy complete!" -ForegroundColor Green
Write-Host "  Version: $newVersion" -ForegroundColor Green
Write-Host "  Tag: $tagName" -ForegroundColor Green
Write-Host "====================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "GitHub Actions will now build the installer." -ForegroundColor Yellow
Write-Host "Check: https://github.com/qwertyuiop1229/simplechat/actions" -ForegroundColor Yellow
Write-Host ""
