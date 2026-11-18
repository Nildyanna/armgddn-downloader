const { contextBridge, ipcRenderer } = require('electron');
// Staging only (native preview window). Everything goes through the main process; the page never gets the login token.
const call = (name) => (...args) => ipcRenderer.invoke(name, ...args);
contextBridge.exposeInMainWorld('nativeAPI', {
  status: call('native:status'), login: call('native:login'), remotes: call('native:remotes'),
  browse: call('native:browse'), stats: call('native:stats'),
  onOpen: (cb) => ipcRenderer.on('native:open', (_e, msg) => cb(msg)),
  download: call('native:download'), downloadBatch: call('native:downloadBatch'), downloads: call('native:downloads'),
  pause: call('pause-download'), resume: call('resume-download'), cancel: call('cancel-download'), retry: call('retry-download'), openFolder: call('open-folder'), history: call('get-history'),
  openClassic: call('native:openClassic'), exportList: call('native:exportList'), copy: call('native:copy'), runSetupCheck: call('run-setup-check'), buildSetupReport: call('build-setup-report'), sendSupportLog: call('send-support-log'), runConnectionTest: call('run-connection-test'),
  onConnectionTestProgress: (cb) => ipcRenderer.on('connection-test-progress', (_e, p) => cb(p)), prefs: call('native:prefs'), trending: call('native:trending'), gems: call('native:gems'), getSettings: call('get-settings'), importSettings: call('native-import-settings'), saveSettings: call('save-settings'), browseFolder: call('browse-folder'), readme: call('native:readme'), openLink: call('native:openLink'),
  requests: call('native:requests'), thread: call('native:thread'), comment: call('native:comment'), submitRequest: call('native:submitRequest'),
});
