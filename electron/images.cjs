// Local image generation, outside Ollama. Image models are GGUF files downloaded from Hugging Face and run
// by stable-diffusion.cpp (github.com/leejet/stable-diffusion.cpp), which is downloaded the first time it's
// needed. Each model family needs a few shared files (a VAE and text encoders), downloaded once.
// Everything lives in <userData>/images. Downloads come only from huggingface.co and the engine's GitHub
// releases, and are checked against the hashes those sites publish.
const { app, BrowserWindow, dialog, ipcMain, net, protocol, session, shell } = require('electron');
const { pathToFileURL } = require('url');
const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { readZip } = require('./skills.cjs');
const { checkRoot } = require('./tools.cjs');

const HF = 'https://huggingface.co';
const ENGINE_REPO = 'leejet/stable-diffusion.cpp';
const USER_AGENT = `Penumbra/${app.getVersion()} (+https://github.com/ejsoler/penumbra)`;
const TRUSTED = ['api.github.com', 'huggingface.co', 'cdn-lfs.huggingface.co', 'cdn-lfs-us-1.huggingface.co', 'cas-bridge.xethub.hf.co', 'github.com', 'objects.githubusercontent.com', 'release-assets.githubusercontent.com'];

const base = () => path.join(app.getPath('userData'), 'images');
const dirs = () => ({
  models: path.join(base(), 'models'),
  shared: path.join(base(), 'shared'),
  engine: path.join(base(), 'engine'),
  outputs: path.join(base(), 'outputs'),
});

// ---- where images are saved ---------------------------------------------------------------------------
// By default in Pictures/Penumbra; the Images tab can change that, and a chat with a folder saves there.
// Penumbra keeps a list of the images it made (history.json): the gallery reads it, and chats may only
// show images on it.

// Each profile has its own image list and save folder (models stay shared). The default profile uses base().
const profileDirs = new Map(); // webContents id → that window's profile folder for images
/** Gives a window's profile its own image list and settings folder. */
function setImagesFolder(webContents, dir) {
  profileDirs.set(webContents.id, dir);
  webContents.once('destroyed', () => profileDirs.delete(webContents.id));
}
const dirFor = (sender) => (sender && profileDirs.get(sender.id)) || base();

const settingsPath = (d) => path.join(d, 'settings.json');
const readJson = (p, fallback) => {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return fallback;
  }
};
const defaultSaveDir = () => path.join(app.getPath('pictures'), 'Penumbra');
const saveDir = (d) => readJson(settingsPath(d), {}).saveDir || defaultSaveDir();
const setSaveDir = (d, dir) => {
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(settingsPath(d), JSON.stringify({ ...readJson(settingsPath(d), {}), saveDir: dir || undefined }));
};

const historyPath = (d) => path.join(d, 'history.json');
const MAX_HISTORY = 1000;
function readHistory(dir) {
  const h = readJson(historyPath(dir), null);
  if (h) return h;
  if (dir !== base()) return [];
  // First run with a history (default profile): list images made before, in the old outputs folder.
  const d = dirs().outputs;
  const old = fs.existsSync(d)
    ? fs.readdirSync(d).filter((f) => f.endsWith('.png')).map((f) => ({ file: path.join(d, f), ...readJson(path.join(d, f.replace(/\.png$/, '.json')), {}) }))
    : [];
  writeHistory(dir, old.sort((a, b) => (b.at ?? 0) - (a.at ?? 0)));
  return old;
}
function writeHistory(dir, list) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(historyPath(dir), JSON.stringify(list.slice(0, MAX_HISTORY)));
}
/** The path, if it's an image this profile made (and still exists). */
const madeByUs = (dir, file) => {
  const p = path.resolve(String(file ?? ''));
  return p.endsWith('.png') && fs.existsSync(p) && readHistory(dir).some((h) => h.file === p) ? p : null;
};

