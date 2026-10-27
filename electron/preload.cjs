// Runs in the app's main frame only (never in widget iframes). Gives the app its skills folder and the
// agent tools (chat folder, terminal, web), lets it tell the main process which sites widgets may
// reach, and receive a log of widget requests.
// Typed in src/host.ts.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('penumbraHost', {
  skills: {
    list: () => ipcRenderer.invoke('skills:list'),
    read: (id) => ipcRenderer.invoke('skills:read', id),
    readFile: (id, rel) => ipcRenderer.invoke('skills:readFile', id, rel),
    save: (id, content) => ipcRenderer.invoke('skills:save', id, content),
    remove: (id) => ipcRenderer.invoke('skills:delete', id),
    import: () => ipcRenderer.invoke('skills:import'),
    reveal: (id) => ipcRenderer.invoke('skills:reveal', id),
  },
  tools: {
    pickFolder: () => ipcRenderer.invoke('tools:pickFolder'),
    list: (root, rel, depth) => ipcRenderer.invoke('tools:list', root, rel, depth),
    read: (root, rel, offset) => ipcRenderer.invoke('tools:read', root, rel, offset),
    write: (root, rel, content) => ipcRenderer.invoke('tools:write', root, rel, content),
    run: (root, command, id, timeout) => ipcRenderer.invoke('tools:run', root, command, id, timeout),
    kill: (id) => ipcRenderer.invoke('tools:kill', id),
    fetch: (url) => ipcRenderer.invoke('tools:fetch', url),
    search: (query) => ipcRenderer.invoke('tools:search', query),
    reveal: (root) => ipcRenderer.invoke('tools:reveal', root),
  },
  setWidgetNetwork: (policy) => ipcRenderer.send('widget-net:set', policy),
  onWidgetRequest: (cb) => {
    const listener = (_e, r) => cb(r);
    ipcRenderer.on('widget-net:request', listener);
    return () => ipcRenderer.removeListener('widget-net:request', listener);
  },
});
