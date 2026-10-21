const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('komgaAPI', {
  getDefaults: () => ipcRenderer.invoke('komga-get-defaults'),
  submit: (data) => ipcRenderer.invoke('komga-submit', data),
  cancel: () => ipcRenderer.invoke('komga-cancel')
});
