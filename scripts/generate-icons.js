#!/usr/bin/env node
const { Jimp } = require('jimp');
const fs = require('fs');
const path = require('path');

const SRC = path.resolve(__dirname, '../covoの新しいアイコン３.png');
const PUBLIC = path.resolve(__dirname, '../public');

function createIco(pngData, width, height) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);

  const dirEntry = Buffer.alloc(16);
  dirEntry.writeUInt8(width >= 256 ? 0 : width, 0);
  dirEntry.writeUInt8(height >= 256 ? 0 : height, 1);
  dirEntry.writeUInt8(0, 2);
  dirEntry.writeUInt8(0, 3);
  dirEntry.writeUInt16LE(1, 4);
  dirEntry.writeUInt16LE(32, 6);
  dirEntry.writeUInt32LE(pngData.length, 8);
  dirEntry.writeUInt32LE(6 + 16, 12);

  return Buffer.concat([header, dirEntry, pngData]);
}

async function main() {
  const img = await Jimp.read(SRC);
  console.log(`Source: ${img.bitmap.width}x${img.bitmap.height}`);

  const pngSizes = [
    { file: 'icon-192x192.png', size: 192 },
    { file: 'icon-512x512.png', size: 512 },
    { file: 'apple-touch-icon.png', size: 180 },
  ];

  for (const { file, size } of pngSizes) {
    const resized = img.clone().resize({ w: size, h: size });
    await resized.write(path.join(PUBLIC, file));
    console.log(`✓ ${file} (${size}x${size})`);
  }

  const favicon = img.clone().resize({ w: 32, h: 32 });
  const pngBuf = await favicon.getBuffer('image/png');
  const icoBuf = createIco(pngBuf, 32, 32);
  fs.writeFileSync(path.join(PUBLIC, 'favicon.ico'), icoBuf);
  console.log('✓ favicon.ico (32x32)');

  console.log('\nDone.');
}

main().catch(e => { console.error(e); process.exit(1); });
