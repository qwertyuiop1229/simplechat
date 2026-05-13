#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const v = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../public/version.json'), 'utf8')).version;
console.log('');
console.log('====================================');
console.log(`  Deployed: v${v}`);
console.log('====================================');
console.log('');
