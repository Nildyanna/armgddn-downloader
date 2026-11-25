'use strict';
// The member's download speed limit (Settings > Download speed limit), as ONE token bucket shared by every connection of every
// download (2026-11-25). Until now the segmented engine had its own limiter per file run and the limit was split evenly over
// "downloads at the same time", so 2 files x 16 connections could still go over the limit, and a change only took effect after
// the download was restarted.
//
//   - rate: bytes per second; 0 = unlimited (take() then resolves at once and the engines skip it entirely)
//   - bytes are taken as they arrive from the network: the engine pauses the response until its bytes are granted, so the
//     connection itself slows down (TCP / HTTP/2 flow control), not just the disk writes
//   - FIFO: connections are served in the order they asked, so they share the limit fairly and none waits long enough to trip
//     the 60 s "no data" timeout (each waits about (connections x one network read) / rate, well under a second)
//   - the bucket starts empty and holds at most burstMs worth of bytes, so the measured rate stays within a few percent of
//     the limit over any few seconds
//   - setRate() applies at once to every waiting and future read: a change in Settings or the "only between" hours does not
//     restart any download
//   - charge(n) books bytes that came in some other way (the rclone path, which has its own --bwlimit): the bucket goes into
//     debt and the other connections wait for it, so the total stays at the limit
const MIN_CAPACITY = 16 * 1024;

class TokenBucket {
  constructor(opts = {}) {
    this._now = opts.now || (() => Date.now());
    this._setTimer = opts.setTimer || ((fn, ms) => setTimeout(fn, ms));
    this._clearTimer = opts.clearTimer || ((t) => clearTimeout(t));
    this._burstMs = Number(opts.burstMs) > 0 ? Number(opts.burstMs) : 250;
    this._rate = 0;
    this._tokens = 0;
    this._last = this._now();
    this._queue = [];
    this._timer = null;
    this.setRate(opts.rate || 0);
  }

  get rate() { return this._rate; }
  get limited() { return this._rate > 0; }
  get waiting() { return this._queue.length; }
  _cap() { return Math.max(MIN_CAPACITY, this._rate * this._burstMs / 1000); }

  _refill() {
    const t = this._now();
    const dt = Math.max(0, t - this._last);
    this._last = t;
    if (this._rate > 0) this._tokens = Math.min(this._cap(), this._tokens + dt * this._rate / 1000);
  }

  setRate(bytesPerSec) {
    const r = Number(bytesPerSec);
    const next = Number.isFinite(r) && r > 0 ? r : 0;
    this._refill();                       // time so far counts at the old rate
    if (next === this._rate) { this._pump(); return; }
    const wasLimited = this._rate > 0;
    this._rate = next;
    if (!wasLimited) this._tokens = 0;    // a limit switched on starts from an empty bucket, never with a burst
    else this._tokens = Math.min(this._tokens, this._cap());
    this._pump();
  }

  // Bytes that arrived without asking (another engine): the bucket goes into debt, so the next take() waits for them.
  charge(n) {
    const b = Number(n);
    if (!(this._rate > 0) || !(b > 0)) return;
    this._refill();
    this._tokens -= b;
    this._pump();
  }

  // Resolves when `n` bytes may be read. An aborted signal resolves at once (the caller is shutting the connection anyway).
  take(n, signal) {
    const bytes = Math.max(0, Number(n) || 0);
    if (!(this._rate > 0) || bytes === 0) return Promise.resolve();
    if (signal && signal.aborted) return Promise.resolve();
    return new Promise((resolve) => {
      const w = { n: bytes, resolve, signal: null, onAbort: null };
      if (signal && typeof signal.addEventListener === 'function') {
        w.signal = signal;
        w.onAbort = () => { const i = this._queue.indexOf(w); if (i !== -1) this._queue.splice(i, 1); resolve(); this._pump(); };
        signal.addEventListener('abort', w.onAbort, { once: true });
      }
      this._queue.push(w);
      this._pump();
    });
  }

  _grant(w) {
    if (w.signal && w.onAbort) { try { w.signal.removeEventListener('abort', w.onAbort); } catch (e) { } }
    w.resolve();
  }

  _pump() {
    if (this._timer) { this._clearTimer(this._timer); this._timer = null; }
    if (!this._queue.length) return;
    if (!(this._rate > 0)) { const all = this._queue.splice(0); for (const w of all) this._grant(w); return; }
    this._refill();
    while (this._queue.length) {
      const head = this._queue[0];
      // A read bigger than the bucket is granted once the bucket is full and leaves it in debt: the long-run rate is still exact.
      const need = Math.min(head.n, this._cap());
      if (this._tokens < need) break;
      this._tokens -= head.n;
      this._queue.shift();
      this._grant(head);
    }
    if (this._queue.length) {
      const need = Math.min(this._queue[0].n, this._cap());
      const ms = Math.max(2, Math.ceil((need - this._tokens) / this._rate * 1000));
      this._timer = this._setTimer(() => { this._timer = null; this._pump(); }, ms);
    }
  }
}

// The one bucket the app uses for the member's limit (main/speedLimit.js keeps its rate up to date).
const shared = new TokenBucket();

const MB = 1024 * 1024;
const mbpsToBytes = (mbps) => (Number(mbps) > 0 ? Number(mbps) * MB : 0);

module.exports = { TokenBucket, shared, mbpsToBytes, MB };
