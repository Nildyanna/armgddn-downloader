'use strict';
// Download history: loading and saving the list of finished downloads (moved out of main.js, Nov 24 2026; docs/MAIN_SPLIT.md). Shared state is reached through ctx (main/context.js).
const ctx = require('./context');
const fs = require('fs');

// Load history
function loadHistory() {
  try {
    const historyPath = ctx.getHistoryPath();
    if (fs.existsSync(historyPath)) {
      const data = fs.readFileSync(historyPath, 'utf8');
      ctx.downloadHistory = JSON.parse(data);
    } else {
    }
  } catch (e) {
    console.error('Failed to load history:', e);
  }
}

// Save history
function saveHistory() {
  try {
    const historyPath = ctx.getHistoryPath();
    fs.writeFileSync(historyPath, JSON.stringify(ctx.downloadHistory, null, 2));
  } catch (e) {
    console.error('Failed to save history:', e);
  }
}

module.exports = { loadHistory, saveHistory };
