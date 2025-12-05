mod download_manager;
mod rclone;
mod state;

use download_manager::{DownloadRequest, DownloadStatus};
use state::AppState;
use std::sync::Arc;
use tauri::Manager;
use tokio::sync::Mutex;
use tauri_plugin_notification::NotificationExt;

// Helper to report progress to server (reserved for future use)
#[allow(dead_code)]
async fn report_progress_to_server(
    server_url: &str,
    auth_token: Option<&str>,
    download_id: &str,
    file_name: &str,
    bytes_downloaded: u64,
    total_bytes: u64,
    status: &str,
    error: Option<&str>,
) {
    let client = reqwest::Client::new();
    let url = format!("{}/api/app-progress", server_url);
    
    let mut req = client.post(&url).json(&serde_json::json!({
        "downloadId": download_id,
        "fileName": file_name,
        "bytesDownloaded": bytes_downloaded,
        "totalBytes": total_bytes,
        "status": status,
        "error": error
    }));
    
    if let Some(token) = auth_token {
        req = req.header("Authorization", format!("Bearer {}", token));
    }
    
    // Fire and forget - don't block on response
    let _ = req.send().await;
}

#[tauri::command]
async fn fetch_manifest(
    url: String,
    state: tauri::State<'_, Arc<Mutex<AppState>>>,
) -> Result<serde_json::Value, String> {
    let client = reqwest::Client::new();
    
    // Get auth token from state
    let token = {
        let app_state = state.lock().await;
        app_state.auth_token.clone()
    };
    
    let mut req = client.post(&url);
    
    if let Some(token) = token {
        req = req.header("Authorization", format!("Bearer {}", token));
    }
    
    let response = req
        .send()
        .await
        .map_err(|e| format!("Failed to fetch manifest: {}", e))?;
    
    if !response.status().is_success() {
        return Err(format!("Server returned error: {}", response.status()));
    }
    
    let manifest = response
        .json::<serde_json::Value>()
        .await
        .map_err(|e| format!("Failed to parse manifest: {}", e))?;
    
    Ok(manifest)
}

#[tauri::command]
async fn add_download(
    url: String,
    filename: String,
    size: u64,
    state: tauri::State<'_, Arc<Mutex<AppState>>>,
) -> Result<String, String> {
    let mut app_state = state.lock().await;
    
    let request = DownloadRequest {
        url,
        filename,
        size,
        scheduled_start: None,
        category: None,
    };
    
    let download_id = app_state.download_manager.add_download(request).await
        .map_err(|e| format!("Failed to add download: {}", e))?;
    
    Ok(download_id)
}

#[tauri::command]
async fn start_download(
    download_id: String,
    state: tauri::State<'_, Arc<Mutex<AppState>>>,
) -> Result<(), String> {
    let mut app_state = state.lock().await;
    
    app_state.download_manager.start_download(&download_id).await
        .map_err(|e| format!("Failed to start download: {}", e))?;
    
    Ok(())
}

#[tauri::command]
async fn pause_download(
    download_id: String,
    state: tauri::State<'_, Arc<Mutex<AppState>>>,
) -> Result<(), String> {
    let mut app_state = state.lock().await;
    
    app_state.download_manager.pause_download(&download_id).await
        .map_err(|e| format!("Failed to pause download: {}", e))?;
    
    Ok(())
}

#[tauri::command]
async fn resume_download(
    download_id: String,
    state: tauri::State<'_, Arc<Mutex<AppState>>>,
) -> Result<(), String> {
    let mut app_state = state.lock().await;
    
    app_state.download_manager.resume_download(&download_id).await
        .map_err(|e| format!("Failed to resume download: {}", e))?;
    
    Ok(())
}

#[tauri::command]
async fn cancel_download(
    download_id: String,
    state: tauri::State<'_, Arc<Mutex<AppState>>>,
) -> Result<(), String> {
    let mut app_state = state.lock().await;
    
    app_state.download_manager.cancel_download(&download_id).await
        .map_err(|e| format!("Failed to cancel download: {}", e))?;
    
    Ok(())
}

#[tauri::command]
async fn retry_download(
    download_id: String,
    state: tauri::State<'_, Arc<Mutex<AppState>>>,
) -> Result<(), String> {
    let mut app_state = state.lock().await;
    
    app_state.download_manager.retry_download(&download_id).await
        .map_err(|e| format!("Failed to retry download: {}", e))?;
    
    Ok(())
}

#[tauri::command]
async fn get_downloads(
    state: tauri::State<'_, Arc<Mutex<AppState>>>,
) -> Result<Vec<DownloadStatus>, String> {
    let app_state = state.lock().await;
    Ok(app_state.download_manager.get_all_downloads().await)
}

#[tauri::command]
async fn set_download_path(
    path: String,
    state: tauri::State<'_, Arc<Mutex<AppState>>>,
) -> Result<(), String> {
    let mut app_state = state.lock().await;
    app_state.download_path = path;
    app_state.save_config().map_err(|e| format!("Failed to save config: {}", e))?;
    Ok(())
}

#[tauri::command]
async fn get_download_path(
    state: tauri::State<'_, Arc<Mutex<AppState>>>,
) -> Result<String, String> {
    let app_state = state.lock().await;
    Ok(app_state.download_path.clone())
}

