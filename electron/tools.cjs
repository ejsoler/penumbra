// Agent tools that need the operating system: a chat's folder (list, read, write), terminal commands,
// and the web. The app asks the user before anything risky (see src/agents/builtins.ts); these
// handlers enforce the limits that must hold no matter what the model asks for.
const { BrowserWindow, dialog, ipcMain, shell } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { isLocalName, resolvesToPrivate } = require('./netsafe.cjs');

const MAX_READ = 200 * 1024;
const MAX_WRITE = 2 * 1024 * 1024;
const MAX_OUTPUT = 100 * 1024;
const MAX_PAGE = 3 * 1024 * 1024;
const SKIP_DIRS = new Set(['node_modules', '.git', '.venv', 'venv', '__pycache__', 'dist', 'build', '.next', '.cache']);
const USER_AGENT = 'Mozilla/5.0 (compatible; Penumbra/0.2; +https://github.com/ejsoler/penumbra)';

/** A chat folder must be a real, absolute directory, and not the whole disk or home folder. */
function checkRoot(root) {
  if (typeof root !== 'string' || !path.isAbsolute(root)) throw new Error('No folder chosen for this chat');
  const r = fs.realpathSync(root);
  if (r === path.parse(r).root || r === fs.realpathSync(os.homedir())) throw new Error('Choose a project folder, not the whole disk or home folder');
  if (!fs.statSync(r).isDirectory()) throw new Error('The chat folder is not a directory');
  return r;
}

/** Resolves a model-supplied path inside the chat folder, following symlinks, and refuses escapes. */
function inside(root, rel) {
  const r = checkRoot(root);
  const p = path.resolve(r, String(rel ?? '.').replace(/^[/\\]+/, ''));
  // Resolve symlinks for the part that exists, so a link can't point outside the folder.
  let real = p;
  let probe = p;
  while (!fs.existsSync(probe)) probe = path.dirname(probe);
  real = path.join(fs.realpathSync(probe), path.relative(probe, p));
  if (real !== r && !real.startsWith(r + path.sep)) throw new Error('That path is outside the chat folder');
  return real;
}

const relTo = (root, p) => path.relative(checkRoot(root), p).split(path.sep).join('/') || '.';

function listFiles(root, rel, depth = 2) {
  const base = inside(root, rel);
  const out = [];
  const walk = (dir, d) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (out.length >= 500) return;
      if (e.name.startsWith('.') && e.name !== '.env.example') continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        out.push(relTo(root, p) + '/');
        if (d > 1 && !SKIP_DIRS.has(e.name)) walk(p, d - 1);
      } else {
        out.push(`${relTo(root, p)}  (${fs.statSync(p).size} bytes)`);
      }
    }
  };
  walk(base, Math.max(1, Math.min(5, depth)));
  return out.length ? out.join('\n') + (out.length >= 500 ? '\n… (list cut at 500 entries)' : '') : '(empty folder)';
}

function readFile(root, rel, offset = 0) {
  const p = inside(root, rel);
  const stat = fs.statSync(p);
  if (stat.isDirectory()) return listFiles(root, rel, 1);
  const fd = fs.openSync(p, 'r');
  try {
    const start = Math.max(0, Number(offset) || 0);
    const buf = Buffer.alloc(Math.min(MAX_READ, Math.max(0, stat.size - start)));
    fs.readSync(fd, buf, 0, buf.length, start);
    if (buf.subarray(0, 8000).includes(0)) return `(${rel} looks like a binary file, ${stat.size} bytes; it can't be shown as text)`;
    const more = start + buf.length < stat.size ? `\n\n[…file continues: ${stat.size - start - buf.length} more bytes. Read again with offset ${start + buf.length}]` : '';
    return buf.toString('utf8') + more;
  } finally {
    fs.closeSync(fd);
  }
}

/** Writes a file; an existing file is moved to the Trash first, so nothing is lost. */
async function writeFile(root, rel, content) {
  if (typeof content !== 'string') throw new Error('content must be text');
  if (Buffer.byteLength(content) > MAX_WRITE) throw new Error('File is too large (over 2 MB)');
  const p = inside(root, rel);
  const existed = fs.existsSync(p);
  if (existed && fs.statSync(p).isDirectory()) throw new Error('That path is a folder');
  if (existed) await shell.trashItem(p);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
  return { path: relTo(root, p), replaced: existed, bytes: Buffer.byteLength(content) };
}

// ---- terminal -------------------------------------------------------------------------------------

const running = new Map();

function runCommand(root, command, id, timeoutSec = 120) {
  const cwd = checkRoot(root);
  return new Promise((resolve) => {
    const isWin = process.platform === 'win32';
    const child = spawn(isWin ? 'cmd.exe' : process.env.SHELL || '/bin/sh', isWin ? ['/d', '/s', '/c', command] : ['-lc', command], {
      cwd,
      env: { ...process.env, PENUMBRA_AGENT: '1' },
      detached: !isWin,
    });
    let out = '';
    let cut = false;
    const add = (d) => {
      if (out.length < MAX_OUTPUT) out += d.toString();
      else cut = true;
    };
    child.stdout.on('data', add);
    child.stderr.on('data', add);
    const kill = () => {
      try {
        if (isWin) spawn('taskkill', ['/pid', String(child.pid), '/t', '/f']);
        else process.kill(-child.pid, 'SIGTERM');
      } catch {
        /* already gone */
      }
    };
    running.set(id, { kill });
    const timer = setTimeout(() => {
      out += `\n[stopped: took longer than ${timeoutSec} s]`;
      kill();
    }, Math.min(600, Math.max(5, timeoutSec)) * 1000);
    child.on('error', (e) => add(`\n${e.message}`));
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      running.delete(id);
      resolve({ code, signal, output: out.slice(0, MAX_OUTPUT) + (cut ? '\n[…output cut at 100 KB]' : '') });
    });
  });
}

