'use strict';
// The member's own Komga server settings, kept on this PC (moved out of main.js unchanged, Nov 24 2026; docs/MAIN_SPLIT.md).
const secureStore = require('../secureStore');
const { komgaConfigPath } = require('./files');
const fs = require('fs');

async function loadKomgaConfig() {
  try {
    const d = JSON.parse(fs.readFileSync(komgaConfigPath(), 'utf8'));
    if (!d || !d.url || !d.key) return null;
    const key = d.enc ? await secureStore.decrypt(Buffer.from(d.key, 'base64')) : d.key;
    return { url: d.url, key };
  } catch (e) { return null; }
}

async function saveKomgaConfig(cfg) {
  const enc = await secureStore.isAvailable();
  const data = { url: cfg.url, enc, key: enc ? (await secureStore.encrypt(cfg.key)).toString('base64') : cfg.key };
  fs.writeFileSync(komgaConfigPath(), JSON.stringify(data), { mode: 0o600 });
}

function forgetKomgaKey() { try { fs.unlinkSync(komgaConfigPath()); } catch (e) { } }

module.exports = { loadKomgaConfig, saveKomgaConfig, forgetKomgaKey };
