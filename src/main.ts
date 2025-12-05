import { invoke } from "@tauri-apps/api/core";
import { t, setLanguage, getLanguage, type Language } from "./i18n";

interface DownloadStatus {
  id: string;
  filename: string;
  url: string;
  state: string;
  downloaded_bytes: number;
  total_bytes: number;
  speed_bps: number;
  error?: string;
}

let downloads: DownloadStatus[] = [];
// @ts-ignore - Used for setInterval, TS doesn't detect usage
let refreshInterval: ReturnType<typeof setInterval> | null = null;

async function fetchManifest() {
  const urlInput = document.getElementById("manifest-url") as HTMLInputElement;
  const url = urlInput.value.trim();
  
  if (!url) {
    alert("Please enter a manifest URL");
    return;
  }

  try {
    const manifest = await invoke("fetch_manifest", { url });
    console.log("Manifest:", manifest);
    
    // Add downloads from manifest
    const files = (manifest as any).files || [];
    for (const file of files) {
      await invoke("add_download", {
        url: file.url,
        filename: file.name,
        size: file.size || 0,
      });
    }
    
    await refreshDownloads();
    alert(`Added ${files.length} downloads to queue`);
  } catch (error) {
    console.error("Failed to fetch manifest:", error);
    alert(`Failed to fetch manifest: ${error}`);
  }
}

let previousDownloads: DownloadStatus[] = [];

async function refreshDownloads() {
  try {
    const newDownloads = await invoke("get_downloads") as DownloadStatus[];
    
    // Check for newly completed downloads and send notifications + add to history
    for (const download of newDownloads) {
      const previous = previousDownloads.find(d => d.id === download.id);
      if (previous && previous.state !== "completed" && download.state === "completed") {
        const sizeMB = (download.total_bytes / (1024 * 1024)).toFixed(2);
        await invoke("send_notification", {
          title: "Download Complete!",
          body: `${download.filename} (${sizeMB} MB)`
        }).catch(err => console.error("Notification failed:", err));
        
        // Add to history
        const downloadPath = await invoke("get_download_path") as string;
        await invoke("add_to_history", {
          filename: download.filename,
          size: download.total_bytes,
          downloadPath: `${downloadPath}/${download.filename}`
        }).catch(err => console.error("Failed to add to history:", err));
      }
    }
    
    previousDownloads = newDownloads;
    downloads = newDownloads;
    renderDownloads();
  } catch (error) {
    console.error("Failed to refresh downloads:", error);
  }
}

function renderDownloads() {
  const container = document.getElementById("downloads-list");
  if (!container) return;

  if (downloads.length === 0) {
    container.innerHTML = '<div class="empty-state">No downloads yet. Add a manifest URL above to get started.</div>';
    return;
  }

  container.innerHTML = downloads
    .map((download) => {
      const progress = download.total_bytes > 0
        ? (download.downloaded_bytes / download.total_bytes) * 100
        : 0;
      
      const speedMBps = (download.speed_bps / (1024 * 1024)).toFixed(2);
      const downloadedMB = (download.downloaded_bytes / (1024 * 1024)).toFixed(2);
      const totalMB = (download.total_bytes / (1024 * 1024)).toFixed(2);

      let actionButtons = "";
      if (download.state === "downloading") {
        actionButtons = `<button onclick="pauseDownload('${download.id}')">⏸ Pause</button>`;
        actionButtons += ` <button onclick="cancelDownload('${download.id}')" class="cancel-btn">✕ Cancel</button>`;
      } else if (download.state === "paused") {
        actionButtons = `<button onclick="resumeDownload('${download.id}')">▶ Resume</button>`;
        actionButtons += ` <button onclick="cancelDownload('${download.id}')" class="cancel-btn">✕ Cancel</button>`;
      } else if (download.state === "queued") {
        actionButtons = `<button onclick="startDownload('${download.id}')">▶ Start</button>`;
        actionButtons += ` <button onclick="cancelDownload('${download.id}')" class="cancel-btn">✕ Cancel</button>`;
      } else if (download.state === "scheduled") {
        actionButtons = `<button onclick="startDownload('${download.id}')">▶ Start Now</button>`;
        actionButtons += ` <button onclick="cancelDownload('${download.id}')" class="cancel-btn">✕ Cancel</button>`;
      } else if (download.state === "failed") {
        actionButtons = `<button onclick="retryDownload('${download.id}')" class="retry-btn">🔄 Retry</button>`;
        actionButtons += ` <button onclick="cancelDownload('${download.id}')" class="cancel-btn">✕ Remove</button>`;
      }
      
      const categoryBadge = (download as any).category ? `<span class="category-badge">${escapeHtml((download as any).category)}</span>` : "";
      const scheduledInfo = (download as any).scheduled_start && download.state === "scheduled" 
        ? `<span class="scheduled-time">⏰ ${new Date((download as any).scheduled_start).toLocaleString()}</span>` 
        : "";

      return `
        <div class="download-item ${download.state}">
          <div class="download-header">
            <div class="download-filename">${escapeHtml(download.filename)} ${categoryBadge}</div>
            <div class="download-state">${download.state}</div>
          </div>
          <div class="progress-bar">
            <div class="progress-fill" style="width: ${progress}%"></div>
          </div>
          <div class="download-info">
            <span>${downloadedMB} MB / ${totalMB} MB</span>
            ${download.state === "downloading" ? `<span>${speedMBps} MB/s</span>` : ""}
            ${scheduledInfo}
            ${download.error ? `<span class="error">${escapeHtml(download.error)}</span>` : ""}
          </div>
          <div class="download-actions">
            ${actionButtons}
          </div>
        </div>
      `;
    })
    .join("");
}

