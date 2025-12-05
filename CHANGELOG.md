# Changelog

All notable changes to ARMGDDN Downloader will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.4] - 2025-12-05

### Fixed
- **Auth Token Storage**: Auth token now properly stored in localStorage for progress reporting
- **401 Errors**: Fixed Unauthorized errors when reporting download progress to server
- Token is now available for both backend downloads and frontend progress reporting

## [1.0.3] - 2025-12-05

### Fixed
- **Tray Icon Behavior**: Left-click on tray icon now restores window (was unresponsive)
- **Windows Protocol Registration**: armgddn:// protocol now automatically registered by installer
  - No manual registry file needed
  - "Download with App" button works immediately after installation
  - WiX installer fragment handles registration

### Improved
- Tray icon now properly unminimizes window when clicked
- Right-click tray menu still available for Show/Quit options

## [1.0.2] - 2025-12-05

### Fixed
- **Windows Deep Link Registration**: Fixed `armgddn://` protocol not being registered on Windows
  - "Download with App" button now works properly in browser
  - Windows installer now correctly registers the protocol handler
  - No more "scheme does not have a registered handler" errors

## [1.0.1] - 2025-12-05

### Improved
- **Minimize to Tray**: Clicking the close button (X) now hides the app to system tray instead of closing it
  - App continues running in background for ongoing downloads
  - Right-click tray icon and select "Show" to restore window
  - Use "Quit" from tray menu to actually exit the app
  - Better UX for background download management

## [1.0.0] - 2025-12-05

### Added

#### Core Features
- Deep link integration via `armgddn://` protocol for one-click downloads
- Manifest-based download system from ARMGDDN Browser
- Encrypted rclone config auto-fetch and decryption (AES-256-GCM)
- Pause/Resume support with HTTP Range requests
- Auto-retry mechanism (3 attempts, 2s delay between retries)
- Configurable concurrent downloads (default: 3, max: 10)
- Real-time progress tracking with speed calculation
- Token-based authentication support
- Cross-platform support (Windows, Linux)
- Bundled rclone binaries for all platforms

#### Advanced Features
- **Desktop Notifications**: Native OS notifications when downloads complete
- **Download History**: Persistent tracking with timestamps and file paths
  - View complete download history
  - Clear history with confirmation
  - Automatic history updates on completion
- **System Tray Integration**: 
  - Minimize to system tray
  - Show/Quit menu options
  - Persistent tray icon
- **Advanced Error Recovery**:
  - Disk space checking before downloads (100MB safety buffer)
  - User-friendly error messages with recovery suggestions
  - Network error detection (timeout, connection, request failures)
  - HTTP error handling (401, 403, 404, 429, 5xx)
  - Specific guidance for each error type
- **Download Scheduling**:
  - Schedule downloads for specific date/time
  - Auto-start when scheduled time arrives
  - Manual "Start Now" override
  - Periodic check every minute
  - "Scheduled" state indicator
- **Categories/Tags**:
  - Tag downloads by game or type
  - Visual category badges
  - Organize downloads by category
- **Multi-Language Support (i18n)**:
  - English (en)
  - Spanish (es)
  - French (fr)
  - German (de)
  - Portuguese (pt)
  - 40+ translated strings
  - Language selector in settings
  - Persistent language preference
  - Auto-reload on language change
- **Auto-Update System**:
  - Cryptographic signature verification
  - Automatic update checks
  - Manual update check button
  - Secure update delivery via GitHub Releases

#### UI/UX Improvements
- Modern dark theme with gradient accents
- Responsive layout
- Settings panel with all configuration options
- History panel with clear functionality
- Visual state indicators (queued, downloading, paused, completed, failed, cancelled, scheduled)
- Category badges with blue styling
- Scheduled time display with clock icon
- Error messages with red highlighting
- Progress bars with smooth animations

#### Developer Experience
- GitHub Actions CI/CD pipeline
- Automated builds for Windows and Linux
- Signed releases with cryptographic verification
- Auto-generated update manifests
- Comprehensive README documentation
- Clean codebase with proper error handling

### Infrastructure
- Progress reporting infrastructure (ready for server integration)
- Server URL and auth token configuration
- Extensible architecture for future features

### Security
- AES-256-GCM encryption for rclone config
- Hardcoded encryption key (secure for this use case)
- Token-based authentication
- Cryptographic signature verification for updates
- No sensitive data exposed in logs

### Performance
- Efficient concurrent download management
- Minimal memory footprint
- Fast startup time
- Optimized rclone integration

## [Unreleased]

### Planned Features
- Server progress reporting implementation
- Bandwidth limiting per download
- macOS support
- Additional languages (Japanese, Chinese, Russian, Arabic)
- Cloud sync for settings and history
- Mobile version (iOS/Android via Tauri Mobile)
- Folder organization by category
- Search/filter in download history

---

[1.0.0]: https://github.com/Nildyanna/armgddn-downloader/releases/tag/v1.0.0
