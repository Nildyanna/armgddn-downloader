'use strict';
// Live access to the main process's shared state for the modules split out of main.js (Nov 24 2026; docs/MAIN_SPLIT.md).
// main.js keeps its variables (settings, mainWindow, sessionToken...) and registers getters and setters for them here once, at start-up,
// with provide(). A moved function reads ctx.settings and assigns ctx.sessionToken = x; both go straight to main.js's own variable, so
// the code in main.js that still uses the plain names sees the same value. Functions still in main.js are offered here the same way.
const ctx = {};

Object.defineProperty(ctx, 'provide', {
  enumerable: false,
  value(defs) { Object.defineProperties(ctx, Object.getOwnPropertyDescriptors(defs)); },
});

module.exports = ctx;
