const { contextBridge, ipcRenderer } = require('electron');
// Staging only (native preview window). Everything goes through the main process; the page never gets the login token.
const call = (name) => (...args) => ipcRenderer.invoke(name, ...args);
contextBridge.exposeInMainWorld('nativeAPI', {
  status: call('native:status'), login: call('native:login'), remotes: call('native:remotes'),
  browse: call('native:browse'), stats: call('native:stats'),
});
