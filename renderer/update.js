const statusEl = document.getElementById('status');
const fillEl = document.getElementById('progress-fill');
const percentEl = document.getElementById('percent');
const speedEl = document.getElementById('speed');
const titleEl = document.getElementById('title');

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
