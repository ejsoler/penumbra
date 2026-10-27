// Update check: asks GitHub for the newest published release and, when it's newer than this build,
// downloads the installer for this computer to the Downloads folder. The builds aren't code-signed,
// so they can't replace themselves silently; the user opens the installer when it suits them.
// The renderer never passes a URL: main keeps the release it found and downloads only its assets.
const { app, ipcMain, shell } = require('electron');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const REPO = 'ejsoler/penumbra';
const USER_AGENT = `Penumbra/${app.getVersion()} (+https://github.com/${REPO})`;
const DOWNLOAD_HOSTS = ['github.com', 'objects.githubusercontent.com', 'release-assets.githubusercontent.com'];

/** For trying the flow in development: PENUMBRA_FAKE_VERSION=0.0.1 npm run app */
const currentVersion = () => (!app.isPackaged && process.env.PENUMBRA_FAKE_VERSION) || app.getVersion();

/** -1, 0 or 1. Ignores a leading "v" and anything after "-" (pre-release tags aren't offered anyway). */
function compareVersions(a, b) {
  const parts = (v) => String(v).replace(/^v/, '').split('-')[0].split('.').map((n) => parseInt(n, 10) || 0);
  const x = parts(a);
  const y = parts(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0) ? 1 : -1;
  }
  return 0;
}

const ARCH_NAMES = { x64: ['x64', 'x86_64', 'amd64'], arm64: ['arm64', 'aarch64'] };

/** The installer that fits this computer, plus electron-builder's checksum file for it. */
function pickAsset(assets) {
  const arch = ARCH_NAMES[process.arch] ?? [process.arch];
  const named = (ext) => assets.filter((a) => a.name.toLowerCase().endsWith(ext));
  const forArch = (list) => list.find((a) => arch.some((n) => a.name.includes(`-${n}.`))) ?? null;
  let file = null;
  let manifest = null;
  if (process.platform === 'darwin') {
    file = forArch(named('.dmg'));
    manifest = 'latest-mac.yml';
  } else if (process.platform === 'win32') {
    file = forArch(named('.exe')) ?? named('.exe')[0] ?? null;
    manifest = 'latest.yml';
  } else {
    // Running from an AppImage sets APPIMAGE; otherwise assume the .deb was installed.
    file = forArch(named(process.env.APPIMAGE ? '.appimage' : '.deb'));
    manifest = process.arch === 'arm64' ? 'latest-linux-arm64.yml' : 'latest-linux.yml';
  }
  return { file, manifest: assets.find((a) => a.name === manifest) ?? null };
}

const trusted = (url) => {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && DOWNLOAD_HOSTS.includes(u.hostname);
  } catch {
    return false;
  }
};

let latest = null; // the release found by the last check
let download = null; // { promise, path, controller }

async function check() {
  const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/vnd.github+json' },
    signal: AbortSignal.timeout(15000),
  });
  // 404 means there's no published release yet.
  if (res.status === 404) return { current: currentVersion(), available: false };
  if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
  const r = await res.json();
  const version = String(r.tag_name || '').replace(/^v/, '');
  const available = !r.draft && !r.prerelease && compareVersions(version, currentVersion()) > 0;
  const { file, manifest } = pickAsset(Array.isArray(r.assets) ? r.assets : []);
  latest = available ? { version, url: r.html_url, file, manifest } : null;
  return {
    current: currentVersion(),
    available,
    version,
    url: String(r.html_url || `https://github.com/${REPO}/releases`),
    notes: String(r.body || '').slice(0, 4000),
    publishedAt: r.published_at || null,
    file: file ? { name: file.name, size: file.size } : null,
  };
}

/** The sha512 electron-builder recorded for a file, from latest*.yml. */
async function expectedHash(manifest, name) {
  if (!manifest || !trusted(manifest.browser_download_url)) return null;
  const res = await fetch(manifest.browser_download_url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(15000) });
  if (!res.ok) return null;
  const yml = await res.text();
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return yml.match(new RegExp(`url:\\s*${escaped}\\s*\\n\\s*sha512:\\s*(\\S+)`))?.[1] ?? null;
}

