'use strict';
// Builder settings for a side-by-side test build (CI: build.yml, workflow_dispatch input test_build). The normal settings in
// package.json, with a different app id and name so it installs next to the real app instead of over it, no armgddn:// link
// registration, and a flag the app reads (main/testBuild.js). Never published.
const base = require('./package.json').build;
const t = { APP_ID: 'com.armgddn.downloader.test', NAME: 'ARMGDDN App Test' };

const config = {
  ...base,
  appId: t.APP_ID,
  productName: t.NAME,
  protocols: [],
  publish: null,
  extraMetadata: { name: 'armgddn-app-test', productName: t.NAME, armgddnTestBuild: true },
  win: { ...(base.win || {}), artifactName: 'ARMGDDN-App-Test-Setup-${version}.${ext}' },
  nsis: { ...(base.nsis || {}), shortcutName: t.NAME, uninstallDisplayName: t.NAME },
};
module.exports = config;
