# ARMGDDN Downloader

Production-ready external downloader app for ARMGDDN Browser that handles downloads on the user's machine using rclone.

## Features

- 🔗 **Deep Link Integration**: One-click downloads from website via `armgddn://` protocol
- 📥 **Manifest-based downloads**: Fetch download manifests from ARMGDDN Browser
- 🔐 **Encrypted rclone config**: Automatically fetches and decrypts rclone configuration
- ⏸️ **Pause/Resume support**: HTTP Range requests with auto-retry (3 attempts)
- 📊 **Progress tracking**: Real-time download speed and progress
- 📦 **Queue management**: Configurable concurrent downloads (default: 3)
- 🔒 **Secure**: Token-based authentication, encrypted config, no sensitive data exposed
- 💾 **Cross-platform**: Windows and Linux support with bundled rclone binaries

## How It Works

1. User navigates to a game/folder in ARMGDDN Browser
2. User clicks "Download with App" button on website
3. Website triggers `armgddn://download?manifest=<url>` deep link
4. App automatically opens and fetches the manifest
5. App downloads encrypted rclone config from server (first run)
6. Downloads start automatically using rclone remotes
7. All downloads happen on user's machine with pause/resume and auto-retry
8. **Server load is eliminated** - no rclone processes or bandwidth usage on server

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

1. Download and install the app for your platform from GitHub Releases
2. Open the app (rclone config is fetched automatically on first run)
3. Configure settings:
   - Set download location
   - Set max concurrent downloads (default: 3)
   - Add authentication token (if required by your server)
4. In ARMGDDN Browser website, navigate to a game/folder
5. Click "Download with App" button
6. App opens automatically via deep link and starts downloading
7. All downloads include auto-retry (3 attempts) and resume support

**Alternative**:

Manually paste manifest URL into the app if deep links don't work.

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

- **`download_manager.rs`**: Core download logic with pause/resume and auto-retry
- **`state.rs`**: App state, configuration management, and hardcoded encryption key
- **`rclone.rs`**: Rclone config decryption (AES-256-GCM) and binary management
- **`lib.rs`**: Tauri command handlers and deep-link plugin initialization

### Frontend (TypeScript)

- **`main.ts`**: UI logic, Tauri API calls, and deep-link handler
- **`index.html`**: App structure
- **`styles.css`**: Modern dark theme
- **`vite.config.ts`**: Build config with deep-link plugin externalization

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

### GitHub Actions (Recommended)

Builds are automated via GitHub Actions:

1. **Tagged Release**:

   ```bash
   git tag v1.0.0
   git push origin v1.0.0
   ```

   This automatically builds both platforms and creates a GitHub Release.

2. **Manual Trigger**:

   - Go to Actions tab on GitHub
   - Select "Build ARMGDDN Downloader"
   - Click "Run workflow"

### Local Build

**Windows**:

```bash
npm run tauri build
```

Outputs: `.exe` installer in `src-tauri/target/release/bundle/nsis/`

**Linux**:

```bash
npm run tauri build
```

Outputs:

- `.deb` package in `src-tauri/target/release/bundle/deb/`
- `.AppImage` in `src-tauri/target/release/bundle/appimage/`

**Note**: Rclone binaries are downloaded automatically during GitHub Actions builds.

## Completed Features

- [x] Native rclone integration with encrypted config
- [x] Deep link protocol handler (`armgddn://`)
- [x] Auto-retry with resume support
- [x] Bundled rclone binaries for all platforms
- [x] Automatic config fetching and decryption

## Future Enhancements

- [ ] Progress reporting to server for website display
- [ ] Auto-update mechanism
- [ ] Download scheduling
- [ ] Bandwidth limiting
- [ ] System tray integration
- [ ] macOS support

## License

Proprietary - ARMGDDN Browser