function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

(window as any).startDownload = async (id: string) => {
  try {
    await invoke("start_download", { downloadId: id });
    await refreshDownloads();
  } catch (error) {
    alert(`Failed to start download: ${error}`);
  }
};

(window as any).pauseDownload = async (id: string) => {
  try {
    await invoke("pause_download", { downloadId: id });
    await refreshDownloads();
  } catch (error) {
    alert(`Failed to pause download: ${error}`);
  }
};

(window as any).resumeDownload = async (id: string) => {
  try {
    await invoke("resume_download", { downloadId: id });
    await refreshDownloads();
  } catch (error) {
    alert(`Failed to resume download: ${error}`);
  }
};

(window as any).cancelDownload = async (id: string) => {
  try {
    await invoke("cancel_download", { downloadId: id });
    await refreshDownloads();
  } catch (error) {
    alert(`Failed to cancel download: ${error}`);
  }
};

(window as any).retryDownload = async (id: string) => {
  try {
    await invoke("retry_download", { downloadId: id });
    await refreshDownloads();
  } catch (error) {
    alert(`Failed to retry download: ${error}`);
  }
};

async function openSettings() {
  const settingsPanel = document.getElementById("settings-panel");
  if (settingsPanel) {
    settingsPanel.style.display = "block";
    
    // Load current settings
    try {
      const downloadPath = await invoke("get_download_path");
      const pathInput = document.getElementById("download-path") as HTMLInputElement;
      if (pathInput) pathInput.value = downloadPath as string;
      
      // Load language setting
      const languageSelect = document.getElementById("language-select") as HTMLSelectElement;
      if (languageSelect) languageSelect.value = getLanguage();
    } catch (error) {
    }
  }
}

function closeSettings() {
  const settingsPanel = document.getElementById("settings-panel");
  if (settingsPanel) {
    settingsPanel.style.display = "none";
  }
}

async function saveSettings() {
  const pathInput = document.getElementById("download-path") as HTMLInputElement;
  const concurrentInput = document.getElementById("concurrent-downloads") as HTMLInputElement;
  const tokenInput = document.getElementById("auth-token") as HTMLInputElement;
  const languageSelect = document.getElementById("language-select") as HTMLSelectElement;

  try {
    if (pathInput.value) {
      await invoke("set_download_path", { path: pathInput.value });
    }
    if (concurrentInput.value) {
      await invoke("set_concurrent_downloads", { count: parseInt(concurrentInput.value) });
    }
    if (tokenInput.value) {
      await invoke("set_auth_token", { token: tokenInput.value });
    }
    if (languageSelect.value) {
      setLanguage(languageSelect.value as Language);
      // Reload the page to apply new language
      window.location.reload();
    }
    
    alert(t('settings.saved') || "Settings saved successfully");
    closeSettings();
  } catch (error) {
    alert(`Failed to save settings: ${error}`);
  }
}

async function checkForUpdates(silent = false) {
  try {
    // Dynamic import to handle plugin availability
    // @ts-ignore - Plugin loaded at runtime by Tauri
    const { check } = await import("@tauri-apps/plugin-updater");
    // @ts-ignore - Plugin loaded at runtime by Tauri
    const { relaunch } = await import("@tauri-apps/plugin-process");
    
    if (!silent) {
      console.log("Checking for updates...");
    }
    
    const update = await check();
    
    if (update?.available) {
      const shouldUpdate = confirm(
        `Update available: ${update.version}\n\n` +
        `Current version: ${update.currentVersion}\n\n` +
        `Would you like to download and install it now?`
      );
      
      if (shouldUpdate) {
        console.log("Downloading update...");
        await update.downloadAndInstall();
        
        const shouldRelaunch = confirm(
          "Update installed successfully!\n\n" +
          "The application needs to restart to apply the update. Restart now?"
        );
        
        if (shouldRelaunch) {
          await relaunch();
        }
      }
    } else if (!silent) {
      alert("You're already running the latest version!");
    }
  } catch (error) {
    if (!silent) {
      console.error("Failed to check for updates:", error);
      alert(`Failed to check for updates: ${error}`);
    }
  }
}

