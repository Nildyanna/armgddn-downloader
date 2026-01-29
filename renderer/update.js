const statusEl = document.getElementById('status');
const fillEl = document.getElementById('progress-fill');
const percentEl = document.getElementById('percent');
const speedEl = document.getElementById('speed');
const titleEl = document.getElementById('title');
const manualEl = document.getElementById('manual-update');
const manualOpenBtn = document.getElementById('manual-open');
const manualCloseBtn = document.getElementById('manual-close');

const RELEASES_URL = 'https://github.com/Nildyanna/armgddn-downloader/releases/latest';

function setIndeterminate(on) {
  if (on) {
    fillEl.style.width = '100%';
    fillEl.classList.add('indeterminate');
    percentEl.textContent = '';
    speedEl.textContent = '';
  } else {
    fillEl.classList.remove('indeterminate');
  }
}

function showManualUpdate(message) {
  if (titleEl) titleEl.textContent = 'Manual Update Required';
  setIndeterminate(true);
  if (manualEl) manualEl.style.display = 'block';
  if (statusEl && message) statusEl.textContent = message;
}

if (manualOpenBtn) {
  manualOpenBtn.addEventListener('click', async () => {
    try {
      if (window.updateAPI && typeof window.updateAPI.openExternal === 'function') {
        await window.updateAPI.openExternal(RELEASES_URL);
      }
    } catch (e) {}
  });
}

if (manualCloseBtn) {
  manualCloseBtn.addEventListener('click', () => {
    try { window.close(); } catch (e) {}
  });
}

window.updateAPI.onProgress((data) => {
  // data: { percent, transferred, total, speed }
  if (data.percent !== undefined) {
    setIndeterminate(false);
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

window.updateAPI.onStatus((message) => {
  statusEl.textContent = message;

  const m = String(message || '');
  if (m.startsWith('Manual update required')) {
    showManualUpdate(m);
    return;
  }
  if (titleEl) {
    if (m.includes('Verifying') || m.includes('signature') || m.includes('Checking') || m.includes('Reading')) {
      titleEl.textContent = 'Verifying Update';
    } else if (m.includes('Installing') || m.includes('restart')) {
      titleEl.textContent = 'Installing Update';
    } else if (m.includes('Downloading')) {
      titleEl.textContent = 'Downloading Update';
    }
  }

  if (m.includes('Verifying') || m.includes('signature') || m.includes('Checking') || m.includes('Reading') || m.includes('Installing') || m.includes('Restarting')) {
    setIndeterminate(true);
  }
});
