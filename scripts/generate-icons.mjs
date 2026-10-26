import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'packages/ui/src/brand/kerf-logo.svg');
const outDir = path.join(root, 'assets');

// Match the macOS app-icon grid: an inset, rounded tile on a transparent
// canvas. The artwork itself is a full-bleed gold plate, so the inset and
// radius are applied here rather than baked into the shared SVG.
const PADDING = 0.06;
const RADIUS = 0.09;

const artwork = readFileSync(source, 'utf8').replace(
  '<svg ',
  '<svg preserveAspectRatio="xMidYMid slice" ',
);

const executablePath = process.env.KERF_CHROMIUM_PATH || undefined;
const browser = await chromium.launch(executablePath ? { executablePath } : {});
const page = await browser.newPage({
  viewport: { width: 1024, height: 1024 },
  deviceScaleFactor: 1,
});

async function render(size) {
  const inner = Math.round(size * (1 - PADDING * 2));
  const radius = Math.round(inner * RADIUS);
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<!doctype html>
    <style>
      html, body { margin: 0; background: transparent; }
      svg { display: block; width: 100%; height: 100%; }
    </style>
    <div style="width: ${size}px; height: ${size}px; display: grid; place-items: center">
      <div style="width: ${inner}px; height: ${inner}px; border-radius: ${radius}px; overflow: hidden">
        ${artwork}
      </div>
    </div>`);
  return page.screenshot({ omitBackground: true });
}

function buildIco(pngs, sizes) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(sizes.length, 4);

  const entries = [];
  let offset = 6 + sizes.length * 16;
  for (const [index, size] of sizes.entries()) {
    const png = pngs[index];
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0);
    entry.writeUInt8(size >= 256 ? 0 : size, 1);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += png.length;
    entries.push(entry);
  }

  return Buffer.concat([header, ...entries, ...pngs]);
}

await mkdir(outDir, { recursive: true });

const png = await render(512);
await writeFile(path.join(outDir, 'icon.png'), png);

const icoSizes = [16, 24, 32, 48, 64, 128, 256];
const icoPngs = [];
for (const size of icoSizes) {
  icoPngs.push(await render(size));
}
await writeFile(path.join(outDir, 'icon.ico'), buildIco(icoPngs, icoSizes));

if (process.platform === 'darwin') {
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'kerf-iconset-'));
  const iconset = path.join(tempRoot, 'kerf.iconset');
  await mkdir(iconset);
  const icnsEntries = [
    ['icon_16x16.png', 16],
    ['icon_16x16@2x.png', 32],
    ['icon_32x32.png', 32],
    ['icon_32x32@2x.png', 64],
    ['icon_128x128.png', 128],
    ['icon_128x128@2x.png', 256],
    ['icon_256x256.png', 256],
    ['icon_256x256@2x.png', 512],
    ['icon_512x512.png', 512],
    ['icon_512x512@2x.png', 1024],
  ];
  try {
    for (const [name, size] of icnsEntries) {
      await writeFile(path.join(iconset, name), await render(size));
    }
    execFileSync('iconutil', [
      '-c',
      'icns',
      iconset,
      '-o',
      path.join(outDir, 'icon.icns'),
    ]);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
} else {
  console.warn('Skipping .icns: iconutil is only available on macOS.');
}

await browser.close();
console.log(`Wrote app icons to ${path.relative(root, outDir)}/`);
