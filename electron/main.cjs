const { app, BrowserWindow, Menu, shell, session } = require('electron');
const path = require('path');

const ICON = path.join(__dirname, '..', 'build', 'icon.png');
app.setName('Ollama Studio');

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
    webPreferences: { contextIsolation: true, nodeIntegration: false },
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

  // Open external links in the default browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

app.whenReady().then(() => {
  // macOS Dock icon while running unpackaged (a packaged build uses build/icon.icns).
  if (process.platform === 'darwin') app.dock?.setIcon(ICON);
  // Ollama checks the Origin header; file:// pages send "null", so present as localhost.
  session.defaultSession.webRequest.onBeforeSendHeaders(
    { urls: ['http://127.0.0.1:*/*', 'http://localhost:*/*'] },
    (details, cb) => {
      if (details.requestHeaders.Origin === 'null' || !details.requestHeaders.Origin) {
        details.requestHeaders.Origin = 'http://localhost';
      }
      cb({ requestHeaders: details.requestHeaders });
    },
  );
  // file:// pages send Origin "null"; make sure Hugging Face API responses are readable.
  session.defaultSession.webRequest.onHeadersReceived({ urls: ['https://huggingface.co/api/*'] }, (details, cb) => {
    const headers = { ...details.responseHeaders };
    for (const k of Object.keys(headers)) if (k.toLowerCase() === 'access-control-allow-origin') delete headers[k];
    headers['Access-Control-Allow-Origin'] = ['*'];
    cb({ responseHeaders: headers });
  });
  createWindow();
  app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow());
});

app.on('window-all-closed', () => process.platform !== 'darwin' && app.quit());
