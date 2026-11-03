// Backups: one .zip with the chats, agents, scheduled tasks, and settings the app sends (as JSON), plus
// skill folders and image files from this window's profile. Restoring reads a backup, lets the app show
// what's in it, and copies the chosen skills and images back (the app merges the rest into its storage).
const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { readZip, withSkillsOf, skillsRoot, listSkills, listFiles, installFrom } = require('./skills.cjs');
const { imagesStore } = require('./images.cjs');

const FORMAT = 'penumbra-backup';
const MAX_BACKUP = 4 * 1024 * 1024 * 1024 - 1; // zip without ZIP64

// ---- zip writing ----------------------------------------------------------------------------------

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Writes a zip file entry by entry, so large backups don't have to fit in memory at once. */
function zipWriter(file) {
  const fd = fs.openSync(file, 'w');
  const central = [];
  let offset = 0;
  const write = (buf) => {
    fs.writeSync(fd, buf);
    offset += buf.length;
    if (offset > MAX_BACKUP) throw new Error('The backup is too large (over 4 GB). Choose fewer images.');
  };
  const dosTime = (() => {
    const d = new Date();
    return {
      time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
      date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
    };
  })();
  return {
    add(name, data, compress = true) {
      const nameBuf = Buffer.from(name, 'utf8');
      const crc = crc32(data);
      const body = compress ? zlib.deflateRawSync(data) : data;
      const method = compress ? 8 : 0;
      const header = Buffer.alloc(30);
      header.writeUInt32LE(0x04034b50, 0);
      header.writeUInt16LE(20, 4);
      header.writeUInt16LE(0x0800, 6); // UTF-8 names
      header.writeUInt16LE(method, 8);
      header.writeUInt16LE(dosTime.time, 10);
      header.writeUInt16LE(dosTime.date, 12);
      header.writeUInt32LE(crc, 14);
      header.writeUInt32LE(body.length, 18);
      header.writeUInt32LE(data.length, 22);
      header.writeUInt16LE(nameBuf.length, 26);
      central.push({ nameBuf, crc, method, compSize: body.length, size: data.length, offset });
      write(header);
      write(nameBuf);
      write(body);
    },
    finish() {
      const start = offset;
      for (const e of central) {
        const h = Buffer.alloc(46);
        h.writeUInt32LE(0x02014b50, 0);
        h.writeUInt16LE(20, 4);
        h.writeUInt16LE(20, 6);
        h.writeUInt16LE(0x0800, 8);
        h.writeUInt16LE(e.method, 10);
        h.writeUInt16LE(dosTime.time, 12);
        h.writeUInt16LE(dosTime.date, 14);
        h.writeUInt32LE(e.crc, 16);
        h.writeUInt32LE(e.compSize, 20);
        h.writeUInt32LE(e.size, 24);
        h.writeUInt16LE(e.nameBuf.length, 28);
        h.writeUInt32LE(e.offset, 42);
        write(h);
        write(e.nameBuf);
      }
      const end = Buffer.alloc(22);
      end.writeUInt32LE(0x06054b50, 0);
      end.writeUInt16LE(central.length, 8);
      end.writeUInt16LE(central.length, 10);
      end.writeUInt32LE(offset - start, 12);
      end.writeUInt32LE(start, 16);
      write(end);
      fs.closeSync(fd);
    },
    abort() {
      try {
        fs.closeSync(fd);
        fs.rmSync(file, { force: true });
      } catch {
        /* already gone */
      }
    },
  };
}

// ---- helpers --------------------------------------------------------------------------------------

/** This profile's images that still exist. */
const imagesOf = (sender) => imagesStore.readHistory(imagesStore.dirFor(sender)).filter((h) => h.file && fs.existsSync(h.file));

