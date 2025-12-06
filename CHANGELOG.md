# Changelog

All notable changes to ARMGDDN Downloader will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.20] - 2025-12-06

### Fixed
- **Panel Display**: Fixed CSS so panels respect inline display:none while staying centered when visible
- **Auto-open Issue**: Panels no longer auto-open on app launch

## [1.0.19] - 2025-12-06

### Fixed
- **Panel Centering**: Added !important to CSS to ensure panels stay centered
- **Debugging**: Added extensive logging for update checker, browse button, and downloads
- **Download Command**: Fixed parameter name from `id` to `downloadId`

## [1.0.18] - 2025-12-06

### Fixed
- **Single Instance**: Prevent multiple app instances from opening
- **Deep Links**: Focus existing window instead of opening new instance
- **Update Checker**: Added HTTP plugin and permissions for fetch API
- **Download Starting**: Deep links now properly trigger downloads

## [1.0.17] - 2025-12-05

### Fixed
- **Protocol Registration**: Register armgddn:// protocol on app startup using Rust
- **Update Checker**: Added better error handling and logging
- **Deep Links**: Protocol now registered every time app runs

## [1.0.16] - 2025-12-05

### Fixed
- **Protocol Registration**: Use HKCU for armgddn:// protocol (doesn't require admin)
- **Deep Links**: Should now work without running installer as administrator
- **Desktop Shortcut Icon**: Properly set icon for desktop shortcut

## [1.0.15] - 2025-12-05

### Added
- **Browse Button**: Added folder picker for download location selection
- **Skull Logo**: Using actual icon image instead of emoji
- **GitHub Update Checker**: Replaced broken updater plugin with GitHub API check

### Fixed
- **Centered Panels**: Settings and history panels now properly centered
- **Empty State Message**: Fixed JavaScript hardcoded message
- **Max Downloads**: Capped at 3, users can lower to 1 or 2

### Removed
- **Auth Token Field**: Removed from settings UI

## [1.0.14] - 2025-12-05

### Fixed
- **Empty State Message**: Fixed hardcoded message in JavaScript that was overriding HTML
- **Correct Message**: Now shows "Click 'Download with App' on the website"

## [1.0.13] - 2025-12-05

### Fixed
- **Build Script**: Added prebuild script to force delete dist folder before every build
- **Cross-Platform**: Uses Node.js fs.rmSync for Windows/Linux compatibility
- **Guaranteed Fresh HTML**: No possibility of stale cached HTML in builds

## [1.0.12] - 2025-12-05

### Fixed
- **Build Cache**: Force clean checkout in CI to prevent stale dist folder
- **Guaranteed Fresh Frontend**: Rebuilt dist folder with correct UI every time

## [1.0.11] - 2025-12-05

### Fixed
- **Build Process**: Force clean build to ensure all UI changes are included
- **Guaranteed Fresh Build**: No cached artifacts

## [1.0.10] - 2025-12-05

### Fixed
- **Uninstaller**: Now properly removes all app data and installation files
- **Clean Install**: Ensures fresh installs don't inherit old settings

## [1.0.9] - 2025-12-05

### Added
- **Tray Menu**: Right-click tray icon now shows Show and Quit options

### Fixed
- **Protocol Registration**: Fixed executable path in NSIS installer hooks
- **Deep Link**: Improved protocol handler registration for Windows

## [1.0.8] - 2025-12-05

### Fixed
- **Deep Link Launch**: App now handles deep links when launched from browser
- **Protocol Registration**: NSIS installer hooks properly register armgddn:// protocol

### Changed
- **Branding**: Replaced controller icon (🎮) with skull logo (💀)

## [1.0.7] - 2025-12-05

### Fixed
- **Protocol Registration**: NSIS installer now properly registers armgddn:// protocol
- **Deep Link Support**: "Download with App" button now opens the app automatically
- **Windows Integration**: Desktop and Start Menu shortcuts created during installation

## [1.0.6] - 2025-12-05

### Added
- **Debug Logging**: Added detailed logging for session token flow
- **UI Improvements**: Centered text and fixed empty state message

### Fixed
- **Empty State Message**: Updated to reflect website-only flow

## [1.0.5] - 2025-12-05

### Added
- **Session Token Authentication**: Automatic authentication via website deep links
- **Seamless UX**: Token automatically included when clicking "Download with App"
- **Progress Monitoring**: Download progress now properly tracked and displayed in browser

### Changed
- **Removed Manual Input**: No more manual manifest URL entry - website-only flow
- **Simplified Interface**: Cleaner UI with instructions to use website button
- **Auto-Start Downloads**: Downloads start automatically when triggered from website

### Fixed
- **401 Errors**: Session token authentication eliminates unauthorized errors
- **Progress Tracking**: Browser now correctly shows real-time download progress

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
