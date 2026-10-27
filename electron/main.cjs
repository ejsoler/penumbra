const { app, BrowserWindow, Menu, ipcMain, shell, session } = require('electron');
const fs = require('fs');
const net = require('net');
const path = require('path');
const { registerSkills } = require('./skills.cjs');
const { registerTools } = require('./tools.cjs');
const { registerUpdates } = require('./updates.cjs');
const { isLocalName, resolvesToPrivate } = require('./netsafe.cjs');

const ICON = path.join(__dirname, '..', 'build', 'icon.png');
app.setName('Penumbra');

// The app was called "Ollama Studio" before; carry chats and settings over on first launch.
const legacyData = path.join(app.getPath('appData'), 'Ollama Studio');
if (!fs.existsSync(app.getPath('userData')) && fs.existsSync(legacyData)) {
  try {
    fs.cpSync(legacyData, app.getPath('userData'), { recursive: true });
  } catch (e) {
    console.warn('Could not migrate data from Ollama Studio:', e);
  }
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: '#16171a',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 14, y: 14 },
    icon: ICON, // Windows/Linux window icon
    autoHideMenuBar: process.platform !== 'darwin', // Alt shows the menu on Windows/Linux
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, preload: path.join(__dirname, 'preload.cjs') },
  });

  if (process.env.VITE_DEV_SERVER_URL) win.loadURL(process.env.VITE_DEV_SERVER_URL);
  else win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));

  // Native menu for text fields and selected text (the page shows its own menus elsewhere).
  win.webContents.on('context-menu', (_e, params) => {
    const { isEditable, selectionText, editFlags, misspelledWord, dictionarySuggestions, linkURL } = params;
    const items = [];
    if (misspelledWord) {
      for (const word of dictionarySuggestions.slice(0, 5)) {
        items.push({ label: word, click: () => win.webContents.replaceMisspelling(word) });
      }
      if (!dictionarySuggestions.length) items.push({ label: 'No suggestions', enabled: false });
      items.push({ label: 'Add to Dictionary', click: () => win.webContents.session.addWordToSpellCheckerDictionary(misspelledWord) });
      items.push({ type: 'separator' });
    }
    if (linkURL) {
      items.push({ label: 'Open Link in Browser', click: () => shell.openExternal(linkURL) });
      items.push({ type: 'separator' });
    }
    if (isEditable) {
      items.push(
        { role: 'undo', enabled: editFlags.canUndo },
        { role: 'redo', enabled: editFlags.canRedo },
        { type: 'separator' },
        { role: 'cut', enabled: editFlags.canCut },
        { role: 'copy', enabled: editFlags.canCopy },
        { role: 'paste', enabled: editFlags.canPaste },
        { type: 'separator' },
        { role: 'selectAll' },
      );
    } else if (selectionText.trim()) {
      items.push({ role: 'copy' });
    }
    if (!app.isPackaged) {
      if (items.length) items.push({ type: 'separator' });
      items.push({ label: 'Inspect Element', click: () => win.webContents.inspectElement(params.x, params.y) });
    }
    while (items.length && items[items.length - 1].type === 'separator') items.pop();
    if (items.length) Menu.buildFromTemplate(items).popup({ window: win });
  });

  // Interactive widgets are model-written iframes: never let a subframe navigate anywhere.
  win.webContents.on('will-frame-navigate', (details) => {
    if (!details.isMainFrame && !/^about:(srcdoc|blank)/.test(details.url)) details.preventDefault();
  });

  // Open external links in the default browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

// ---- Widget network policy -------------------------------------------------------------------
// Widgets are model-written iframes. Their CSP limits which sites they reach; this is the backstop,
// and it adds rules a CSP can't express: GET only (so nothing is uploaded), no cookies, no local
// network, and short URLs. The app's own frame is never affected.

const WIDGET_REFERER = 'https://github.com/ejsoler/penumbra';

/** Set by the app (see src/widgets/network.ts). Until then, widgets get no network at all. */
let widgetNet = { mode: 'ask', hosts: [], block: [] };

ipcMain.on('widget-net:set', (e, policy) => {
  if (e.senderFrame !== e.sender.mainFrame || !policy || typeof policy !== 'object') return;
  const list = (v) => (Array.isArray(v) ? v.filter((h) => typeof h === 'string').map((h) => h.toLowerCase()) : []);
  widgetNet = { mode: policy.mode === 'all' ? 'all' : 'ask', hosts: list(policy.hosts), block: list(policy.block) };
});

const isWidgetRequest = (d) => Boolean(d.webContents) && d.resourceType !== 'mainFrame' && (!d.frame || Boolean(d.frame.parent));

