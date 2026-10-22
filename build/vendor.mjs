// Prepares the libraries that interactive widgets can use, as plain scripts that can be inlined
// into a sandboxed iframe (no network). Output: src/widgets/vendor/ (generated, gitignored).
import { build } from 'vite';
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'src', 'widgets', 'vendor');
const stamp = join(out, '.stamp');
const versions = ['chart.js', 'd3', 'three']
  .map((p) => `${p}@${JSON.parse(readFileSync(join(root, 'node_modules', p, 'package.json'), 'utf8')).version}`)
  .join(' ');

if (existsSync(stamp) && readFileSync(stamp, 'utf8') === versions) process.exit(0); // up to date
mkdirSync(out, { recursive: true });

copyFileSync(join(root, 'node_modules/chart.js/dist/chart.umd.min.js'), join(out, 'chart.js'));
copyFileSync(join(root, 'node_modules/d3/dist/d3.min.js'), join(out, 'd3.js'));

// three is ESM-only; bundle it into a script that defines a global THREE.
const entry = join(out, '.three-entry.js');
writeFileSync(entry, "export * from 'three';\n");
await build({
  configFile: false,
  logLevel: 'warn',
  root,
  publicDir: false,
  build: {
    outDir: out,
    emptyOutDir: false,
    minify: true,
    lib: { entry, formats: ['iife'], name: 'THREE', fileName: () => 'three.js' },
  },
});

writeFileSync(stamp, versions);
const sizes = ['chart.js', 'd3.js', 'three.js'].map((f) => `${f} ${(statSync(join(out, f)).size / 1024).toFixed(0)} KB`);
console.log(`Widget libraries ready: ${sizes.join(', ')}`);
