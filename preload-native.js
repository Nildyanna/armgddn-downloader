const { contextBridge, ipcRenderer } = require('electron');
// Staging only (native preview window). Everything goes through the main process; the page never gets the login token.
const call = (name) => (...args) => ipcRenderer.invoke(name, ...args);
contextBridge.exposeInMainWorld('nativeAPI', {
  status: call('native:status'), login: call('native:login'), remotes: call('native:remotes'),
  browse: call('native:browse'), stats: call('native:stats'),
  download: call('native:download'), downloadBatch: call('native:downloadBatch'), downloads: call('native:downloads'),
  pause: call('pause-download'), resume: call('resume-download'), cancel: call('cancel-download'), retry: call('retry-download'), openFolder: call('open-folder'), history: call('get-history'),
  readme: call('native:readme'), openLink: call('native:openLink'),
  requests: call('native:requests'), thread: call('native:thread'), comment: call('native:comment'), submitRequest: call('native:submitRequest'),
});
