use anyhow::{Context, Result};
use futures::StreamExt;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::fs::OpenOptions;
use tokio::io::AsyncWriteExt;
use tokio::sync::{Mutex, RwLock};
use tokio::task::JoinHandle;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DownloadRequest {
    pub url: String,
    pub filename: String,
    pub size: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum DownloadState {
    Queued,
    Downloading,
    Paused,
    Completed,
    Failed,
    Cancelled,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DownloadStatus {
    pub id: String,
    pub filename: String,
    pub url: String,
    pub state: DownloadState,
    pub downloaded_bytes: u64,
    pub total_bytes: u64,
    pub speed_bps: u64,
    pub error: Option<String>,
}

struct DownloadTask {
    request: DownloadRequest,
    status: Arc<RwLock<DownloadStatus>>,
    cancel_tx: Option<tokio::sync::oneshot::Sender<()>>,
    task_handle: Option<JoinHandle<()>>,
}

pub struct DownloadManager {
    downloads: Arc<Mutex<HashMap<String, DownloadTask>>>,
    download_path: Arc<RwLock<PathBuf>>,
    max_concurrent: Arc<RwLock<usize>>,
    active_count: Arc<Mutex<usize>>,
    server_url: Arc<RwLock<String>>,
    auth_token: Arc<RwLock<Option<String>>>,
}

impl DownloadManager {
    pub fn new(download_path: PathBuf, max_concurrent: usize, server_url: String, auth_token: Option<String>) -> Self {
        Self {
            downloads: Arc::new(Mutex::new(HashMap::new())),
            download_path: Arc::new(RwLock::new(download_path)),
            max_concurrent: Arc::new(RwLock::new(max_concurrent)),
            active_count: Arc::new(Mutex::new(0)),
            server_url: Arc::new(RwLock::new(server_url)),
            auth_token: Arc::new(RwLock::new(auth_token)),
        }
    }

    pub async fn set_server_config(&mut self, server_url: String, auth_token: Option<String>) {
        *self.server_url.write().await = server_url;
        *self.auth_token.write().await = auth_token;
    }

    pub async fn add_download(&mut self, request: DownloadRequest) -> Result<String> {
        let id = uuid::Uuid::new_v4().to_string();
        
        let status = Arc::new(RwLock::new(DownloadStatus {
            id: id.clone(),
            filename: request.filename.clone(),
            url: request.url.clone(),
            state: DownloadState::Queued,
            downloaded_bytes: 0,
            total_bytes: request.size,
            speed_bps: 0,
            error: None,
        }));

        let task = DownloadTask {
            request,
            status,
            cancel_tx: None,
            task_handle: None,
        };

        let mut downloads = self.downloads.lock().await;
        downloads.insert(id.clone(), task);

        Ok(id)
    }

    pub async fn start_download(&mut self, download_id: &str) -> Result<()> {
        let mut downloads = self.downloads.lock().await;
        
        let task = downloads
            .get_mut(download_id)
            .context("Download not found")?;

        // Check if already downloading
        let current_state = task.status.read().await.state.clone();
        if current_state == DownloadState::Downloading {
            return Ok(());
        }

        // Check disk space before starting
        let required_space = task.request.size;
        if let Err(e) = Self::check_disk_space(&self.download_path.read().await, required_space).await {
            let mut status = task.status.write().await;
            status.state = DownloadState::Failed;
            status.error = Some(format!("Insufficient disk space: {}", e));
            return Err(e);
        }

        // Update state to downloading
        {
            let mut status = task.status.write().await;
            status.state = DownloadState::Downloading;
        }

        // Create cancellation channel
        let (cancel_tx, cancel_rx) = tokio::sync::oneshot::channel();
        task.cancel_tx = Some(cancel_tx);

        // Clone necessary data for the download task
        let url = task.request.url.clone();
        let filename = task.request.filename.clone();
        let status = task.status.clone();
        let download_path = self.download_path.read().await.clone();
        let active_count = self.active_count.clone();

        // Spawn download task
        let handle = tokio::spawn(async move {
            // Increment active count
            {
                let mut count = active_count.lock().await;
                *count += 1;
            }

            let result = Self::download_file(
                url,
                download_path.join(&filename),
                status.clone(),
                cancel_rx,
            )
            .await;

            // Update final state
            let mut status_write = status.write().await;
            match result {
                Ok(_) => {
                    status_write.state = DownloadState::Completed;
                }
                Err(e) => {
                    if status_write.state != DownloadState::Cancelled {
                        status_write.state = DownloadState::Failed;
                        status_write.error = Some(e.to_string());
                    }
                }
            }

            // Decrement active count
            {
                let mut count = active_count.lock().await;
                *count -= 1;
            }
        });

        task.task_handle = Some(handle);

        Ok(())
    }

    async fn download_file(
        url: String,
        file_path: PathBuf,
        status: Arc<RwLock<DownloadStatus>>,
        cancel_rx: tokio::sync::oneshot::Receiver<()>,
    ) -> Result<()> {
        const MAX_RETRIES: u32 = 3;
        const RETRY_DELAY_MS: u64 = 2000;
        
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(300))
            .build()?;

        let mut retry_count = 0;
        
        loop {
            // Check if file exists and get current size for resume support
            let start_pos = if file_path.exists() {
                tokio::fs::metadata(&file_path).await?.len()
            } else {
                0
            };

            // Update downloaded bytes if resuming
            if start_pos > 0 {
                let mut status_write = status.write().await;
                status_write.downloaded_bytes = start_pos;
            }

            // Build request with Range header for resume support
            let mut request = client.get(&url);
            if start_pos > 0 {
                request = request.header("Range", format!("bytes={}-", start_pos));
            }

            let response = match request.send().await {
                Ok(resp) => resp,
                Err(e) => {
                    if retry_count < MAX_RETRIES {
                        retry_count += 1;
                        eprintln!("Download failed (attempt {}/{}): {}. Retrying in {}ms...", 
                                  retry_count, MAX_RETRIES, e, RETRY_DELAY_MS);
                        tokio::time::sleep(std::time::Duration::from_millis(RETRY_DELAY_MS)).await;
                        continue;
                    } else {
                        let error_msg = Self::format_network_error(&e);
                        return Err(anyhow::anyhow!(error_msg));
                    }
                }
            };
            
            if !response.status().is_success() && response.status() != reqwest::StatusCode::PARTIAL_CONTENT {
                if retry_count < MAX_RETRIES {
                    retry_count += 1;
                    eprintln!("Server returned error {} (attempt {}/{}). Retrying in {}ms...", 
                              response.status(), retry_count, MAX_RETRIES, RETRY_DELAY_MS);
                    tokio::time::sleep(std::time::Duration::from_millis(RETRY_DELAY_MS)).await;
                    continue;
                } else {
                    let error_msg = Self::format_http_error(response.status());
                    anyhow::bail!(error_msg);
                }
            }
            
            // Download succeeded, break out of retry loop
            return Self::download_stream(response, file_path, status, start_pos, cancel_rx).await;
        }
    }
    
    async fn download_stream(
        response: reqwest::Response,
        file_path: PathBuf,
        status: Arc<RwLock<DownloadStatus>>,
        start_pos: u64,
        mut cancel_rx: tokio::sync::oneshot::Receiver<()>,
    ) -> Result<()> {

        // Open file for appending
        let mut file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&file_path)
            .await?;

        let mut stream = response.bytes_stream();
        let mut downloaded = start_pos;
        let start_time = std::time::Instant::now();
        let mut last_update = std::time::Instant::now();

        while let Some(chunk_result) = tokio::select! {
            chunk = stream.next() => chunk,
            _ = &mut cancel_rx => None,
        } {
            let chunk = chunk_result?;
            file.write_all(&chunk).await?;
            downloaded += chunk.len() as u64;

            // Update status every 100ms
            if last_update.elapsed().as_millis() >= 100 {
                let elapsed_secs = start_time.elapsed().as_secs_f64();
                let speed = if elapsed_secs > 0.0 {
                    ((downloaded - start_pos) as f64 / elapsed_secs) as u64
                } else {
                    0
                };

                let mut status_write = status.write().await;
                status_write.downloaded_bytes = downloaded;
                status_write.speed_bps = speed;
                
                last_update = std::time::Instant::now();
            }
        }

        file.flush().await?;

        Ok(())
    }

    pub async fn pause_download(&mut self, download_id: &str) -> Result<()> {
        let mut downloads = self.downloads.lock().await;
        
        let task = downloads
            .get_mut(download_id)
            .context("Download not found")?;

        // Send cancellation signal
        if let Some(cancel_tx) = task.cancel_tx.take() {
            let _ = cancel_tx.send(());
        }

        // Wait for task to complete
        if let Some(handle) = task.task_handle.take() {
            let _ = handle.await;
        }

        // Update state
        let mut status = task.status.write().await;
        if status.state == DownloadState::Downloading {
            status.state = DownloadState::Paused;
        }

        Ok(())
    }

    pub async fn resume_download(&mut self, download_id: &str) -> Result<()> {
        self.start_download(download_id).await
    }

    pub async fn cancel_download(&mut self, download_id: &str) -> Result<()> {
        let mut downloads = self.downloads.lock().await;
        
        let task = downloads
            .get_mut(download_id)
            .context("Download not found")?;

        // Update state first
        {
            let mut status = task.status.write().await;
            status.state = DownloadState::Cancelled;
        }

        // Send cancellation signal
        if let Some(cancel_tx) = task.cancel_tx.take() {
            let _ = cancel_tx.send(());
        }

        // Wait for task to complete
        if let Some(handle) = task.task_handle.take() {
            let _ = handle.await;
        }

        Ok(())
    }

    pub async fn retry_download(&mut self, download_id: &str) -> Result<()> {
        let downloads = self.downloads.lock().await;
        
        let task = downloads
            .get(download_id)
            .context("Download not found")?;

        // Check if download is in a failed state
        let current_state = task.status.read().await.state.clone();
        if current_state != DownloadState::Failed {
            anyhow::bail!("Download is not in a failed state");
        }

        // Reset error and downloaded bytes
        {
            let mut status = task.status.write().await;
            status.error = None;
            status.downloaded_bytes = 0;
        }

        drop(downloads);

        // Start the download again
        self.start_download(download_id).await
    }

    pub async fn get_all_downloads(&self) -> Vec<DownloadStatus> {
        let downloads = self.downloads.lock().await;
        let mut statuses = Vec::new();

        for task in downloads.values() {
            let status = task.status.read().await;
            statuses.push(status.clone());
        }

        statuses
    }

    pub async fn set_max_concurrent(&mut self, count: usize) {
        let mut max = self.max_concurrent.write().await;
        *max = count;
    }

    async fn check_disk_space(download_path: &std::path::Path, required_bytes: u64) -> Result<()> {
        // Add 100MB buffer for safety
        let required_with_buffer = required_bytes + (100 * 1024 * 1024);
        
        match sys_info::disk_info() {
            Ok(disk) => {
                let available_bytes = disk.free * 1024; // Convert KB to bytes
                if available_bytes < required_with_buffer {
                    let required_mb = required_with_buffer / (1024 * 1024);
                    let available_mb = available_bytes / (1024 * 1024);
                    anyhow::bail!(
                        "Insufficient disk space: Need {} MB but only {} MB available. Please free up space and try again.",
                        required_mb,
                        available_mb
                    );
                }
                Ok(())
            }
            Err(e) => {
                // If we can't check disk space, log warning but allow download
                eprintln!("Warning: Could not check disk space: {}", e);
                Ok(())
            }
        }
    }

    fn format_network_error(error: &reqwest::Error) -> String {
        if error.is_timeout() {
            "Connection timed out. Check your internet connection and try again.".to_string()
        } else if error.is_connect() {
            "Could not connect to server. Check your internet connection and try again.".to_string()
        } else if error.is_request() {
            "Network request failed. Check your internet connection and try again.".to_string()
        } else {
            format!("Network error: {}. Check your connection and try again.", error)
        }
    }

    fn format_http_error(status: reqwest::StatusCode) -> String {
        match status.as_u16() {
            401 | 403 => "Authentication failed. Check your auth token in settings.".to_string(),
            404 => "File not found on server. The download link may have expired.".to_string(),
            429 => "Too many requests. Please wait a moment and try again.".to_string(),
            500..=599 => "Server error. Please try again later.".to_string(),
            _ => format!("Server returned error {}. Please try again.", status),
        }
    }
}
