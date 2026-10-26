// Runs in the app's main frame only (never in widget iframes). Lets the app tell the main process
// which sites widgets may reach, and receive a log of the requests widgets make.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('penumbraHost', {
  setWidgetNetwork: (policy) => ipcRenderer.send('widget-net:set', policy),
  onWidgetRequest: (cb) => {
    const listener = (_e, r) => cb(r);
    ipcRenderer.on('widget-net:request', listener);
    return () => ipcRenderer.removeListener('widget-net:request', listener);
  },
});
