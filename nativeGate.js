'use strict';
// Which window the app opens. Since version 6.0.0 it is always the native window: every member uses it and there is no setting, menu entry or
// button to go back. The only way to the old window is the developer flag --classic on the command line (used for development and nothing else).
//
// Before 6.0.0 the site decided per member (GET /api/auth-status { nativePreview }) and a member could turn the native window off; that machinery is gone.

// Should this launch open the native window?
function wantsNative({ argv = [] } = {}) {
  return !argv.includes('--classic');
}

module.exports = { wantsNative };