// ---- web --------------------------------------------------------------------------------------------

async function checkUrl(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('Invalid address');
  }
  if (!['https:', 'http:'].includes(url.protocol)) throw new Error('Only http and https addresses are allowed');
  if (url.username || url.password) throw new Error('Addresses with passwords are not allowed');
  const host = url.hostname.toLowerCase();
  if (host.startsWith('[') || net.isIP(host)) throw new Error('IP addresses are blocked');
  if (isLocalName(host) || (await resolvesToPrivate(host))) throw new Error('This computer and the local network are blocked');
  return url;
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const decode = (s) => s.replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e) => {
  if (e[0] === '#') return String.fromCodePoint(parseInt(e.slice(1).replace(/^x/i, ''), /^#x/i.test(e) ? 16 : 10) || 32);
  return ENTITIES[e.toLowerCase()] ?? m;
});

/** Readable text from HTML: drops scripts, styles, and markup; keeps links as "text (url)". */
function htmlToText(html, base) {
  const title = decode((/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? '').trim());
  let body = /<body[\s\S]*<\/body>/i.exec(html)?.[0] ?? html;
  body = body
    .replace(/<(script|style|noscript|svg|template|iframe)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<a\s[^>]*href="([^"#][^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_m, href, text) => {
      let abs = href;
      try { abs = new URL(decode(href), base).href; } catch { /* keep as is */ }
      const t = text.replace(/<[^>]+>/g, '').trim();
      return t ? `${t} (${abs})` : '';
    })
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/section|\/article)[^>]*>/gi, '\n')
    .replace(/<li[^>]*>/gi, '\n- ')
    .replace(/<[^>]+>/g, ' ');
  const text = decode(body).replace(/[ \t\f\r]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  return { title, text };
}

async function fetchUrl(raw) {
  let url = await checkUrl(raw);
  // Follow redirects by hand so every hop gets the same checks.
  for (let hop = 0; hop < 5; hop++) {
    const res = await fetch(url, { redirect: 'manual', headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,text/plain,application/json;q=0.9,*/*;q=0.5' }, signal: AbortSignal.timeout(20000) });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      url = await checkUrl(new URL(res.headers.get('location'), url).href);
      continue;
    }
    const type = res.headers.get('content-type') || '';
    const buf = Buffer.from(await res.arrayBuffer()).subarray(0, MAX_PAGE);
    if (!/text|json|xml|javascript|csv/.test(type)) return { url: url.href, status: res.status, type, text: `(This is a ${type || 'binary'} file, ${buf.length} bytes; it can't be read as text.)` };
    const raw = buf.toString('utf8');
    if (/html/.test(type)) {
      const { title, text } = htmlToText(raw, url);
      return { url: url.href, status: res.status, type, title, text };
    }
    return { url: url.href, status: res.status, type, text: raw };
  }
  throw new Error('Too many redirects');
}

/** Keyless web search through DuckDuckGo's HTML results page. */
async function search(query) {
  const res = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(String(query).slice(0, 300))}`, {
    headers: { 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(20000),
  });
  const html = await res.text();
  const results = [];
  const re = /class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:class="result__snippet"[^>]*>([\s\S]*?)<\/a>)?/g;
  for (const m of html.matchAll(re)) {
    let link = decode(m[1]);
    const uddg = /[?&]uddg=([^&]+)/.exec(link)?.[1];
    if (uddg) link = decodeURIComponent(uddg);
    if (link.startsWith('//')) link = 'https:' + link;
    if (/duckduckgo\.com\/y\.js/.test(link)) continue; // ads
    const strip = (s) => decode((s || '').replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
    results.push({ title: strip(m[2]), url: link, snippet: strip(m[3]) });
    if (results.length >= 8) break;
  }
  if (!results.length && /anomaly|captcha/i.test(html)) throw new Error('The search engine asked for a captcha; try again later');
  return results;
}

// ---- IPC ----------------------------------------------------------------------------------------

function handle(channel, fn) {
  ipcMain.handle(channel, (e, ...args) => {
    if (e.senderFrame !== e.sender.mainFrame) throw new Error('Not allowed');
    return fn(e, ...args);
  });
}

function registerTools() {
  handle('tools:pickFolder', async (e) => {
    const { canceled, filePaths } = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender), {
      title: 'Choose a folder for this chat',
      buttonLabel: 'Use folder',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (canceled || !filePaths[0]) return null;
    return checkRoot(filePaths[0]);
  });
  handle('tools:list', (_e, root, rel, depth) => listFiles(root, rel, depth));
  handle('tools:read', (_e, root, rel, offset) => readFile(root, rel, offset));
  handle('tools:write', (_e, root, rel, content) => writeFile(root, rel, content));
  handle('tools:run', (_e, root, command, id, timeout) => runCommand(root, String(command), String(id), Number(timeout) || 120));
  handle('tools:kill', (_e, id) => running.get(String(id))?.kill());
  handle('tools:fetch', (_e, url) => fetchUrl(String(url)));
  handle('tools:search', (_e, query) => search(query));
  handle('tools:reveal', (_e, root) => shell.openPath(checkRoot(root)));
}

module.exports = { registerTools, htmlToText };
