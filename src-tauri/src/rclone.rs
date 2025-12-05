use aes_gcm::{
    aead::{Aead, KeyInit, OsRng},
    Aes256Gcm, Nonce,
};
use anyhow::{Context, Result};
use rand::RngCore;
use base64::{engine::general_purpose, Engine as _};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

pub struct RcloneManager {
    config_path: PathBuf,
    rclone_binary: PathBuf,
}

impl RcloneManager {
    pub fn new() -> Result<Self> {
        let config_dir = dirs::config_dir()
            .context("Failed to get config directory")?;
        let app_config_dir = config_dir.join("armgddn-downloader");
        std::fs::create_dir_all(&app_config_dir)?;
        
        let config_path = app_config_dir.join("rclone.conf");
        let rclone_binary = Self::get_rclone_binary_path()?;
        
        Ok(Self {
            config_path,
            rclone_binary,
        })
    }

    fn get_rclone_binary_path() -> Result<PathBuf> {
        // Check if rclone is bundled with the app
        let exe_dir = std::env::current_exe()?
            .parent()
            .context("Failed to get executable directory")?
            .to_path_buf();
        
        #[cfg(target_os = "windows")]
        let bundled_rclone = exe_dir.join("rclone.exe");
        
        #[cfg(not(target_os = "windows"))]
        let bundled_rclone = exe_dir.join("rclone");
        
        if bundled_rclone.exists() {
            return Ok(bundled_rclone);
        }
        
        // Fall back to system rclone
        #[cfg(target_os = "windows")]
        return Ok(PathBuf::from("rclone.exe"));
        
        #[cfg(not(target_os = "windows"))]
        return Ok(PathBuf::from("rclone"));
    }

    pub async fn fetch_and_save_config(
        &self,
        encrypted_config: &str,
        encryption_key: &str,
    ) -> Result<()> {
        let decrypted_config = self.decrypt_config(encrypted_config, encryption_key)?;
        tokio::fs::write(&self.config_path, decrypted_config).await?;
        Ok(())
    }

    fn decrypt_config(&self, encrypted_base64: &str, key: &str) -> Result<String> {
        // Derive 256-bit key from password using SHA-256
        let mut hasher = Sha256::new();
        hasher.update(key.as_bytes());
        let key_bytes = hasher.finalize();

        // Decode base64
        let encrypted_data = general_purpose::STANDARD
            .decode(encrypted_base64)
            .context("Failed to decode base64")?;

        // First 12 bytes are nonce, rest is ciphertext
        if encrypted_data.len() < 12 {
            anyhow::bail!("Invalid encrypted data: too short");
        }

        let (nonce_bytes, ciphertext) = encrypted_data.split_at(12);
        let nonce = Nonce::from_slice(nonce_bytes);

        // Decrypt
        let cipher = Aes256Gcm::new_from_slice(&key_bytes)
            .context("Failed to create cipher")?;
        
        let plaintext = cipher
            .decrypt(nonce, ciphertext)
            .map_err(|_| anyhow::anyhow!("Decryption failed - invalid key or corrupted data"))?;

        String::from_utf8(plaintext).context("Decrypted data is not valid UTF-8")
    }

    pub async fn download_file(
        &self,
        remote: &str,
        remote_path: &str,
        local_path: &Path,
        progress_callback: impl Fn(u64, u64) + Send + 'static,
    ) -> Result<()> {
        let remote_full_path = format!("{}:{}", remote, remote_path);
        
        let mut child = Command::new(&self.rclone_binary)
            .arg("copyto")
            .arg("--config")
            .arg(&self.config_path)
            .arg("--progress")
            .arg("--stats")
            .arg("1s")
            .arg(&remote_full_path)
            .arg(local_path)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .context("Failed to spawn rclone process")?;

        // Read progress from stderr
        if let Some(stderr) = child.stderr.take() {
            let reader = BufReader::new(stderr);
            let mut lines = reader.lines();
            
            tokio::spawn(async move {
                while let Ok(Some(line)) = lines.next_line().await {
                    // Parse rclone progress output
                    // Format: "Transferred:   10.5 MiB / 100 MiB, 10%, 5 MiB/s, ETA 18s"
                    if line.contains("Transferred:") {
                        if let Some(progress) = Self::parse_progress(&line) {
                            progress_callback(progress.0, progress.1);
                        }
                    }
                }
            });
        }

        let status = child.wait().await?;
        
        if !status.success() {
            anyhow::bail!("rclone process failed with status: {}", status);
        }

        Ok(())
    }

    fn parse_progress(line: &str) -> Option<(u64, u64)> {
        // Parse "Transferred:   10.5 MiB / 100 MiB, 10%, 5 MiB/s, ETA 18s"
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() < 5 {
            return None;
        }

        // Find the transferred and total values
        let mut transferred = 0u64;
        let mut total = 0u64;

        for i in 0..parts.len() {
            if parts[i] == "/" && i > 0 && i < parts.len() - 1 {
                transferred = Self::parse_size(parts[i - 1])?;
                total = Self::parse_size(parts[i + 1].trim_end_matches(','))?;
                break;
            }
        }

        Some((transferred, total))
    }

    fn parse_size(s: &str) -> Option<u64> {
        let s = s.trim();
        let (num_str, unit) = if s.ends_with("GiB") {
            (&s[..s.len() - 3], 1024 * 1024 * 1024)
        } else if s.ends_with("MiB") {
            (&s[..s.len() - 3], 1024 * 1024)
        } else if s.ends_with("KiB") {
            (&s[..s.len() - 3], 1024)
        } else if s.ends_with("B") {
            (&s[..s.len() - 1], 1)
        } else {
            return None;
        };

        let num: f64 = num_str.parse().ok()?;
        Some((num * unit as f64) as u64)
    }

    pub fn config_exists(&self) -> bool {
        self.config_path.exists()
    }

    pub async fn test_config(&self) -> Result<bool> {
        let output = Command::new(&self.rclone_binary)
            .arg("listremotes")
            .arg("--config")
            .arg(&self.config_path)
            .output()
            .await?;

        Ok(output.status.success())
    }
}
