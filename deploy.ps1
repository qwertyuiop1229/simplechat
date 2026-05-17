# Covo Deploy Script
# Usage: .\deploy.ps1       (Confirm)
#        .\deploy.ps1 -y    (No Confirm)
#        npm run deploy     (No Confirm / Auto)

param([switch]$y)

$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "====================================" -ForegroundColor Cyan
Write-Host "  Covo Deploy Script" -ForegroundColor Cyan
Write-Host "====================================" -ForegroundColor Cyan
Write-Host ""

# 1. Read version from public/version.json (single source of truth)
$versionJsonPath = Join-Path $PSScriptRoot "public\version.json"
if (-not (Test-Path $versionJsonPath)) {
    Write-Host "ERROR: public/version.json not found" -ForegroundColor Red
    exit 1
}

$versionData = [System.IO.File]::ReadAllText($versionJsonPath, [System.Text.Encoding]::UTF8) | ConvertFrom-Json
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

# [0/5] Build Tailwind CSS
Write-Host "[0/5] Building Tailwind CSS..." -ForegroundColor Green
node_modules\.bin\tailwindcss.cmd -i tailwind.input.css -o public/styles.css --minify

# [1/5] Update version.json + sync tauri.conf.json (must match git tag)
$versionJsonContent = "{`n  `"version`": `"$newVersion`"`n}`n"
[System.IO.File]::WriteAllText($versionJsonPath, $versionJsonContent, [System.Text.UTF8Encoding]::new($false))
Write-Host "[1/5] Updated version.json to $newVersion" -ForegroundColor Green

$tauriConfPath = Join-Path $PSScriptRoot "src-tauri\tauri.conf.json"
if (Test-Path $tauriConfPath) {
    $tauriConfRaw = [System.IO.File]::ReadAllText($tauriConfPath, [System.Text.Encoding]::UTF8)
    $tauriConfNew = $tauriConfRaw -replace '"version":\s*"[^"]+"', ('"version": "' + $newVersion + '"')
    [System.IO.File]::WriteAllText($tauriConfPath, $tauriConfNew, [System.Text.UTF8Encoding]::new($false))
    # 確認: 書き込み後に読み直して一致検証
    $verify = [System.IO.File]::ReadAllText($tauriConfPath, [System.Text.Encoding]::UTF8)
    if ($verify -notlike ('*"version": "' + $newVersion + '"*')) {
        Write-Host "ERROR: tauri.conf.json sync failed — deploy aborted" -ForegroundColor Red
        exit 1
    }
    Write-Host "       Synced tauri.conf.json to $newVersion" -ForegroundColor Green
} else {
    Write-Host "WARNING: src-tauri/tauri.conf.json not found, skipping..." -ForegroundColor Yellow
}

# [2/5] git commit
Write-Host "[2/5] Committing changes..." -ForegroundColor Green
git add -A
git commit -m "Release v$newVersion"

# [3/5] git tag
Write-Host "[3/5] Creating tag $tagName..." -ForegroundColor Green
git tag $tagName

# [4/5] Firebase Hosting + Cloudflare Worker deploy
Write-Host "[4/5] Deploying to Firebase Hosting + Cloudflare Worker..." -ForegroundColor Green
firebase deploy --only hosting

# [5/5] git push → GitHub Actions が Windows インストーラーをビルドする
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
Write-Host "GitHub Actions (Windows build): https://github.com/qwertyuiop1229/simplechat/actions" -ForegroundColor Yellow
Write-Host ""
