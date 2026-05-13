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

# 1. Read version from public/version.json (single source of truth)
$versionJsonPath = Join-Path $PSScriptRoot "public\version.json"
if (-not (Test-Path $versionJsonPath)) {
    Write-Host "ERROR: public/version.json not found" -ForegroundColor Red
    exit 1
}

$versionData = Get-Content $versionJsonPath -Raw | ConvertFrom-Json
$currentVersion = $versionData.version
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
$tagName = "v$newVersion"

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

# Build Tailwind CSS
Write-Host "[0/5] Building Tailwind CSS..." -ForegroundColor Green
node_modules\.bin\tailwindcss.cmd -i tailwind.input.css -o public/styles.css --minify

# Write new version to public/version.json
$versionJsonContent = "{`n  `"version`": `"$newVersion`"`n}`n"
$versionJsonContent | Set-Content $versionJsonPath -Encoding utf8 -NoNewline

Write-Host "[1/5] Updated version.json to $newVersion" -ForegroundColor Green

# Sync version to tauri.conf.json
$tauriConfPath = Join-Path $PSScriptRoot "src-tauri\tauri.conf.json"
if (Test-Path $tauriConfPath) {
    $tauriConfRaw = Get-Content $tauriConfPath -Raw
    $tauriConfRaw = $tauriConfRaw -replace [regex]::Escape("""version"": ""$currentVersion"""), """version"": ""$newVersion"""
    $tauriConfRaw | Set-Content $tauriConfPath -NoNewline
    Write-Host "       Synced tauri.conf.json to $newVersion" -ForegroundColor Green
}

# git add -> git commit -> tag
Write-Host "[2/5] Committing changes..." -ForegroundColor Green
git add -A
git commit -m "Release v$newVersion"

Write-Host "[3/5] Creating tag $tagName..." -ForegroundColor Green
git tag $tagName

# Firebase Hosting + Cloudflare Worker deploy
# DEPLOY_NO_BUMP=1 で bump-version.js のバンプをスキップ（既にバンプ済み）
Write-Host "[4/5] Deploying to Firebase Hosting + Cloudflare Worker..." -ForegroundColor Green
$env:DEPLOY_NO_BUMP = "1"
firebase deploy --only hosting
$env:DEPLOY_NO_BUMP = $null

# git push (GitHub Actions が EXE をビルドする)
Write-Host "[5/5] Pushing to GitHub..." -ForegroundColor Green
git push origin HEAD --tags

Write-Host ""
Write-Host "====================================" -ForegroundColor Cyan
Write-Host "  Deploy complete!" -ForegroundColor Green
Write-Host "  Version: $newVersion" -ForegroundColor Green
Write-Host "  Tag: $tagName" -ForegroundColor Green
Write-Host "====================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Firebase: https://simplechat-65a0d.web.app" -ForegroundColor Yellow
Write-Host "GitHub Actions (EXE build): https://github.com/qwertyuiop1229/simplechat/actions" -ForegroundColor Yellow
Write-Host ""
