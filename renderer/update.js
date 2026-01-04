const { ipcRenderer } = require('electron');

const statusEl = document.getElementById('status');
const fillEl = document.getElementById('progress-fill');
const percentEl = document.getElementById('percent');
const speedEl = document.getElementById('speed');

ipcRenderer.on('update-progress', (event, data) => {
  // data: { percent, transferred, total, speed }
  if (data.percent !== undefined) {
    const p = Math.min(100, Math.max(0, data.percent));
    fillEl.style.width = `${p}%`;
    percentEl.textContent = `${p.toFixed(1)}%`;
  }
  
  if (data.speed) {
    speedEl.textContent = data.speed;
  }
  
  if (data.status) {
    statusEl.textContent = data.status;
  }
});

ipcRenderer.on('update-status', (event, message) => {
  statusEl.textContent = message;
  if (message.includes('Restarting') || message.includes('Installing')) {
    fillEl.style.width = '100%';
    fillEl.classList.add('indeterminate');
    percentEl.textContent = ''; // Hide percent during indeterminate phase
    speedEl.textContent = '';   // Hide speed during indeterminate phase
  }
});
