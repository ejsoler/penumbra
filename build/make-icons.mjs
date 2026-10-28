// Renders build/icon.svg to PNGs, a macOS .icns, and the browser favicon. Run: npm run icons
import { Resvg } from '@resvg/resvg-js';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync, copyFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const svg = readFileSync(join(dir, 'icon.svg'));
const render = (size) => new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng();

writeFileSync(join(dir, 'icon.png'), render(1024));
writeFileSync(join(dir, '..', 'public', 'favicon.png'), render(64));

if (process.platform === 'darwin') {
  const iconset = join(dir, 'icon.iconset');
  mkdirSync(iconset, { recursive: true });
  for (const s of [16, 32, 128, 256, 512]) {
    writeFileSync(join(iconset, `icon_${s}x${s}.png`), render(s));
    writeFileSync(join(iconset, `icon_${s}x${s}@2x.png`), render(s * 2));
  }
  execFileSync('iconutil', ['-c', 'icns', iconset, '-o', join(dir, 'icon.icns')]);
  rmSync(iconset, { recursive: true });
}
// Menu bar / tray icon: the mark alone, black on transparent (macOS tints "Template" images itself).
const tray = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="none" stroke="#000" stroke-width="2.4"/><path d="M12 3 A9 9 0 0 0 12 21 Z" fill="#000"/></svg>');
const renderTray = (size) => new Resvg(tray, { fitTo: { mode: 'width', value: size } }).render().asPng();
writeFileSync(join(dir, 'trayTemplate.png'), renderTray(16));
writeFileSync(join(dir, 'trayTemplate@2x.png'), renderTray(32));

console.log('Icons written to build/ and public/favicon.png');