const stamp = () => {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

/** A name that isn't taken in `dir`. */
function freeName(dir, name) {
  const ext = path.extname(name);
  const stem = path.basename(name, ext);
  let out = name;
  for (let i = 2; fs.existsSync(path.join(dir, out)); i++) out = `${stem} ${i}${ext}`;
  return out;
}

// The backup a window opened, kept here until it restores from it or opens another.
const opened = new Map(); // webContents id → { files }

// ---- backing up -----------------------------------------------------------------------------------

/** What this profile has on disk, for the app's backup choices. */
function summary(sender) {
  const skills = withSkillsOf(sender, () => listSkills()).map((s) => ({ id: s.id, name: s.name, description: s.description }));
  const images = imagesOf(sender).map((h) => ({ file: h.file, prompt: h.prompt ?? '', at: h.at ?? 0, width: h.width, height: h.height, size: fs.statSync(h.file).size }));
  return { skills, images };
}

async function save(sender, { data, skills = [], images = [] }) {
  const win = BrowserWindow.fromWebContents(sender);
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: 'Save backup',
    defaultPath: path.join(app.getPath('documents'), `Penumbra backup ${stamp()}.zip`),
    buttonLabel: 'Save backup',
    filters: [{ name: 'Penumbra backup', extensions: ['zip'] }],
  });
  if (canceled || !filePath) return null;

  const zip = zipWriter(filePath);
  try {
    const counts = {};
    for (const [name, value] of Object.entries(data ?? {})) {
      if (!/^[a-z]+$/i.test(name)) continue;
      zip.add(`data/${name}.json`, Buffer.from(JSON.stringify(value)));
      if (Array.isArray(value)) counts[name] = value.length;
    }

    // Skills: each chosen folder, as it is on disk.
    const wanted = new Set(skills.map(String));
    const skillList = withSkillsOf(sender, () => listSkills()).filter((s) => wanted.has(s.id));
    const root = withSkillsOf(sender, () => skillsRoot());
    for (const s of skillList) {
      const dir = path.join(root, s.id);
      for (const rel of listFiles(dir)) zip.add(`skills/${s.id}/${rel}`, fs.readFileSync(path.join(dir, rel)));
    }
    counts.skills = skillList.length;

    // Images: the chosen files Penumbra made, with their prompts and settings.
    const chosen = new Set(images.map(String));
    const imageList = [];
    for (const h of imagesOf(sender).filter((x) => chosen.has(x.file))) {
      const name = `${imageList.length + 1} ${path.basename(h.file)}`;
      zip.add(`images/${name}`, fs.readFileSync(h.file), false);
      imageList.push({ ...h, name });
    }
    zip.add('images.json', Buffer.from(JSON.stringify(imageList)));
    counts.images = imageList.length;

    zip.add('backup.json', Buffer.from(JSON.stringify({ format: FORMAT, version: 1, app: app.getVersion(), createdAt: Date.now(), counts }, null, 2)));
    zip.finish();
  } catch (e) {
    zip.abort();
    throw e;
  }
  return { file: filePath, size: fs.statSync(filePath).size };
}

// ---- restoring ------------------------------------------------------------------------------------

