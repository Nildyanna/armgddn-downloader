'use strict';
// Remembers whether the last launches ended cleanly. A launch writes { running: true } and a normal quit rewrites it as { running: false }.
// A launch that finds running still true knows the one before it never got to quit properly (Chromium killed the app, a crash, a kill).
// Used on Linux to switch to software rendering after two launches in a row like that: a broken graphics driver can kill the app faster
// than the GPU-process marker can be written.
const fs = require('fs');

function readState(file) {
  try {
    const d = JSON.parse(fs.readFileSync(file, 'utf8'));
    return { running: !!d.running, unclean: Math.max(0, Number(d.unclean) || 0) };
  } catch (e) { return { running: false, unclean: 0 }; }
}

function writeState(file, state) {
  try { fs.writeFileSync(file, JSON.stringify(state)); } catch (e) { /* not worth failing a launch over */ }
}

// Call once at start. Returns how many launches in a row, up to and including the one before this, did not end cleanly.
function begin(file) {
  const st = readState(file);
  const unclean = st.running ? st.unclean + 1 : 0;
  writeState(file, { running: true, unclean });
  return unclean;
}

function markClean(file) {
  writeState(file, { running: false, unclean: 0 });
}

module.exports = { begin, markClean, readState };
