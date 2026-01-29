const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('updateAPI', {
  onProgress: (callback) => {
    ipcRenderer.on('update-progress', (event, data) => callback(data));
  },
  onStatus: (callback) => {
    ipcRenderer.on('update-status', (event, message) => callback(message));
  },
  openExternal: (url) => {
    return ipcRenderer.invoke('open-external', url);
  },
  removeAllListeners: (channel) => {
    ipcRenderer.removeAllListeners(channel);
  }
});
