# ARMGDDN Downloader

Production-ready external downloader app for ARMGDDN Browser that handles rclone processing on the user's machine.

## Features

- 📥 **Manifest-based downloads**: Fetch download manifests from ARMGDDN Browser
- ⏸️ **Pause/Resume support**: HTTP Range requests for reliable downloads
- 📊 **Progress tracking**: Real-time download speed and progress
- 📦 **Queue management**: Configurable concurrent downloads
- 🔒 **Secure**: Token-based authentication, no sensitive data exposed
- 💾 **Cross-platform**: Windows and Linux support

## How It Works

1. User navigates to a game/folder in ARMGDDN Browser
2. Browser generates a signed manifest with download URLs
3. User copies manifest URL to this app
4. App fetches manifest and queues all files
5. Downloads happen on user's machine with pause/resume support
6. **Server load is eliminated** - no rclone processes on server

## Development

### Prerequisites

- Node.js 18+
- Rust 1.70+
- Platform-specific dependencies:
  - **Linux**: `webkit2gtk-4.1`, `libayatana-appindicator3-dev`
  - **Windows**: No additional dependencies

### Build

```bash
# Install dependencies
npm install

# Development mode
npm run tauri dev

# Production build
npm run tauri build
```

## Usage

### For Users

1. Download and install the app for your platform
2. Open the app
3. Configure settings:
   - Set download location
   - Set max concurrent downloads (default: 3)
   - Add authentication token (if required)
4. In ARMGDDN Browser, navigate to a game/folder
5. Click "Download with External App" (or similar)
6. Copy the manifest URL
7. Paste into the app and click "Fetch & Add Downloads"
8. Downloads start automatically with pause/resume support

### Configuration

Settings are stored in:
- **Linux**: `~/.config/armgddn-downloader/config.json`
- **Windows**: `%APPDATA%\armgddn-downloader\config.json`

```json
{
  "download_path": "/path/to/downloads",
  "auth_token": "your-token-here",
  "max_concurrent_downloads": 3,
  "server_url": "https://www.armgddnbrowser.com"
}
```

## Architecture

### Backend (Rust)

- **`download_manager.rs`**: Core download logic with pause/resume
- **`state.rs`**: App state and configuration management
- **`rclone.rs`**: Placeholder for future rclone integration
- **`lib.rs`**: Tauri command handlers

### Frontend (TypeScript)

- **`main.ts`**: UI logic and Tauri API calls
- **`index.html`**: App structure
- **`styles.css`**: Modern dark theme

## Server Integration

The app expects manifests from `/api/download-manifest` endpoint:

```json
{
  "success": true,
  "remote": "PC Games",
  "path": "GameName",
  "totalFiles": 10,
  "files": [
    {
      "name": "file1.zip",
      "path": "GameName/file1.zip",
      "size": 1073741824,
      "url": "https://server.com/api/download-file?remote=PC-1&file=...&jd2=token"
    }
  ]
}
```

## Building for Distribution

### Windows

```bash
npm run tauri build -- --target x86_64-pc-windows-msvc
```

Outputs:
- `.exe` installer in `src-tauri/target/release/bundle/nsis/`
- Portable `.exe` in `src-tauri/target/release/`

### Linux

```bash
npm run tauri build -- --target x86_64-unknown-linux-gnu
```

Outputs:
- `.deb` package in `src-tauri/target/release/bundle/deb/`
- `.AppImage` in `src-tauri/target/release/bundle/appimage/`

## Future Enhancements

- [ ] Native rclone integration for advanced features
- [ ] Auto-update mechanism
- [ ] Download scheduling
- [ ] Bandwidth limiting
- [ ] System tray integration
- [ ] macOS support

## License

Proprietary - ARMGDDN Browser