/** "2026-10-31 18.20 cozy lighthouse on a cliff.png", numbered if taken. */
function imageName(dir, prompt) {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}.${pad(d.getMinutes())}`;
  const words = String(prompt).toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, ' ').split(/\s+/).filter((w) => w && !['a', 'an', 'the', 'of', 'and', 'with', 'in', 'on'].includes(w)).slice(0, 6).join(' ');
  const baseName = `${stamp} ${words || 'image'}`.slice(0, 80).trim();
  let name = `${baseName}.png`;
  for (let i = 2; fs.existsSync(path.join(dir, name)); i++) name = `${baseName} ${i}.png`;
  return path.join(dir, name);
}

// ---- model families -------------------------------------------------------------------------------

const AE = { repo: 'Comfy-Org/z_image_turbo', file: 'split_files/vae/ae.safetensors', name: 'ae.safetensors' };
const FAMILIES = {
  zimage: {
    label: 'Z-Image',
    archs: ['lumina2', 'z_image', 'zimage'],
    shared: {
      vae: AE,
      llm: { repo: 'unsloth/Qwen3-4B-Instruct-2507-GGUF', file: 'Qwen3-4B-Instruct-2507-Q4_K_M.gguf', name: 'Qwen3-4B-Instruct-2507-Q4_K_M.gguf' },
    },
    steps: () => 8,
    args: (s) => ['--vae', s.vae, '--llm', s.llm, '--cfg-scale', '1.0'],
  },
  flux: {
    label: 'FLUX.1',
    archs: ['flux'],
    shared: {
      vae: AE,
      clip_l: { repo: 'comfyanonymous/flux_text_encoders', file: 'clip_l.safetensors', name: 'clip_l.safetensors' },
      t5xxl: { repo: 'city96/t5-v1_1-xxl-encoder-gguf', file: 't5-v1_1-xxl-encoder-Q8_0.gguf', name: 't5-v1_1-xxl-encoder-Q8_0.gguf' },
    },
    // FLUX.1 schnell is made for a few steps; dev needs more.
    steps: (m) => (/schnell/i.test(m.repo + m.file) ? 4 : 20),
    args: (s) => ['--vae', s.vae, '--clip_l', s.clip_l, '--t5xxl', s.t5xxl, '--cfg-scale', '1.0', '--sampling-method', 'euler', '--clip-on-cpu'],
  },
};
const familyOf = (arch) => Object.entries(FAMILIES).find(([, f]) => f.archs.includes(String(arch).toLowerCase()))?.[0] ?? null;

// ---- downloads ------------------------------------------------------------------------------------

const trusted = (url) => {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && (TRUSTED.includes(u.hostname) || u.hostname.endsWith('.huggingface.co') || u.hostname.endsWith('.hf.co'));
  } catch {
    return false;
  }
};
const safeRepo = (repo) => /^[\w.-]+\/[\w.-]+$/.test(String(repo));
const safeFile = (file) => typeof file === 'string' && !file.split('/').some((p) => p === '..' || p === '') && !path.isAbsolute(file);
const hfUrl = (repo, file) => `${HF}/${repo}/resolve/main/${file.split('/').map(encodeURIComponent).join('/')}`;

/** Follows redirects by hand, so every hop is checked against the trusted hosts. */
async function get(url, init = {}) {
  for (let hops = 0; hops < 6; hops++) {
    if (!trusted(url)) throw new Error(`Refusing to download from ${new URL(url).hostname}`);
    const res = await fetch(url, { ...init, redirect: 'manual', headers: { 'User-Agent': USER_AGENT, ...init.headers } });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      url = new URL(res.headers.get('location'), url).toString();
      continue;
    }
    return res;
  }
  throw new Error('Too many redirects');
}

/** A Hugging Face file's size and sha256, from the repo listing. */
async function hfInfo(repo, file) {
  const dir = file.includes('/') ? file.slice(0, file.lastIndexOf('/')) : '';
  const res = await get(`${HF}/api/models/${repo}/tree/main${dir ? '/' + dir.split('/').map(encodeURIComponent).join('/') : ''}`);
  if (res.status === 401 || res.status === 403) throw new Error(`${repo} is gated or private. Accept its terms on huggingface.co first.`);
  if (!res.ok) throw new Error(`Couldn't list ${repo} (${res.status})`);
  const entry = (await res.json()).find((e) => e.path === file);
  if (!entry) throw new Error(`${file} isn't in ${repo}`);
  return { size: entry.lfs?.size ?? entry.size, sha256: entry.lfs?.oid ?? null };
}

