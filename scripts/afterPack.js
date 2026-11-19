'use strict';
// Runs after electron-builder has packed the app and before it is signed: turns off the Electron features this app never uses, so a stolen or
// tampered copy cannot be driven as a plain Node program (RunAsNode), started with a debugger port (--inspect) or told what to run through the
// NODE_OPTIONS environment variable. Nothing in the app depends on these; setupCheck/updater use PowerShell, not Electron-as-Node.
const path = require('path');
const { flipFuses, FuseVersion, FuseV1Options } = require('@electron/fuses');

function executableFor(context) {
  const { electronPlatformName: platform, appOutDir, packager } = context;
  const name = packager.appInfo.productFilename;
  if (platform === 'darwin') return path.join(appOutDir, name + '.app');
  if (platform === 'win32') return path.join(appOutDir, name + '.exe');
  return path.join(appOutDir, packager.executableName || name);
}

const FUSES = {
  version: FuseVersion.V1,
  resetAdHocDarwinSignature: true,   // arm64 macOS refuses a binary whose ad-hoc signature no longer matches after the flip
  [FuseV1Options.RunAsNode]: false,
  [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
  [FuseV1Options.EnableNodeCliInspectArguments]: false,
};

exports.default = async function afterPack(context) {
  await flipFuses(executableFor(context), FUSES);
};
exports.FUSES = FUSES;
exports.executableFor = executableFor;
