#!/usr/bin/env node
/**
 * バージョン管理は deploy.ps1 (npm run deploy) が一元担う。
 * firebase deploy 直接実行時はバンプしない。
 *   - タグなし・git push なし → Windows ビルドが動かない
 *   - tauri.conf.json との同期漏れを防ぐ
 */
console.log('[version] skip bump (use "npm run deploy" to bump)');
process.exit(0);