async function fetchInstaller(sender) {
  const { file, manifest } = latest;
  if (!trusted(file.browser_download_url)) throw new Error('Unexpected download address');
  const dest = path.join(app.getPath('downloads'), path.basename(file.name));
  const want = await expectedHash(manifest, file.name);
  const hashOf = (p) => new Promise((resolve, reject) => {
    const h = crypto.createHash('sha512');
    fs.createReadStream(p).on('data', (d) => h.update(d)).on('end', () => resolve(h.digest('base64'))).on('error', reject);
  });
  // Already downloaded (and intact)? Don't fetch it twice.
  if (fs.existsSync(dest) && fs.statSync(dest).size === file.size && (!want || (await hashOf(dest)) === want)) return dest;

  const controller = new AbortController();
  download.controller = controller;
  const res = await fetch(file.browser_download_url, { headers: { 'User-Agent': USER_AGENT }, signal: controller.signal });
  if (!res.ok || !res.body) throw new Error(`Download failed (${res.status})`);
  const total = Number(res.headers.get('content-length')) || file.size || 0;
  const part = dest + '.part';
  const out = fs.createWriteStream(part);
  const hash = crypto.createHash('sha512');
  let got = 0;
  let last = 0;
  try {
    for await (const chunk of res.body) {
      hash.update(chunk);
      got += chunk.length;
      if (!out.write(chunk)) await new Promise((r) => out.once('drain', r));
      if (Date.now() - last > 250 && !sender.isDestroyed()) {
        last = Date.now();
        sender.send('update:progress', { got, total });
      }
    }
    await new Promise((resolve, reject) => out.end((e) => (e ? reject(e) : resolve())));
  } catch (e) {
    out.destroy();
    fs.rmSync(part, { force: true });
    throw controller.signal.aborted ? new Error('Download cancelled') : e;
  }
  if (want && hash.digest('base64') !== want) {
    fs.rmSync(part, { force: true });
    throw new Error("The download doesn't match the release's checksum. Try again.");
  }
  fs.renameSync(part, dest);
  if (dest.toLowerCase().endsWith('.appimage')) fs.chmodSync(dest, 0o755);
  return dest;
}

function registerUpdates() {
  const handle = (channel, fn) =>
    ipcMain.handle(channel, (e, ...args) => {
      if (e.senderFrame !== e.sender.mainFrame) throw new Error('Not allowed');
      return fn(e, ...args);
    });
  handle('update:check', () => check());
  handle('update:download', (e) => {
    if (!latest?.file) throw new Error('No installer for this computer in the release');
    if (download?.version === latest.version && download.promise) return download.promise;
    download = { version: latest.version, controller: null, promise: null };
    download.promise = fetchInstaller(e.sender).catch((err) => {
      download = null;
      throw err;
    });
    return download.promise;
  });
  handle('update:cancel', () => download?.controller?.abort());
  // Opens the downloaded installer: a mounted disk image on macOS, the setup program on Windows.
  handle('update:install', async (_e, file) => {
    const p = await download?.promise;
    if (!p || p !== file) throw new Error('Download the update first');
    if (process.platform === 'linux' && p.toLowerCase().endsWith('.appimage')) {
      shell.showItemInFolder(p);
      return 'shown';
    }
    const err = await shell.openPath(p);
    if (err) throw new Error(err);
    // The Windows installer replaces the app's files, which it can't do while Penumbra is running.
    if (process.platform === 'win32') setTimeout(() => app.quit(), 1500);
    return 'opened';
  });
  handle('update:reveal', async () => {
    const p = await download?.promise;
    if (p) shell.showItemInFolder(p);
  });
}

module.exports = { registerUpdates, compareVersions };
