// Profiles: separate chats, agents, skills, settings, scheduled tasks, and image history, each optionally
// behind a password. Every profile has its own browser storage (an Electron session partition); the
// default profile keeps the original storage, so existing data stays where it was. Downloaded image models
// and Ollama models are shared.
//
// A password is an app lock: Penumbra won't show a profile until it's entered. It is stored only as a
// salted scrypt hash. It doesn't encrypt the files on disk (FileVault or BitLocker does that).
const { app, BrowserWindow, ipcMain, session } = require('electron');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { setSkillsFolder } = require('./skills.cjs');
const { setImagesFolder, serveImages } = require('./images.cjs');

const DEFAULT_ID = 'default';
const file = () => path.join(app.getPath('userData'), 'profiles.json');
const read = () => {
  try {
    const d = JSON.parse(fs.readFileSync(file(), 'utf8'));
    if (Array.isArray(d.profiles) && d.profiles.length) return d;
  } catch {
    /* first run */
  }
  return { active: DEFAULT_ID, profiles: [{ id: DEFAULT_ID, name: '', createdAt: Date.now() }] };
};
const write = (d) => fs.writeFileSync(file(), JSON.stringify(d, null, 1));

const partitionOf = (id) => (id === DEFAULT_ID ? undefined : `persist:profile-${id}`);
const sessionOf = (id) => (id === DEFAULT_ID ? session.defaultSession : session.fromPartition(partitionOf(id)));
/** Where a profile keeps its own files (skills, image list). The default profile uses the old places. */
const dataDir = (id) => (id === DEFAULT_ID ? app.getPath('userData') : path.join(app.getPath('userData'), 'profiles', id));
const skillsDir = (id) => path.join(dataDir(id), 'skills');
const imagesDir = (id) => path.join(dataDir(id), 'images');

// ---- passwords --------------------------------------------------------------------------------------

const SCRYPT = { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const hashPassword = (password, salt = crypto.randomBytes(16)) => ({
  salt: salt.toString('base64'),
  hash: crypto.scryptSync(String(password), salt, 32, SCRYPT).toString('base64'),
});
const checkPassword = (p, password) => {
  if (!p.hash) return true;
  const want = Buffer.from(p.hash, 'base64');
  const got = crypto.scryptSync(String(password ?? ''), Buffer.from(p.salt, 'base64'), 32, SCRYPT);
  return want.length === got.length && crypto.timingSafeEqual(want, got);
};
// Wrong guesses slow down: after 5 in a row, each try waits a little longer (up to 30 s).
const failures = new Map(); // profile id → { count, until }
function guard(id) {
  const f = failures.get(id);
  if (f && f.until > Date.now()) throw new Error(`Too many wrong passwords. Try again in ${Math.ceil((f.until - Date.now()) / 1000)} s.`);
}
function failed(id) {
  const f = failures.get(id) ?? { count: 0, until: 0 };
  f.count++;
  if (f.count >= 5) f.until = Date.now() + Math.min(30, 2 ** (f.count - 4)) * 1000;
  failures.set(id, f);
}

// ---- windows ---------------------------------------------------------------------------------------

const windowProfile = new Map(); // webContents id → profile id
const unlocked = new Set(); // webContents ids whose profile was unlocked in that window
const prepared = new Set(); // sessions already given Penumbra's rules
let deps = null; // { createWindow, protectSession }

/** Opens the main window on a profile (locked if it has a password). */
function openProfile(id) {
  const d = read();
  const p = d.profiles.find((x) => x.id === id) ?? d.profiles[0];
  if (d.active !== p.id) write({ ...d, active: p.id });
  const ses = sessionOf(p.id);
  if (!prepared.has(p.id) && p.id !== DEFAULT_ID) {
    deps.protectSession(ses);
    serveImages(ses, imagesDir(p.id));
    prepared.add(p.id);
  }
  const win = deps.createWindow({ partition: partitionOf(p.id), primary: true });
  const wc = win.webContents;
  windowProfile.set(wc.id, p.id);
  wc.once('destroyed', () => {
    windowProfile.delete(wc.id);
    unlocked.delete(wc.id);
  });
  if (p.id !== DEFAULT_ID) {
    fs.mkdirSync(skillsDir(p.id), { recursive: true });
    setSkillsFolder(wc, skillsDir(p.id));
    setImagesFolder(wc, imagesDir(p.id));
  }
  if (!p.hash) unlocked.add(wc.id);
  return win;
}

/** The profile Penumbra opens at startup. */
const startupId = (d = read()) => (d.profiles.some((p) => p.id === d.startup) ? d.startup : DEFAULT_ID);

const publicInfo = (p, currentId, d = read()) => ({
  id: p.id,
  name: p.name || (p.id === DEFAULT_ID ? 'Default' : 'Profile'),
  avatar: p.avatar,
  hasPassword: !!p.hash,
  current: p.id === currentId,
  /** Opens at startup. */
  isDefault: p.id === startupId(d),
});

/**
 * Adds a chat (and agents it uses that the profile lacks) to another profile's storage. That storage is
 * only reachable from a page in its session, so a hidden window opens an empty page on the app's own
 * address there and writes it.
 */
async function writeToProfile(targetId, appUrl, conversation, agents) {
  const ses = sessionOf(targetId);
  const win = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, ...(partitionOf(targetId) ? { partition: partitionOf(targetId) } : {}) } });
  try {
    await win.loadURL(new URL('transfer.html', appUrl).toString());
    const id = await win.webContents.executeJavaScript(`(() => {
      const read = (k) => { try { return JSON.parse(localStorage.getItem(k) || '[]'); } catch { return []; } };
      const convs = read('ollama-gui.conversations');
      const conv = ${JSON.stringify(conversation)};
      if (convs.some((c) => c.id === conv.id)) conv.id = conv.id + '-' + Date.now().toString(36);
      conv.updatedAt = Date.now();
      localStorage.setItem('ollama-gui.conversations', JSON.stringify([conv, ...convs]));
      const agents = read('ollama-gui.agents');
      const add = ${JSON.stringify(agents)}.filter((a) => !agents.some((x) => x.id === a.id));
      if (add.length) localStorage.setItem('ollama-gui.agents', JSON.stringify([...agents, ...add]));
      return conv.id;
    })()`);
    await ses.flushStorageData?.();
    return id;
  } finally {
    win.destroy();
  }
}