async function openHistory() {
  const historyPanel = document.getElementById("history-panel");
  if (historyPanel) {
    historyPanel.style.display = "block";
    await loadHistory();
  }
}

function closeHistory() {
  const historyPanel = document.getElementById("history-panel");
  if (historyPanel) {
    historyPanel.style.display = "none";
  }
}

async function loadHistory() {
  try {
    const history = await invoke("get_download_history") as any[];
    const container = document.getElementById("history-list");
    if (!container) return;

    if (history.length === 0) {
      container.innerHTML = '<div class="empty-state">No download history yet.</div>';
      return;
    }

    container.innerHTML = history.map(item => {
      const sizeMB = (item.size / (1024 * 1024)).toFixed(2);
      const date = new Date(item.completed_at).toLocaleString();
      return `
        <div class="history-item">
          <div class="history-item-header">
            <span class="history-filename">📁 ${escapeHtml(item.filename)}</span>
            <span class="history-size">${sizeMB} MB</span>
          </div>
          <div class="history-item-details">
            <span class="history-date">⏰ ${date}</span>
            <span class="history-path">📂 ${escapeHtml(item.download_path)}</span>
          </div>
        </div>
      `;
    }).join("");
  } catch (error) {
    console.error("Failed to load history:", error);
  }
}

async function clearHistory() {
  if (!confirm("Are you sure you want to clear all download history?")) {
    return;
  }
  
  try {
    await invoke("clear_download_history");
    await loadHistory();
  } catch (error) {
    alert(`Failed to clear history: ${error}`);
  }
}

window.addEventListener("DOMContentLoaded", async () => {
  document.getElementById("fetch-manifest-btn")?.addEventListener("click", fetchManifest);
  document.getElementById("settings-btn")?.addEventListener("click", openSettings);
  document.getElementById("close-settings-btn")?.addEventListener("click", closeSettings);
  document.getElementById("save-settings-btn")?.addEventListener("click", saveSettings);
  document.getElementById("check-updates-btn")?.addEventListener("click", () => checkForUpdates());
  document.getElementById("history-btn")?.addEventListener("click", openHistory);
  document.getElementById("close-history-btn")?.addEventListener("click", closeHistory);
  document.getElementById("clear-history-btn")?.addEventListener("click", clearHistory);

  // Start auto-refresh
  refreshDownloads();
  refreshInterval = window.setInterval(refreshDownloads, 1000);
  
  // Check for scheduled downloads every minute
  window.setInterval(async () => {
    try {
      await invoke("check_scheduled_downloads");
    } catch (error) {
      console.error("Failed to check scheduled downloads:", error);
    }
  }, 60000);
  
  // Report progress to server every 5 seconds
  window.setInterval(async () => {
    try {
      const serverUrl = "https://www.armgddnbrowser.com";
      const authToken = localStorage.getItem('authToken') || null;
      await invoke("report_progress", { 
        serverUrl, 
        authToken 
      });
    } catch (error) {
      // Silently fail - don't spam console
    }
  }, 5000);

  // Make functions globally available
  (window as any).openSettings = openSettings;
  (window as any).closeSettings = closeSettings;
  (window as any).saveSettings = saveSettings;

  // Deep link support - listen for armgddn:// URLs from website
  setupDeepLinkHandler();
  
  // Check for updates on startup (silent check)
  checkForUpdates(true);
});

async function setupDeepLinkHandler() {
  try {
    // Dynamic import to handle plugin availability
    // @ts-ignore - Plugin loaded at runtime by Tauri
    const deepLinkModule = await import("@tauri-apps/plugin-deep-link");
    await deepLinkModule.onOpenUrl((urls: string[]) => {
      console.log("Deep link received:", urls);
      for (const url of urls) {
        handleDeepLink(url);
      }
    });
    console.log("Deep link handler registered successfully");
  } catch (error) {
    console.log("Deep link plugin not available - manual URL entry only");
  }
}

async function handleDeepLink(url: string) {
  console.log("Handling deep link:", url);
  
  // Parse armgddn://download?manifest=<url>
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "armgddn:" && parsed.hostname === "download") {
      const manifestUrl = parsed.searchParams.get("manifest");
      if (manifestUrl) {
        // Decode and set the manifest URL
        const decodedUrl = decodeURIComponent(manifestUrl);
        const input = document.getElementById("manifest-url") as HTMLInputElement;
        if (input) {
          input.value = decodedUrl;
        }
        
        // Auto-fetch the manifest
        await fetchManifest();
        console.log("📥 Download started from website link");
      }
    }
  } catch (error) {
    console.error("Failed to parse deep link:", error);
  }
}
