// Copies the packaged app into /Applications, replacing an older copy. Run: npm run install-app
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

if (process.platform !== 'darwin') {
  console.error('install-app is for macOS. On Windows/Linux use "npm run dist" and run the installer in release/.');
  process.exit(1);
}

const release = join(import.meta.dirname, '..', 'release');
const outDir = [`mac-${process.arch}`, 'mac'].find((d) => existsSync(join(release, d, 'Penumbra.app')));
if (!outDir) throw new Error('No packaged Penumbra.app found in release/');
const src = join(release, outDir, 'Penumbra.app');
const dest = '/Applications/Penumbra.app';
if (!existsSync(src)) throw new Error(`Build not found at ${src}`);

// Ad-hoc sign so Apple Silicon will launch the unsigned build.
execFileSync('codesign', ['--force', '--deep', '--sign', '-', src], { stdio: 'inherit' });
if (existsSync(dest)) execFileSync('rm', ['-rf', dest]);
execFileSync('ditto', [src, dest], { stdio: 'inherit' });
console.log(`Installed ${dest}`);
