// Skills live on disk as folders, the same layout Claude uses: <userData>/skills/<id>/SKILL.md plus
// optional reference files. SKILL.md starts with YAML frontmatter that has `name` and `description`.
const { app, dialog, ipcMain, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { AsyncLocalStorage } = require('async_hooks');

const MAX_FILE = 1024 * 1024; // reference files the model may read
const MAX_IMPORT = 20 * 1024 * 1024;

// The demo window has its own skills folder, so the tour never touches yours (see demo.cjs).
const rootFor = new Map(); // webContents id → skills folder
const request = new AsyncLocalStorage();
/** Gives a window its own skills folder instead of <userData>/skills. */
function setSkillsFolder(webContents, dir) {
  rootFor.set(webContents.id, dir);
  webContents.once('destroyed', () => rootFor.delete(webContents.id));
}

const root = () => {
  const dir = request.getStore() ?? path.join(app.getPath('userData'), 'skills');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
};

/** Minimal frontmatter reader: `key: value` lines between --- fences (quotes optional). */
function frontmatter(text) {
  const m = /^﻿?---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  const meta = {};
  if (!m) return { meta, body: text };
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z_-]+):\s*(.*)$/.exec(line);
    if (kv) meta[kv[1].toLowerCase()] = kv[2].trim().replace(/^(['"])(.*)\1$/, '$2');
  }
  return { meta, body: text.slice(m[0].length) };
}

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64) || 'skill';

/** Resolves `rel` inside `dir`, refusing anything that escapes it. */
function inside(dir, rel) {
  const p = path.resolve(dir, rel);
  if (p !== dir && !p.startsWith(dir + path.sep)) throw new Error('Path is outside the skill folder');
  return p;
}

function listFiles(dir, base = dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) listFiles(p, base, out);
    else out.push(path.relative(base, p).split(path.sep).join('/'));
  }
  return out;
}

function skillInfo(id) {
  const dir = inside(root(), id);
  const file = path.join(dir, 'SKILL.md');
  if (!fs.existsSync(file)) return null;
  const { meta } = frontmatter(fs.readFileSync(file, 'utf8'));
  return {
    id,
    name: meta.name || id,
    description: meta.description || '',
    files: listFiles(dir).filter((f) => f !== 'SKILL.md').slice(0, 200),
  };
}

function list() {
  return fs
    .readdirSync(root(), { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
    .map((e) => skillInfo(e.name))
    .filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name));
}

function uniqueId(name) {
  let id = slug(name);
  for (let n = 2; fs.existsSync(path.join(root(), id)); n++) id = `${slug(name)}-${n}`;
  return id;
}

function save(id, content) {
  if (typeof content !== 'string' || content.length > MAX_FILE) throw new Error('Invalid skill');
  const { meta } = frontmatter(content);
  if (!meta.name) throw new Error('SKILL.md needs a "name:" line in its frontmatter');
  if (!id) id = uniqueId(meta.name);
  const dir = inside(root(), id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'SKILL.md'), content);
  return id;
}

// ---- import --------------------------------------------------------------------------------------

/** Reads a .zip into { 'path/in/zip': Buffer }. Handles stored and deflated entries (no ZIP64). */
function readZip(file) {
  const buf = fs.readFileSync(file);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Not a zip file');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = {};
  let total = 0;
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('Corrupt zip');
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith('/') || name.startsWith('__MACOSX/') || /(^|\/)\./.test(name)) continue;
    if ((total += size) > MAX_IMPORT) throw new Error('Zip is too large (over 20 MB)');
    const dataStart = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = buf.subarray(dataStart, dataStart + compSize);
    if (method === 0) out[name] = Buffer.from(data);
    else if (method === 8) out[name] = zlib.inflateRawSync(data);
    else throw new Error(`Unsupported compression in ${name}`);
  }
  return out;
}

function readFolder(dir) {
  const out = {};
  let total = 0;
  for (const rel of listFiles(dir)) {
    const p = path.join(dir, rel);
    if ((total += fs.statSync(p).size) > MAX_IMPORT) throw new Error('Folder is too large (over 20 MB)');
    out[rel] = fs.readFileSync(p);
  }
  return out;
}

/** Each folder (at any depth) that holds a SKILL.md becomes one skill. */
function installFrom(files) {
  const roots = Object.keys(files)
    .filter((f) => f === 'SKILL.md' || f.endsWith('/SKILL.md'))
    .map((f) => f.slice(0, -'SKILL.md'.length));
  if (!roots.length) throw new Error('No SKILL.md found');
  const installed = [];
  for (const prefix of roots) {
    const { meta } = frontmatter(files[prefix + 'SKILL.md'].toString('utf8'));
    const id = uniqueId(meta.name || path.basename(prefix.replace(/\/$/, '')) || 'skill');
    const dir = inside(root(), id);
    for (const [name, data] of Object.entries(files)) {
      if (!name.startsWith(prefix)) continue;
      const rel = name.slice(prefix.length);
      // Nested skills are installed separately.
      if (roots.some((r) => r !== prefix && r.startsWith(prefix) && name.startsWith(r))) continue;
      const target = inside(dir, rel);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, data);
    }
    installed.push(id);
  }
  return installed;
}

async function importSkills(win) {
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: 'Import skills',
    buttonLabel: 'Import',
    message: 'Choose a skill folder (with a SKILL.md) or a .zip',
    properties: ['openFile', 'openDirectory', 'multiSelections'],
    filters: [{ name: 'Skill', extensions: ['zip', 'skill', 'md'] }],
  });
  if (canceled) return [];
  const ids = [];
  for (const p of filePaths) {
    const stat = fs.statSync(p);
    if (stat.isDirectory()) ids.push(...installFrom(readFolder(p)));
    else if (path.basename(p) === 'SKILL.md') ids.push(...installFrom(readFolder(path.dirname(p))));
    else ids.push(...installFrom(readZip(p)));
  }
  return ids;
}

// ---- IPC ----------------------------------------------------------------------------------------

/** Only the app's own page may use these. */
function handle(channel, fn) {
  ipcMain.handle(channel, (e, ...args) => {
    if (e.senderFrame !== e.sender.mainFrame) throw new Error('Not allowed');
    return request.run(rootFor.get(e.sender.id), () => fn(e, ...args));
  });
}

function registerSkills() {
  handle('skills:list', () => list());
  handle('skills:read', (_e, id) => fs.readFileSync(path.join(inside(root(), String(id)), 'SKILL.md'), 'utf8'));
  handle('skills:readFile', (_e, id, rel) => {
    const p = inside(inside(root(), String(id)), String(rel));
    if (fs.statSync(p).size > MAX_FILE) throw new Error('File is too large to read (over 1 MB)');
    return fs.readFileSync(p, 'utf8');
  });
  handle('skills:save', (_e, id, content) => save(id ? String(id) : null, content));
  handle('skills:delete', async (_e, id) => shell.trashItem(inside(root(), String(id))));
  handle('skills:import', (e) => importSkills(require('electron').BrowserWindow.fromWebContents(e.sender)));
  handle('skills:reveal', (_e, id) => shell.openPath(id ? inside(root(), String(id)) : root()));
}

module.exports = { setSkillsFolder, registerSkills, frontmatter, readZip };