#[tauri::command]
async fn set_auth_token(
    token: String,
    state: tauri::State<'_, Arc<Mutex<AppState>>>,
) -> Result<(), String> {
    let mut app_state = state.lock().await;
    app_state.auth_token = Some(token);
    app_state.save_config().map_err(|e| format!("Failed to save config: {}", e))?;
    Ok(())
}

#[tauri::command]
async fn set_concurrent_downloads(
    count: usize,
    state: tauri::State<'_, Arc<Mutex<AppState>>>,
) -> Result<(), String> {
    let mut app_state = state.lock().await;
    app_state.download_manager.set_max_concurrent(count).await;
    app_state.max_concurrent_downloads = count;
    app_state.save_config().map_err(|e| format!("Failed to save config: {}", e))?;
    Ok(())
}

#[tauri::command]
fn send_notification(title: String, body: String, app: tauri::AppHandle) -> Result<(), String> {
    app.notification()
        .builder()
        .title(title)
        .body(body)
        .show()
        .map_err(|e| format!("Failed to send notification: {}", e))?;
    Ok(())
}

#[tauri::command]
async fn get_download_history(
    state: tauri::State<'_, Arc<Mutex<AppState>>>,
) -> Result<Vec<crate::state::DownloadHistoryItem>, String> {
    let app_state = state.lock().await;
    Ok(app_state.download_history.clone())
}

#[tauri::command]
async fn add_to_history(
    filename: String,
    size: u64,
    download_path: String,
    state: tauri::State<'_, Arc<Mutex<AppState>>>,
) -> Result<(), String> {
    let mut app_state = state.lock().await;
    let item = crate::state::DownloadHistoryItem {
        filename,
        size,
        completed_at: chrono::Utc::now().to_rfc3339(),
        download_path,
    };
    app_state.download_history.push(item);
    app_state.save_config().map_err(|e| format!("Failed to save history: {}", e))?;
    Ok(())
}

#[tauri::command]
async fn clear_download_history(
    state: tauri::State<'_, Arc<Mutex<AppState>>>,
) -> Result<(), String> {
    let mut app_state = state.lock().await;
    app_state.download_history.clear();
    app_state.save_config().map_err(|e| format!("Failed to clear history: {}", e))?;
    Ok(())
}

#[tauri::command]
async fn check_scheduled_downloads(
    state: tauri::State<'_, Arc<Mutex<AppState>>>,
) -> Result<Vec<String>, String> {
    let mut app_state = state.lock().await;
    app_state.download_manager.check_scheduled_downloads().await
        .map_err(|e| format!("Failed to check scheduled downloads: {}", e))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            // Setup system tray
            let tray = app.tray_by_id("main").expect("Failed to get tray");
            tray.on_menu_event(|app, event| {
                match event.id().as_ref() {
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    "quit" => {
                        app.exit(0);
                    }
                    _ => {}
                }
            });

            // Handle window close event - hide to tray instead of closing
            if let Some(window) = app.get_webview_window("main") {
                let window_clone = window.clone();
                window.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        // Prevent the window from closing
                        api.prevent_close();
                        // Hide the window instead
                        let _ = window_clone.hide();
                    }
                });
            }

            let app_state = Arc::new(Mutex::new(AppState::load_or_default()));
            
            // Auto-fetch rclone config on first run if not already present
            let state_clone = app_state.clone();
            tauri::async_runtime::spawn(async move {
                let rclone_manager = match crate::rclone::RcloneManager::new() {
                    Ok(mgr) => mgr,
                    Err(e) => {
                        eprintln!("Failed to initialize rclone manager: {}", e);
                        return;
                    }
                };
                
                // Only fetch if config doesn't exist
                if !rclone_manager.config_exists() {
                    println!("Rclone config not found, fetching from server...");
                    
                    let state = state_clone.lock().await;
                    let server_url = state.server_url.clone();
                    let auth_token = state.auth_token.clone();
                    drop(state);
                    
                    // Fetch encrypted config from server
                    let client = reqwest::Client::new();
                    let url = format!("{}/api/rclone-config", server_url);
                    
                    let mut req = client.get(&url);
                    if let Some(token) = auth_token {
                        req = req.header("Authorization", format!("Bearer {}", token));
                    }
                    
                    match req.send().await {
                        Ok(response) if response.status().is_success() => {
                            match response.json::<serde_json::Value>().await {
                                Ok(data) => {
                                    if let Some(encrypted_config) = data.get("encryptedConfig").and_then(|v| v.as_str()) {
                                        let encryption_key = AppState::get_encryption_key();
                                        
                                        match rclone_manager.fetch_and_save_config(encrypted_config, encryption_key).await {
                                            Ok(_) => println!("✅ Rclone config fetched and decrypted successfully"),
                                            Err(e) => eprintln!("Failed to decrypt config: {}", e),
                                        }
                                    }
                                }
                                Err(e) => eprintln!("Failed to parse config response: {}", e),
                            }
                        }
                        Ok(response) => eprintln!("Server returned error: {}", response.status()),
                        Err(e) => eprintln!("Failed to fetch config: {}", e),
                    }
                }
            });
            
            app.manage(app_state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            fetch_manifest,
            add_download,
            start_download,
            pause_download,
            resume_download,
            cancel_download,
            retry_download,
            get_downloads,
            set_download_path,
            get_download_path,
            set_auth_token,
            set_concurrent_downloads,
            send_notification,
            get_download_history,
            add_to_history,
            clear_download_history,
            check_scheduled_downloads,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