async function open(sender) {
  const win = BrowserWindow.fromWebContents(sender);
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: 'Open a backup',
    buttonLabel: 'Open',
    defaultPath: app.getPath('documents'),
    properties: ['openFile'],
    filters: [{ name: 'Penumbra backup', extensions: ['zip'] }],
  });
  if (canceled || !filePaths[0]) return null;
  const files = readZip(filePaths[0], MAX_BACKUP);
  let manifest;
  try {
    manifest = JSON.parse(files['backup.json'].toString('utf8'));
  } catch {
    manifest = null;
  }
  if (manifest?.format !== FORMAT) throw new Error("This isn't a Penumbra backup");
  opened.set(sender.id, { files });
  sender.once('destroyed', () => opened.delete(sender.id));

  const data = {};
  for (const [name, buf] of Object.entries(files)) {
    const m = /^data\/([a-z]+)\.json$/i.exec(name);
    if (m) data[m[1]] = JSON.parse(buf.toString('utf8'));
  }
  const skills = Object.keys(files)
    .filter((f) => /^skills\/[^/]+\/SKILL\.md$/.test(f))
    .map((f) => {
      const id = f.split('/')[1];
      const text = files[f].toString('utf8');
      const name = /^name:\s*(.+)$/m.exec(text)?.[1]?.trim().replace(/^(['"])(.*)\1$/, '$2') || id;
      const description = /^description:\s*(.+)$/m.exec(text)?.[1]?.trim().replace(/^(['"])(.*)\1$/, '$2') || '';
      return { id, name, description };
    });
  const images = JSON.parse(files['images.json']?.toString('utf8') || '[]')
    .filter((h) => files[`images/${h.name}`])
    .map((h) => ({ ...h, size: files[`images/${h.name}`].length, thumb: undefined }));
  return { file: filePaths[0], createdAt: manifest.createdAt, app: manifest.app, data, skills, images };
}

/**
 * Copies the chosen skills and images from the opened backup. Ones already here (the same SKILL.md, or the
 * same image file) are skipped. Returns old → new skill ids and image paths, and how many were skipped.
 */
function restoreFiles(sender, { skills = [], images = [] }) {
  const backup = opened.get(sender.id);
  if (!backup) throw new Error('Open the backup again');
  const { files } = backup;
  const skillIds = {};
  let skipped = 0;
  withSkillsOf(sender, () => {
    for (const id of skills.map(String)) {
      const here = path.join(skillsRoot(), id, 'SKILL.md');
      if (/^[\w.-]+$/.test(id) && fs.existsSync(here) && files[`skills/${id}/SKILL.md`]?.equals(fs.readFileSync(here))) {
        skipped++;
        continue;
      }
      const prefix = `skills/${id}/`;
      const subset = {};
      for (const [name, buf] of Object.entries(files)) if (name.startsWith(prefix)) subset[`${id}/${name.slice(prefix.length)}`] = buf;
      if (!subset[`${id}/SKILL.md`]) continue;
      const [installed] = installFrom(subset);
      skillIds[id] = installed;
    }
  });

  const imageFiles = {};
  const wanted = new Set(images.map(String));
  const list = JSON.parse(files['images.json']?.toString('utf8') || '[]').filter((h) => wanted.has(h.name) && files[`images/${h.name}`]);
  if (list.length) {
    const d = imagesStore.dirFor(sender);
    const dir = imagesStore.saveDir(d);
    fs.mkdirSync(dir, { recursive: true });
    const history = imagesStore.readHistory(d);
    const added = [];
    for (const h of list) {
      const data = files[`images/${h.name}`];
      if (h.file && history.some((x) => x.file === h.file) && fs.existsSync(h.file) && fs.statSync(h.file).size === data.length) {
        skipped++;
        continue;
      }
      const dest = path.join(dir, freeName(dir, path.basename(h.file || h.name)));
      fs.writeFileSync(dest, data);
      const { name: _n, ...entry } = h;
      added.push({ ...entry, file: dest });
      if (h.file) imageFiles[h.file] = dest;
    }
    if (added.length) imagesStore.writeHistory(d, [...added, ...history].sort((a, b) => (b.at ?? 0) - (a.at ?? 0)));
  }
  return { skills: skillIds, images: imageFiles, skipped };
}

function registerBackup() {
  const handle = (channel, fn) =>
    ipcMain.handle(channel, (e, ...args) => {
      if (e.senderFrame !== e.sender.mainFrame) throw new Error('Not allowed');
      return fn(e, ...args);
    });
  handle('backup:summary', (e) => summary(e.sender));
  handle('backup:save', (e, req) => save(e.sender, req ?? {}));
  handle('backup:open', (e) => open(e.sender));
  handle('backup:restoreFiles', (e, req) => restoreFiles(e.sender, req ?? {}));
  handle('backup:close', (e) => opened.delete(e.sender.id));
  handle('backup:reveal', (_e, file) => {
    if (typeof file === 'string' && file.endsWith('.zip') && fs.existsSync(file)) shell.showItemInFolder(file);
  });
}

module.exports = { registerBackup };
