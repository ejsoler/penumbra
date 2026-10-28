// Keeps Penumbra running in the menu bar (macOS) or system tray (Windows, Linux) while scheduled tasks
// are on, so they run on time with the window closed. Closing the window then only hides it; Quit in
// the menu (or ⌘Q) really quits. With no active tasks, or the option off, closing works as usual.
const { app, BrowserWindow, Menu, Tray, ipcMain, nativeImage } = require('electron');
const path = require('path');

const BUILD = path.join(__dirname, '..', 'build');
let tray = null;
let quitting = false;
let status = { enabled: false, active: 0, next: null }; // sent by the app (src/scheduler.ts)

const mainWindow = () => BrowserWindow.getAllWindows()[0] ?? null;

function showWindow() {
  const win = mainWindow();
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

/** True when closing the window should hide it instead. */
const keepRunning = () => !quitting && status.enabled && status.active > 0;

function icon() {
  if (process.platform === 'darwin') {
    const img = nativeImage.createFromPath(path.join(BUILD, 'trayTemplate.png'));
    img.setTemplateImage(true);
    return img;
  }
  return nativeImage.createFromPath(path.join(BUILD, 'icon.png')).resize({ width: 16, height: 16 });
}

function updateTray() {
  if (!keepRunning() && !quitting) {
    tray?.destroy();
    tray = null;
    return;
  }
  if (quitting) return;
  if (!tray) {
    tray = new Tray(icon());
    tray.on('click', () => process.platform !== 'darwin' && showWindow());
  }
  const n = status.active;
  const next = status.next ? `Next: ${status.next.name} · ${status.next.when}` : 'Nothing due';
  tray.setToolTip(`Penumbra · ${n} scheduled task${n === 1 ? '' : 's'}`);
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Open Penumbra', click: showWindow },
      { type: 'separator' },
      { label: `${n} scheduled task${n === 1 ? '' : 's'} on`, enabled: false },
      { label: next, enabled: false },
      { type: 'separator' },
      { label: 'Quit Penumbra', click: () => app.quit() },
    ]),
  );
}

/** Call for each new window: closing it hides it while tasks need the app. */
function attachWindow(win) {
  win.on('close', (e) => {
    if (!keepRunning()) return;
    e.preventDefault();
    win.hide();
  });
}

function registerTray() {
  app.on('before-quit', () => {
    quitting = true;
  });
  ipcMain.on('tray:status', (e, s) => {
    if (e.senderFrame !== e.sender.mainFrame || !s || typeof s !== 'object') return;
    status = {
      enabled: Boolean(s.enabled),
      active: Math.max(0, Number(s.active) || 0),
      next: s.next && typeof s.next.name === 'string' ? { name: s.next.name.slice(0, 60), when: String(s.next.when).slice(0, 40) } : null,
    };
    updateTray();
  });
  ipcMain.on('app:show', (e) => e.senderFrame === e.sender.mainFrame && showWindow());
}

module.exports = { registerTray, attachWindow, showWindow };
