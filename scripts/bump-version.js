#!/usr/bin/env node
/**
 * バージョン自動インクリメントスクリプト
 * firebase.json の predeploy から呼ばれる
 *
 * GitHub Actions 経由（npm run deploy → git push → GHA → firebase deploy）の場合は
 * 二重インクリメントを防ぐためスキップする
 */

const fs = require('fs');
const path = require('path');

// deploy.ps1 または GitHub Actions から実行された場合はスキップ（既にバンプ済みのため）
if (process.env.GITHUB_ACTIONS === 'true' || process.env.DEPLOY_NO_BUMP === '1') {
  const cur = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../public/version.json'), 'utf8')).version;
  console.log(`[version] skip bump, current: ${cur}`);
  process.exit(0);
}

const versionPath = path.resolve(__dirname, '../public/version.json');
const data = JSON.parse(fs.readFileSync(versionPath, 'utf8'));
const prev = data.version;
const [major, minor, patch] = prev.split('.').map(Number);
const next = `${major}.${minor}.${patch + 1}`;

fs.writeFileSync(versionPath, `{\n  "version": "${next}"\n}\n`, 'utf8');
console.log(`[version] ${prev} → ${next}`);
