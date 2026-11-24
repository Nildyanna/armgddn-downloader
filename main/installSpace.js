'use strict';
// Warning before an install when the drive is short of space (moved out of main.js, Nov 24 2026; docs/MAIN_SPLIT.md). Shared state is reached through ctx (main/context.js).
const ctx = require('./context');
const { getFreeDiskSpace, buildInstallSpaceWarning } = require('./files');
const { logToFile } = require('./log');
const { formatBytes } = require('./util');
const os = require('os');
const path = require('path');

// Installers unpack their temp files into the Windows temp folder (usually on
// C:) no matter where the game is installed, so a nearly-full temp drive makes
// setup "finish" instantly with nothing installed. Warn when the drive holding
// the temp folder has less free space than the download itself.
// Before a download starts: will the Windows temp-folder drive have room for
// setup's temp files once the download is done? If it's the same drive as the
// download, the downloaded files take their share of it first.
function preStartInstallSpaceWarning(totalSize, downloadPath) {
  try {
    if (process.platform !== 'win32') return null;
    const need = Number(totalSize) || 0;
    if (need <= 0) return null;
    const tempDir = os.tmpdir();
    const tempRoot = (path.parse(tempDir).root || '').toLowerCase();
    const dlRoot = (path.parse(path.resolve(String(downloadPath || ''))).root || '').toLowerCase();
    const free = getFreeDiskSpace(tempDir);
    if (free < 0) return null;
    const sameDrive = !!tempRoot && tempRoot === dlRoot;
    const required = sameDrive ? need * 2 : need;
    if (free >= required) return null;
    const driveLabel = (path.parse(tempDir).root || 'C:\\').replace(/[\\/]+$/, '');
    const dlLabel = (path.parse(path.resolve(String(downloadPath || ''))).root || '').replace(/[\\/]+$/, '') || 'your download folder';
    return buildInstallSpaceWarning({ need, required, free, sameDrive, driveLabel, dlLabel });
  } catch (e) {
    return null;
  }
}

function installSpaceTip(download) {
  try {
    if (process.platform !== 'win32') return '';
    const need = Number(download && download.totalSize) || 0;
    if (need <= 0) return '';
    const tempDir = os.tmpdir();
    const tempDrive = path.parse(tempDir).root || ((process.env.SystemDrive || 'C:') + '\\');
    const free = getFreeDiskSpace(tempDir);
    if (free < 0 || free >= need) return '';
    const driveLabel = tempDrive.replace(/[\\/]+$/, '');
    const msg = `Heads up: setup needs about ${formatBytes(need)} free on ${driveLabel} for its temp files ` +
      `(your Windows temp folder is there), even if you install to another drive. You have ${formatBytes(free)} free.`;
    logToFile(`[completeDownload] ${msg}`);
    return msg;
  } catch (e) {
    return '';
  }
}

module.exports = { preStartInstallSpaceWarning, installSpaceTip };
