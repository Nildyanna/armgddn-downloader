const { contextBridge, ipcRenderer } = require('electron');
// Staging only (native preview window). Everything goes through the main process; the page never gets the login token.
const call = (name) => (...args) => ipcRenderer.invoke(name, ...args);
contextBridge.exposeInMainWorld('nativeAPI', {
  quiet: (() => { try { return process.argv.some((a) => a.startsWith('--native-shot') || a === '--native-quiet'); } catch (e) { return false; } })(),   // screenshot runs stay silent
  status: call('native:status'), login: call('native:login'), remotes: call('native:remotes'),
  browse: call('native:browse'), stats: call('native:stats'),
  onOpen: (cb) => ipcRenderer.on('native:open', (_e, msg) => cb(msg)),
  download: call('native:download'), downloadBatch: call('native:downloadBatch'), downloads: call('native:downloads'),
  pause: call('pause-download'), resume: call('resume-download'), cancel: call('cancel-download'), retry: call('retry-download'), openFolder: call('open-folder'), history: call('get-history'),
  exportList: call('native:exportList'), copy: call('native:copy'), runSetupCheck: call('run-setup-check'), buildSetupReport: call('build-setup-report'), sendSupportLog: call('send-support-log'), runConnectionTest: call('run-connection-test'),
  onConnectionTestProgress: (cb) => ipcRenderer.on('connection-test-progress', (_e, p) => cb(p)), prefs: call('native:prefs'), logout: call('native:logout'), appProgress: call('native:appProgress'), trending: call('native:trending'), gems: call('native:gems'), getSettings: call('get-settings'), importSettings: call('native-import-settings'), saveSettings: call('save-settings'), browseFolder: call('browse-folder'), readme: call('native:readme'), textFile: call('native:textFile'), openLink: call('native:openLink'),
  comicsState: call('comics-get-state'), comicsPickFolder: call('comics-pick-folder'), comicsScan: call('comics-scan'), comicsCancelScan: call('comics-cancel-scan'), comicsInfo: call('comics-info'), comicsCompare: call('comics-compare'), comicsDownloadMissing: call('comics-download-missing'),
  musicState: call('music-get-state'), musicPickFolder: call('music-pick-folder'), musicScan: call('music-scan'), musicCancelScan: call('music-cancel-scan'), musicInfo: call('music-info'), musicCompare: call('music-compare'), musicDownloadMissing: call('music-download-missing'),
  komgaState: call('native-komga-state'), komgaSave: call('native-komga-save'), komgaForget: call('native-komga-forget'), komgaImport: call('native-komga-import'), komgaAdd: call('native-komga-add'), komgaLists: call('native-komga-lists'),
  openExternal: call('open-external'),
  getScheduleBanner: call('get-schedule-banner'), onScheduleBanner: (cb) => ipcRenderer.on('schedule-banner', (_e, t) => cb(t)),
  checkGameUpdates: call('check-game-updates'), clearHistory: call('clear-history'),
  getWhatsNew: call('get-whats-new'), pendingWhatsNew: call('native-pending-whats-new'), getHelp7zVideoSrc: call('get-help-7z-video-src'),
  checkUpdates: call('check-updates'), installUpdate: (options) => ipcRenderer.invoke('install-update', null, options),
  onUpdateAvailable: (cb) => ipcRenderer.on('native:updateAvailable', (_e, info) => cb(info)),
  adminGet: call('native:adminGet'), adminDo: call('native:adminDo'), savePdf: call('native:savePdf'),
  comicBundles: call('native:comicBundles'),
  watchlist: call('native:watchlist'), watchAdd: call('native:watchAdd'), watchRemove: call('native:watchRemove'),
  badges: call('native:badges'), badgeChoose: call('native:badgeChoose'),
  requests: call('native:requests'), thread: call('native:thread'), comment: call('native:comment'), submitRequest: call('native:submitRequest'),
});