const jobs = new Map(); // id → { controller, cancelled }

/** Downloads one file to `dest`, resuming a .part file, and checks its size and hash. */
async function fetchFile({ url, dest, size, sha256, onBytes, signal }) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (fs.existsSync(dest) && (!size || fs.statSync(dest).size === size)) return;
  const part = dest + '.part';
  let have = fs.existsSync(part) ? fs.statSync(part).size : 0;
  if (size && have > size) {
    fs.rmSync(part);
    have = 0;
  }
  const res = await get(url, { signal, headers: have ? { Range: `bytes=${have}-` } : {} });
  if (have && res.status !== 206) have = 0; // the server ignored the range: start over
  if (!res.ok || !res.body) throw new Error(`Download failed (${res.status})`);
  const out = fs.createWriteStream(part, { flags: have ? 'a' : 'w' });
  let got = have;
  onBytes(got);
  try {
    for await (const chunk of res.body) {
      if (!out.write(chunk)) await new Promise((r) => out.once('drain', r));
      got += chunk.length;
      onBytes(got);
    }
    await new Promise((resolve, reject) => out.end((e) => (e ? reject(e) : resolve())));
  } catch (e) {
    out.destroy();
    throw signal?.aborted ? new Error('Download cancelled') : e;
  }
  if (size && fs.statSync(part).size !== size) throw new Error(`${path.basename(dest)} is incomplete. Try again.`);
  if (sha256) {
    const hash = crypto.createHash('sha256');
    await new Promise((resolve, reject) => fs.createReadStream(part).on('data', (d) => hash.update(d)).on('end', resolve).on('error', reject));
    if (hash.digest('hex') !== sha256) {
      fs.rmSync(part, { force: true });
      throw new Error(`${path.basename(dest)} doesn't match its published checksum, so it was deleted. Try again.`);
    }
  }
  fs.renameSync(part, dest);
}

