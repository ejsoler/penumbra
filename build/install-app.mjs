// Copies the packaged app into /Applications, replacing an older copy. Run: npm run install-app
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const release = join(import.meta.dirname, '..', 'release');
const outDir = readdirSync(release).find((d) => d.startsWith('mac'));
const src = join(release, outDir, 'Ollama Studio.app');
const dest = '/Applications/Ollama Studio.app';
if (!existsSync(src)) throw new Error(`Build not found at ${src}`);

// Ad-hoc sign so Apple Silicon will launch the unsigned build.
execFileSync('codesign', ['--force', '--deep', '--sign', '-', src], { stdio: 'inherit' });
if (existsSync(dest)) execFileSync('rm', ['-rf', dest]);
execFileSync('ditto', [src, dest], { stdio: 'inherit' });
console.log(`Installed ${dest}`);