/** Lets the target profile show the moved chat's generated images: they join its image list. */
function shareImages(fromId, toId, conversation) {
  const refs = (conversation.messages ?? []).flatMap((m) => m.generated ?? []);
  if (!refs.length) return;
  const histPath = (id) => path.join(imagesDir(id), 'history.json');
  const readH = (id) => {
    try {
      return JSON.parse(fs.readFileSync(histPath(id), 'utf8'));
    } catch {
      return [];
    }
  };
  const from = readH(fromId);
  const to = readH(toId);
  const add = refs.map((r) => from.find((h) => h.file === r.file) ?? { file: r.file, prompt: r.prompt, width: r.width, height: r.height, seed: r.seed, model: r.model, at: Date.now() }).filter((h) => !to.some((x) => x.file === h.file));
  if (!add.length) return;
  fs.mkdirSync(path.dirname(histPath(toId)), { recursive: true });
  fs.writeFileSync(histPath(toId), JSON.stringify([...add, ...to]));
}

function registerProfiles(d) {
  deps = d;
  // Each handler acts for the profile of the window that asks.
  const handle = (channel, fn) =>
    ipcMain.handle(channel, (e, ...args) => {
      if (e.senderFrame !== e.sender.mainFrame || !windowProfile.has(e.sender.id)) throw new Error('Not allowed');
      return fn({ e, id: windowProfile.get(e.sender.id) }, ...args);
    });
  const find = (id) => read().profiles.find((p) => p.id === id);
  const update = (id, patch) => {
    const data = read();
    write({ ...data, profiles: data.profiles.map((p) => (p.id === id ? { ...p, ...patch } : p)) });
  };
  /** Switching or locking replaces the window: the next one opens on the chosen profile. */
  const replaceWindow = (e, id) => {
    const old = require('electron').BrowserWindow.fromWebContents(e.sender);
    openProfile(id);
    old?.destroy(); // destroy, not close: closing may only hide it (menu bar mode)
  };

  handle('profiles:current', ({ e, id }) => ({ ...publicInfo(find(id), id), locked: !unlocked.has(e.sender.id) }));
  handle('profiles:list', ({ id }) => {
    const d = read();
    return d.profiles.map((p) => publicInfo(p, id, d));
  });
  handle('profiles:setDefault', ({ e }, target) => {
    if (!unlocked.has(e.sender.id)) throw new Error('Unlock the profile first');
    if (!find(String(target))) throw new Error('No such profile');
    write({ ...read(), startup: String(target) });
  });
  handle('profiles:moveChat', async ({ e, id }, req) => {
    if (!unlocked.has(e.sender.id)) throw new Error('Unlock the profile first');
    const target = find(String(req?.target));
    if (!target || target.id === id) throw new Error('Pick another profile');
    if (target.hash) {
      guard(target.id);
      if (!checkPassword(target, req?.password)) {
        failed(target.id);
        throw new Error(`Wrong password for ${target.name}`);
      }
      failures.delete(target.id);
    }
    const conv = req?.conversation;
    if (!conv || typeof conv !== 'object' || !Array.isArray(conv.messages) || JSON.stringify(conv).length > 50 * 1024 * 1024) throw new Error('Not a chat');
    const agents = Array.isArray(req?.agents) ? req.agents.filter((a) => a && typeof a.id === 'string') : [];
    const newId = await writeToProfile(target.id, e.sender.getURL(), conv, agents);
    shareImages(id, target.id, conv);
    return newId;
  });
  handle('profiles:unlock', ({ e, id }, password) => {
    guard(id);
    if (!checkPassword(find(id), password)) {
      failed(id);
      return false;
    }
    failures.delete(id);
    unlocked.add(e.sender.id);
    return true;
  });
  handle('profiles:update', ({ e, id }, patch) => {
    if (!unlocked.has(e.sender.id)) throw new Error('Unlock the profile first');
    const name = typeof patch?.name === 'string' ? patch.name.trim().slice(0, 40) : undefined;
    const avatar = typeof patch?.avatar === 'string' && patch.avatar.length < 200000 ? patch.avatar : patch?.avatar === null ? undefined : find(id).avatar;
    // A named profile keeps its name if the field is cleared; only the default profile can go nameless.
    update(id, { ...(name !== undefined && (name || id === DEFAULT_ID) ? { name } : {}), avatar });
  });
  handle('profiles:create', ({ e }, req) => {
    if (!unlocked.has(e.sender.id)) throw new Error('Unlock the profile first');
    const name = String(req?.name ?? '').trim().slice(0, 40);
    if (!name) throw new Error('Give the profile a name');
    const data = read();
    if (data.profiles.some((p) => (p.name || 'Default').toLowerCase() === name.toLowerCase())) throw new Error('A profile with that name already exists');
    const p = { id: crypto.randomBytes(6).toString('hex'), name, createdAt: Date.now(), ...(req?.password ? hashPassword(req.password) : {}) };
    write({ ...data, profiles: [...data.profiles, p] });
    return p.id;
  });
  handle('profiles:switch', ({ e }, target) => {
    if (!find(String(target))) throw new Error('No such profile');
    replaceWindow(e, String(target));
  });
  handle('profiles:lock', ({ e, id }) => {
    if (!find(id).hash) throw new Error('This profile has no password');
    replaceWindow(e, id);
  });
  handle('profiles:setPassword', ({ e, id }, req) => {
    if (!unlocked.has(e.sender.id)) throw new Error('Unlock the profile first');
    const p = find(id);
    if (p.hash) {
      guard(id);
      if (!checkPassword(p, req?.current)) {
        failed(id);
        throw new Error('The current password is wrong');
      }
    }
    const next = String(req?.next ?? '');
    if (next && next.length < 4) throw new Error('Use at least 4 characters');
    update(id, next ? hashPassword(next) : { hash: undefined, salt: undefined });
    return { hasPassword: !!next };
  });
  handle('profiles:delete', async ({ e, id }, req) => {
    if (!unlocked.has(e.sender.id)) throw new Error('Unlock the profile first');
    const target = find(String(req?.id));
    if (!target) throw new Error('No such profile');
    if (target.id === DEFAULT_ID) throw new Error("The original profile can't be deleted");
    if (target.id === startupId()) throw new Error('Make another profile the default first');
    if (target.id === id) throw new Error('Switch to another profile before deleting this one');
    if (target.hash) {
      guard(target.id);
      if (!checkPassword(target, req?.password)) {
        failed(target.id);
        throw new Error('Wrong password for that profile');
      }
    }
    // Its storage, skills, and image list go; images saved in folders stay where they are.
    await sessionOf(target.id).clearStorageData();
    fs.rmSync(dataDir(target.id), { recursive: true, force: true });
    fs.rmSync(path.join(app.getPath('userData'), 'Partitions', `profile-${target.id}`), { recursive: true, force: true });
    const data = read();
    write({ ...data, profiles: data.profiles.filter((p) => p.id !== target.id) });
  });
}

/** The profile to open at launch: the default one. */
const activeProfile = () => startupId();

module.exports = { registerProfiles, openProfile, activeProfile };
