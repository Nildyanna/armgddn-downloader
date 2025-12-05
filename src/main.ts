import { invoke } from "@tauri-apps/api/core";

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

async function refreshDownloads() {
  try {
    downloads = await invoke("get_downloads");
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
      } else if (download.state === "paused") {
        actionButtons = `<button onclick="resumeDownload('${download.id}')">▶ Resume</button>`;
      } else if (download.state === "queued") {
        actionButtons = `<button onclick="startDownload('${download.id}')">▶ Start</button>`;
      }
      
      if (download.state !== "completed" && download.state !== "cancelled") {
        actionButtons += ` <button onclick="cancelDownload('${download.id}')">✕ Cancel</button>`;
      }

      return `
        <div class="download-item ${download.state}">
          <div class="download-header">
            <div class="download-filename">${escapeHtml(download.filename)}</div>
            <div class="download-state">${download.state}</div>
          </div>
          <div class="progress-bar">
            <div class="progress-fill" style="width: ${progress}%"></div>
          </div>
          <div class="download-info">
            <span>${downloadedMB} MB / ${totalMB} MB</span>
            ${download.state === "downloading" ? `<span>${speedMBps} MB/s</span>` : ""}
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

async function openSettings() {
  const settingsPanel = document.getElementById("settings-panel");
  if (settingsPanel) {
    settingsPanel.style.display = "block";
    
    // Load current settings
    try {
      const downloadPath = await invoke("get_download_path");
      const pathInput = document.getElementById("download-path") as HTMLInputElement;
      if (pathInput) pathInput.value = downloadPath as string;
    } catch (error) {
      console.error("Failed to load settings:", error);
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
    
    alert("Settings saved successfully");
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

window.addEventListener("DOMContentLoaded", async () => {
  document.getElementById("fetch-manifest-btn")?.addEventListener("click", fetchManifest);
  document.getElementById("settings-btn")?.addEventListener("click", openSettings);
  document.getElementById("close-settings-btn")?.addEventListener("click", closeSettings);
  document.getElementById("save-settings-btn")?.addEventListener("click", saveSettings);
  document.getElementById("check-updates-btn")?.addEventListener("click", () => checkForUpdates());

  // Start auto-refresh
  refreshDownloads();
  refreshInterval = window.setInterval(refreshDownloads, 1000);

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
