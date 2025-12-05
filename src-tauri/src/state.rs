use crate::download_manager::DownloadManager;
use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

// Hardcoded encryption key for rclone config
// This is intentionally embedded in the app for ease of use
const RCLONE_ENCRYPTION_KEY: &str = "armgddn-secure-key-2025";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DownloadHistoryItem {
    pub filename: String,
    pub size: u64,
    pub completed_at: String,
    pub download_path: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AppConfig {
    pub download_path: String,
    pub auth_token: Option<String>,
    pub max_concurrent_downloads: usize,
    pub server_url: String,
    #[serde(default)]
    pub download_history: Vec<DownloadHistoryItem>,
}

impl Default for AppConfig {
    fn default() -> Self {
        let download_path = dirs::download_dir()
            .unwrap_or_else(|| dirs::home_dir().unwrap_or_else(|| PathBuf::from(".")))
            .join("ArmgddnDownloads")
            .to_string_lossy()
            .to_string();

        Self {
            download_path,
            auth_token: None,
            max_concurrent_downloads: 3,
            server_url: "https://www.armgddnbrowser.com".to_string(),
            download_history: Vec::new(),
        }
    }
}

pub struct AppState {
    pub download_manager: DownloadManager,
    pub download_path: String,
    pub auth_token: Option<String>,
    pub max_concurrent_downloads: usize,
    pub server_url: String,
    pub download_history: Vec<DownloadHistoryItem>,
}

impl AppState {
    pub fn get_encryption_key() -> &'static str {
        RCLONE_ENCRYPTION_KEY
    }
}

impl AppState {
    pub fn load_or_default() -> Self {
        let config = Self::load_config().unwrap_or_default();
        
        // Ensure download directory exists
        let download_path = PathBuf::from(&config.download_path);
        if !download_path.exists() {
            let _ = std::fs::create_dir_all(&download_path);
        }

        let download_manager = DownloadManager::new(
            download_path.clone(),
            config.max_concurrent_downloads,
            config.server_url.clone(),
            config.auth_token.clone(),
        );

        Self {
            download_manager,
            download_path: config.download_path.clone(),
            auth_token: config.auth_token.clone(),
            max_concurrent_downloads: config.max_concurrent_downloads,
            server_url: config.server_url.clone(),
            download_history: config.download_history,
        }
    }

    fn config_path() -> PathBuf {
        dirs::config_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join("armgddn-downloader")
            .join("config.json")
    }

    fn load_config() -> Result<AppConfig> {
        let path = Self::config_path();
        let content = std::fs::read_to_string(path)?;
        let config = serde_json::from_str(&content)?;
        Ok(config)
    }

    pub fn save_config(&self) -> Result<()> {
        let config = AppConfig {
            download_path: self.download_path.clone(),
            auth_token: self.auth_token.clone(),
            max_concurrent_downloads: self.max_concurrent_downloads,
            server_url: self.server_url.clone(),
            download_history: self.download_history.clone(),
        };

        let path = Self::config_path();
        
        // Ensure parent directory exists
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }

        let content = serde_json::to_string_pretty(&config)?;
        std::fs::write(path, content)?;
        
        Ok(())
    }
}