const hostMatches = (host, pattern) => (pattern.startsWith('*.') ? host.endsWith(pattern.slice(1)) : host === pattern);

/** Why a widget request is blocked, or null if it may go ahead. */
async function widgetBlockReason(d) {
  if (/^(data|blob|about):/.test(d.url)) return null;
  let url;
  try {
    url = new URL(d.url);
  } catch {
    return 'invalid address';
  }
  if (url.protocol !== 'https:') return 'only https sites are allowed';
  if (!['GET', 'HEAD', 'OPTIONS'].includes(d.method)) return `${d.method} requests are blocked: widgets can download, not send`;
  if (d.uploadData && d.uploadData.length) return 'sending data is blocked';
  if (d.url.length > 2048) return 'address too long';
  const host = url.hostname.toLowerCase();
  if (host.startsWith('[') || net.isIP(host)) return 'IP addresses are blocked';
  if (isLocalName(host) || widgetNet.block.includes(host)) return 'this computer and the local network are blocked';
  if (widgetNet.mode !== 'all' && !widgetNet.hosts.some((p) => hostMatches(host, p))) return 'site not allowed for widgets';
  if (await resolvesToPrivate(host)) return 'this site points to the local network';
  return null;
}

/** Reports a widget request to the app, which shows it in that widget's network log. */
function logWidgetRequest(d, extra) {
  if (d.method === 'OPTIONS' || !d.webContents || d.webContents.isDestroyed()) return;
  d.webContents.send('widget-net:request', { frame: d.frame?.name ?? '', method: d.method, url: d.url.slice(0, 2048), ...extra });
}

app.whenReady().then(() => {
  registerSkills();
  registerTools();
  registerUpdates();
  // macOS Dock icon while running unpackaged (a packaged build uses build/icon.icns).
  if (process.platform === 'darwin') app.dock?.setIcon(ICON);
  const { webRequest } = session.defaultSession;
  // A session has one listener per event, so each handler below covers both the app and widgets.
  webRequest.onBeforeRequest((details, cb) => {
    if (!isWidgetRequest(details)) return cb({});
    widgetBlockReason(details).then((blocked) => {
      if (blocked) logWidgetRequest(details, { blocked });
      cb({ cancel: Boolean(blocked) });
    });
  });
  webRequest.onBeforeSendHeaders((details, cb) => {
    const headers = details.requestHeaders;
    if (isWidgetRequest(details)) {
      // Widgets never send cookies. They identify as Penumbra, not the chat: some public services
      // (like OpenStreetMap's tile servers) require a Referer that names the app.
      for (const k of Object.keys(headers)) if (/^(cookie|referer|authorization)$/i.test(k)) delete headers[k];
      headers.Referer = WIDGET_REFERER;
    } else if (/^http:\/\/(127\.0\.0\.1|localhost):/.test(details.url) && (headers.Origin === 'null' || !headers.Origin)) {
      // Ollama checks the Origin header; file:// pages send "null", so present as localhost.
      headers.Origin = 'http://localhost';
    }
    cb({ requestHeaders: headers });
  });
  webRequest.onHeadersReceived((details, cb) => {
    const headers = { ...details.responseHeaders };
    if (isWidgetRequest(details)) {
      for (const k of Object.keys(headers)) if (/^set-cookie$/i.test(k)) delete headers[k];
    } else if (details.url.startsWith('https://huggingface.co/api/')) {
      // file:// pages send Origin "null"; make sure Hugging Face API responses are readable.
      for (const k of Object.keys(headers)) if (k.toLowerCase() === 'access-control-allow-origin') delete headers[k];
      headers['Access-Control-Allow-Origin'] = ['*'];
    }
    cb({ responseHeaders: headers });
  });
  webRequest.onCompleted((details) => isWidgetRequest(details) && logWidgetRequest(details, { status: details.statusCode }));
  webRequest.onErrorOccurred((details) => {
    if (!isWidgetRequest(details) || details.error === 'net::ERR_BLOCKED_BY_CLIENT') return; // already logged as blocked
    // ERR_ABORTED is the widget cancelling its own request (maps do this for tiles they no longer need).
    logWidgetRequest(details, details.error === 'net::ERR_ABORTED' ? { cancelled: true } : { failed: details.error });
  });
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, cb, details) => cb(details.isMainFrame));
  session.defaultSession.setPermissionCheckHandler((_wc, _permission, _origin, details) => details.isMainFrame !== false);

  createWindow();
  app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow());
});

app.on('window-all-closed', () => process.platform !== 'darwin' && app.quit());
