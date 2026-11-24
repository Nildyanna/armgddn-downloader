#!/usr/bin/env node
'use strict';
// Serves the app's pages to an ordinary browser with made-up data (tools/preview/preview.html). Not part of the app.
//   npm run preview                       -> http://127.0.0.1:5178/renderer/native/preview.html?scene=downloads
//   PREVIEW_HOST=100.x.y.z npm run preview -> reachable from another PC on the tailnet
// Read-only: it only serves files under the repo, never writes.
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const HOST = process.env.PREVIEW_HOST || '127.0.0.1';
const PORT = Number(process.env.PREVIEW_PORT) || 5178;
const PAGE = '/renderer/native/preview.html';
const TYPES = { '.html': 'text/html', '.mjs': 'text/javascript', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.wav': 'audio/wav' };

// Only the page files and the vendored libraries are served.
const ALLOWED = [path.join(ROOT, 'renderer') + path.sep, path.join(ROOT, 'native', 'vendor') + path.sep];

http.createServer((req, res) => {
  let p;
  try { p = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch (e) { res.writeHead(400).end(); return; }
  if (p === '/' ) { res.writeHead(302, { Location: PAGE + '?scene=downloads' }).end(); return; }
  const file = p === PAGE ? path.join(__dirname, 'preview.html') : path.resolve(ROOT, '.' + p);
  if (p !== PAGE && !ALLOWED.some((a) => file.startsWith(a))) { res.writeHead(404).end('not found'); return; }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404).end('not found'); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(buf);
  });
}).listen(PORT, HOST, () => {
  console.log(`Preview: http://${HOST}:${PORT}${PAGE}?scene=downloads   (scene=downloads|home|library|mylist|settings, theme=harbor|classic|light)`);
});
