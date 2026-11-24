'use strict';
// A side-by-side test build (built by CI with --config electron-builder.test.js, never released). It is packaged, so the usual
// "not packaged" guards do not cover it: everything that would touch the installed app checks isTestBuild too. It never claims
// armgddn:// links, never installs or announces updates, never writes the OS startup entry or renames shortcuts, and keeps its own
// profile folder (settings, sign-in, history) so the installed app's are left alone.
let isTestBuild = false;
try { isTestBuild = !!require('../package.json').armgddnTestBuild; } catch (e) { }
const PROFILE_FOLDER = 'armgddn-app-test';
const APP_ID = 'com.armgddn.downloader.test';
const NAME = 'ARMGDDN App Test';

module.exports = { isTestBuild, PROFILE_FOLDER, APP_ID, NAME };
