'use strict';
// When the app was started from something that later closed its terminal or log pipe (a launcher, a service, a closed shell), every console.log or
// console.error in the main process fails with "write EPIPE". Nothing handled that failure, so it surfaced as an uncaught exception, whose report
// was logged with console.error, which failed again: a loop of dozens of errors a minute (Sentry ARMGDDN-COMPANION-67, Fedora, 2026-11-22).
// A closed output is harmless, so the error on stdout and stderr is swallowed, and everything else is left exactly as it was.

function install(proc) {
  let n = 0;
  for (const name of ['stdout', 'stderr']) {
    const stream = proc && proc[name];
    if (!stream || typeof stream.on !== 'function') continue;
    stream.on('error', (e) => {
      if (e && (e.code === 'EPIPE' || e.code === 'EIO' || e.code === 'ERR_STREAM_DESTROYED')) return;
      // Any other stream error keeps its normal behavior: a listener replaces the default throw, so rethrow it on the next tick.
      setImmediate(() => { throw e; });
    });
    n += 1;
  }
  return n;
}

// For Sentry's beforeSend: the same failure arriving from elsewhere is not worth an issue.
function isClosedOutputError(event) {
  try {
    const values = (event && event.exception && event.exception.values) || [];
    return values.some((v) => v && /^write (EPIPE|EIO)\b/.test(String(v.value || '')));
  } catch (e) { return false; }
}

module.exports = { install, isClosedOutputError };