// Generated images are shown in chats as penumbra-image://img/<path>, served only for images Penumbra made,
// so chats store a short reference instead of megabytes of image data. Must run before app ready.
protocol.registerSchemesAsPrivileged([{ scheme: 'penumbra-image', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

/** Serves a profile's images on its session (each profile has its own session). */
function serveImages(ses = session.defaultSession, dir = base()) {
  ses.protocol.handle('penumbra-image', (req) => {
    // penumbra-image://img/<encoded full path>, only for images on Penumbra's list.
    const p = madeByUs(dir, decodeURIComponent(new URL(req.url).pathname.replace(/^\//, '')));
    if (!p) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(p).toString());
  });
}

// ---- the engine -----------------------------------------------------------------------------------

const ENGINE_EXE = process.platform === 'win32' ? 'sd-cli.exe' : 'sd-cli';

/** stable-diffusion.cpp publishes builds for Apple Silicon Macs, and x64 Windows and Linux. */
const engineSupported = () => (process.platform === 'darwin' ? process.arch === 'arm64' : ['win32', 'linux'].includes(process.platform) && process.arch === 'x64');

/** The release file for this computer, preferring a GPU build. */
function pickEngineAsset(assets) {
  const by = (re) => assets.find((a) => re.test(a.name));
  if (process.platform === 'darwin') return process.arch === 'arm64' ? by(/Darwin-macOS-.*-arm64\.zip$/) : null;
  if (process.platform === 'win32') return process.arch === 'x64' ? by(/win-vulkan-x64\.zip$/) ?? by(/win-cpu-x64\.zip$/) : null;
  if (process.platform === 'linux') return process.arch === 'x64' ? by(/Linux-.*x86_64-vulkan\.zip$/) ?? by(/Linux-.*x86_64\.zip$/) : null;
  return null;
}

function installedEngine() {
  const d = dirs().engine;
  try {
    const meta = JSON.parse(fs.readFileSync(path.join(d, 'engine.json'), 'utf8'));
    const exe = path.join(d, meta.version, ENGINE_EXE);
    return fs.existsSync(exe) ? { ...meta, exe } : null;
  } catch {
    return null;
  }
}

async function installEngine(send, signal) {
  const res = await get(`https://api.github.com/repos/${ENGINE_REPO}/releases/latest`, { signal, headers: { Accept: 'application/vnd.github+json' } });
  if (!res.ok) throw new Error(`Couldn't reach GitHub for the image engine (${res.status})`);
  const release = await res.json();
  const asset = pickEngineAsset(release.assets ?? []);
  if (!asset) throw new Error("There's no image engine build for this computer yet.");
  const version = String(release.tag_name).replace(/[^\w.-]/g, '');
  const d = dirs().engine;
  const zip = path.join(d, `${version}.zip`);
  const sha256 = String(asset.digest ?? '').replace(/^sha256:/, '') || null;
  await fetchFile({ url: asset.browser_download_url, dest: zip, size: asset.size, sha256, signal, onBytes: (got) => send({ file: 'Image engine', got, total: asset.size }) });
  const files = readZip(zip, 600 * 1024 * 1024);
  const into = path.join(d, version);
  fs.rmSync(into, { recursive: true, force: true });
  for (const [name, data] of Object.entries(files)) {
    if (!safeFile(name)) continue;
    const p = path.join(into, name);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, data);
    if (process.platform !== 'win32' && (/^sd-/.test(path.basename(name)) || /\.(dylib|so)/.test(name))) fs.chmodSync(p, 0o755);
  }
  fs.rmSync(zip, { force: true });
  if (!fs.existsSync(path.join(into, ENGINE_EXE))) throw new Error('The image engine download is missing its program');
  fs.writeFileSync(path.join(d, 'engine.json'), JSON.stringify({ version, asset: asset.name, installedAt: Date.now() }));
}

// ---- installed models -----------------------------------------------------------------------------

const manifestPath = () => path.join(base(), 'models.json');
const readManifest = () => {
  try {
    return JSON.parse(fs.readFileSync(manifestPath(), 'utf8'));
  } catch {
    return [];
  }
};
const writeManifest = (list) => {
  fs.mkdirSync(base(), { recursive: true });
  fs.writeFileSync(manifestPath(), JSON.stringify(list, null, 1));
};
const modelId = (repo, file) => `${repo}:${file}`;
const sharedPath = (s) => path.join(dirs().shared, s.name);

function status() {
  const engine = installedEngine();
  const models = readManifest()
    .filter((m) => fs.existsSync(m.path))
    .map((m) => {
      const fam = FAMILIES[m.family];
      const missing = fam ? Object.values(fam.shared).filter((s) => !fs.existsSync(sharedPath(s))).map((s) => s.name) : [];
      return { id: m.id, repo: m.repo, file: m.file, family: m.family, familyLabel: fam?.label ?? m.family, size: m.size, nsfw: !!m.nsfw, addedAt: m.addedAt, ready: missing.length === 0, missing };
    });
  return {
    supported: engineSupported(),
    engine: engine ? { version: engine.version } : null,
    models,
    families: Object.fromEntries(Object.entries(FAMILIES).map(([k, f]) => [k, f.label])),
    folder: base(),
  };
}

/** Reads a GGUF file's architecture from its first bytes (a range request), without downloading it. */
async function inspect(repo, file) {
  if (!safeRepo(repo) || !safeFile(file)) throw new Error('Not a Hugging Face file');
  if (!/\.gguf$/i.test(file)) return { arch: null, family: null, reason: 'Only GGUF image models are supported for now' };
  const res = await get(hfUrl(repo, file), { headers: { Range: 'bytes=0-262143' } });
  if (!res.ok) throw new Error(`Couldn't read ${file} (${res.status})`);
  const b = Buffer.from(await res.arrayBuffer());
  if (b.toString('latin1', 0, 4) !== 'GGUF') return { arch: null, family: null, reason: "This file isn't a GGUF model" };
  let o = 8;
  const u64 = () => { const v = Number(b.readBigUInt64LE(o)); o += 8; return v; };
  const str = () => { const n = u64(); const s = b.toString('utf8', o, o + n); o += n; return s; };
  const SIZES = { 0: 1, 1: 1, 2: 2, 3: 2, 4: 4, 5: 4, 6: 4, 7: 1, 10: 8, 11: 8, 12: 8 };
  const skip = (t) => {
    if (t === 8) return void str();
    if (t === 9) {
      const at = b.readUInt32LE(o); o += 4;
      const n = u64();
      for (let i = 0; i < n; i++) skip(at);
      return;
    }
    o += SIZES[t] ?? 0;
  };
  const tensors = u64();
  const kvs = u64();
  let arch = null;
  for (let i = 0; i < kvs && o < b.length - 16; i++) {
    const key = str();
    const t = b.readUInt32LE(o); o += 4;
    if (key === 'general.architecture' && t === 8) arch = str();
    else skip(t);
  }
  // stable-diffusion.cpp's own converter writes no architecture; the tensor names still tell.
  if (!arch) {
    const names = [];
    try {
      for (let i = 0; i < Math.min(tensors, 400) && o < b.length - 64; i++) {
        names.push(str());
        const dims = b.readUInt32LE(o); o += 4 + dims * 8 + 4 + 8;
      }
    } catch {
      /* ran past the bytes we read */
    }
    const strip = (n) => n.replace(/^(model\.)?diffusion_model\./, '');
    if (names.some((n) => /^(cap_embedder|context_refiner|noise_refiner)\./.test(strip(n)))) arch = 'lumina2';
    // FLUX.2 also has double and single blocks, plus shared "stream modulation" layers FLUX.1 doesn't.
    else if (names.some((n) => /^(double|single)_stream_modulation/.test(strip(n)))) arch = 'flux2';
    else if (names.some((n) => /^(double_blocks|single_blocks)\.\d+\./.test(strip(n)))) arch = 'flux';
  }
  const family = arch ? familyOf(arch) : null;
  return { arch, family, familyLabel: family ? FAMILIES[family].label : null, reason: family ? null : arch ? `${arch} models aren't supported yet` : "Couldn't tell what kind of model this is" };
}

/** Downloads a model, the engine, and the model family's shared files, as one job with combined progress. */
async function download(sender, { repo, file, nsfw }) {
  if (!safeRepo(repo) || !safeFile(file)) throw new Error('Not a Hugging Face file');
  const info = await inspect(repo, file);
  if (!info.family) throw new Error(info.reason);
  const fam = FAMILIES[info.family];
  const id = modelId(repo, file);
  if (jobs.has(id)) return id;
  const controller = new AbortController();
  jobs.set(id, { controller });
  const send = (p) => !sender.isDestroyed() && sender.send('images:progress', { id, ...p });
  (async () => {
    try {
      const list = [];
      const main = await hfInfo(repo, file);
      const dest = path.join(dirs().models, repo.replace('/', '__'), file);
      list.push({ label: file.split('/').pop(), url: hfUrl(repo, file), dest, ...main });
      for (const s of Object.values(fam.shared)) {
        if (fs.existsSync(sharedPath(s))) continue;
        list.push({ label: s.name, url: hfUrl(s.repo, s.file), dest: sharedPath(s), ...(await hfInfo(s.repo, s.file)) });
      }
      // Bytes for the whole job, so the bar doesn't restart for each file.
      const total = list.reduce((n, f) => n + (f.size || 0), 0);
      let before = 0;
      if (!installedEngine()) await installEngine((p) => send({ phase: 'engine', ...p }), controller.signal);
      for (const f of list) {
        await fetchFile({ ...f, signal: controller.signal, onBytes: (got) => send({ phase: 'downloading', file: f.label, got: before + got, total }) });
        before += f.size || 0;
      }
      const entry = { id, repo, file, family: info.family, size: main.size, path: dest, nsfw: !!nsfw, addedAt: Date.now() };
      writeManifest([...readManifest().filter((m) => m.id !== id), entry]);
      send({ phase: 'done' });
    } catch (e) {
      send({ phase: controller.signal.aborted ? 'cancelled' : 'error', error: e.message });
    } finally {
      jobs.delete(id);
    }
  })();
  return id;
}

function remove(id) {
  const list = readManifest();
  const m = list.find((x) => x.id === id);
  if (!m) return;
  fs.rmSync(m.path, { force: true });
  fs.rmSync(m.path + '.part', { force: true });
  writeManifest(list.filter((x) => x.id !== id));
  // Shared files stay: other models of the same family use them.
}

// ---- generating -----------------------------------------------------------------------------------

let current = null; // the running engine process

async function generate(sender, { id, prompt, width, height, steps, seed, folder }) {
  if (current) throw new Error('An image is already being generated');
  const m = readManifest().find((x) => x.id === id);
  if (!m || !fs.existsSync(m.path)) throw new Error('That image model isn’t installed');
  const fam = FAMILIES[m.family];
  const engine = installedEngine();
  if (!engine) throw new Error('The image engine isn’t installed. Download a model again to get it.');
  const shared = Object.fromEntries(Object.entries(fam.shared).map(([k, s]) => [k, sharedPath(s)]));
  const missing = Object.values(shared).filter((p) => !fs.existsSync(p));
  if (missing.length) throw new Error(`Missing ${missing.map((p) => path.basename(p)).join(', ')}. Download the model again to get them.`);
  const clamp = (v, lo, hi, d) => Math.min(hi, Math.max(lo, Math.round(Number(v) || d)));
  const W = clamp(width, 256, 1536, 1024) & ~15;
  const H = clamp(height, 256, 1536, 1024) & ~15;
  const S = clamp(steps, 1, 60, fam.steps(m));
  const seedNum = Number.isInteger(seed) && seed >= 0 ? seed : Math.floor(Math.random() * 2 ** 31);
  // A chat's folder (checked like the file tools' folder), else the chosen or default save folder.
  const pdir = dirFor(sender);
  const dir = folder ? checkRoot(folder) : saveDir(pdir);
  fs.mkdirSync(dir, { recursive: true });
  const out = imageName(dir, prompt);
  const args = ['--diffusion-model', m.path, ...fam.args(shared), '-p', String(prompt).slice(0, 4000), '-W', String(W), '-H', String(H), '--steps', String(S), '-s', String(seedNum), '-o', out];
  const send = (p) => !sender.isDestroyed() && sender.send('images:gen', p);
  send({ phase: 'loading', step: 0, steps: S });
  return new Promise((resolve, reject) => {
    // No shell: the prompt is passed as one argument, never interpreted.
    const child = spawn(engine.exe, args, { cwd: path.dirname(engine.exe), windowsHide: true });
    current = child;
    let tail = '';
    let sampling = false;
    let stepsDone = false;
    const onData = (d) => {
      const text = d.toString();
      tail = (tail + text).slice(-4000);
      if (/sampling|denois/i.test(text)) sampling = true;
      // "decoder" also shows up while loading; only count decoding after the steps.
      if (sampling && /decod/i.test(text)) send({ phase: 'decoding', step: S, steps: S });
      // The same progress bar shows loading the model and the image steps; a bar with exactly our step
      // count is the image, any other is loading.
      const m2 = [...text.matchAll(/\|\s*(\d+)\/(\d+)\s*-/g)].pop();
      if (m2) {
        const [step, total] = [Number(m2[1]), Number(m2[2])];
        if (total === S && sampling) {
          send({ phase: 'sampling', step, steps: S });
          if (step === S) stepsDone = true;
        } else if (stepsDone) send({ phase: 'decoding', step: S, steps: S }); // turning the result into an image
        else if (total !== S) send({ phase: 'loading', step, steps: total });
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    const timer = setTimeout(() => child.kill(), 20 * 60 * 1000);
    child.on('error', (e) => {
      clearTimeout(timer);
      current = null;
      reject(new Error(`Couldn't start the image engine: ${e.message}`));
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      current = null;
      if (signal) return reject(new Error('Stopped'));
      if (code !== 0 || !fs.existsSync(out)) {
        const why = tail.split('\n').map((l) => l.trim()).filter((l) => /error|fail|out of memory|not support/i.test(l)).pop();
        return reject(new Error(why ? `The image engine stopped: ${why.slice(0, 300)}` : `The image engine stopped (code ${code})`));
      }
      // The settings are also inside the PNG (stable-diffusion.cpp writes them); the list is for the gallery.
      const meta = { prompt: String(prompt).slice(0, 4000), model: m.id, width: W, height: H, steps: S, seed: seedNum, at: Date.now() };
      writeHistory(pdir, [{ file: out, ...meta }, ...readHistory(pdir).filter((h) => h.file !== out)]);
      resolve({ image: `data:image/png;base64,${fs.readFileSync(out).toString('base64')}`, file: out, ...meta });
    });
  });
}

/** The newest generated images that still exist, with their settings. */
function gallery(dir, limit = 12) {
  return readHistory(dir)
    .filter((h) => fs.existsSync(h.file))
    .slice(0, Math.min(48, limit))
    .map((h) => ({ ...h, image: `data:image/png;base64,${fs.readFileSync(h.file).toString('base64')}` }));
}

function registerImages() {
  serveImages();
  const handle = (channel, fn) =>
    ipcMain.handle(channel, (e, ...args) => {
      if (e.senderFrame !== e.sender.mainFrame) throw new Error('Not allowed');
      return fn(e, ...args);
    });
  handle('images:status', () => status());
  handle('images:inspect', (_e, repo, file) => inspect(repo, file));
  handle('images:download', (e, req) => download(e.sender, req ?? {}));
  handle('images:cancel', (_e, id) => jobs.get(String(id))?.controller.abort());
  handle('images:delete', (_e, id) => remove(String(id)));
  handle('images:generate', (e, req) => generate(e.sender, req ?? {}));
  handle('images:stop', () => current?.kill());
  handle('images:gallery', (e, limit) => gallery(dirFor(e.sender), Number(limit) || 12));
  // Generated images may be in the user's own folders: deleting moves them to the Trash.
  handle('images:deleteOutput', async (e, file) => {
    const d = dirFor(e.sender);
    const p = madeByUs(d, file);
    if (!p) throw new Error('Not an image Penumbra made');
    await shell.trashItem(p);
    writeHistory(d, readHistory(d).filter((h) => h.file !== p));
  });
  handle('images:reveal', (e, file) => {
    const d = dirFor(e.sender);
    const p = file ? madeByUs(d, file) : null;
    if (p) shell.showItemInFolder(p);
    else {
      fs.mkdirSync(saveDir(d), { recursive: true });
      shell.openPath(saveDir(d));
    }
  });
  handle('images:openModels', () => shell.openPath(fs.existsSync(base()) ? base() : app.getPath('userData')));
  handle('images:saveDir', (e) => {
    const d = dirFor(e.sender);
    return { dir: saveDir(d), isDefault: saveDir(d) === defaultSaveDir() };
  });
  handle('images:chooseSaveDir', async (e) => {
    const { canceled, filePaths } = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender), {
      title: 'Save generated images in',
      buttonLabel: 'Use folder',
      defaultPath: saveDir(dirFor(e.sender)),
      properties: ['openDirectory', 'createDirectory'],
    });
    const d = dirFor(e.sender);
    if (!canceled && filePaths[0]) setSaveDir(d, checkRoot(filePaths[0]));
    return { dir: saveDir(d), isDefault: saveDir(d) === defaultSaveDir() };
  });
  handle('images:resetSaveDir', (e) => {
    const d = dirFor(e.sender);
    setSaveDir(d, undefined);
    return { dir: saveDir(d), isDefault: true };
  });
}

module.exports = { registerImages, setImagesFolder, serveImages };
