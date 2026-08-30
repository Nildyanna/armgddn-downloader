# Changelog

All notable changes to ARMGDDN Companion will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [5.0.3] - 2026-08-30

### Fixed
- **Download appearing to "restart" after completing** — A download recovering from an expired signed link (token refresh or mirror failover) could be wrongly finalized as failed by the background poll loop while the retry was still in flight, because `activeProcesses` is legitimately empty for the whole duration of the manifest refetch, not just the brief gap between the old process closing and the new one spawning. The finalize-as-failed check now respects a `recovering` flag set for the full duration of both retry paths. Reported by Kaizo, whose debug log made the race condition traceable.

## [5.0.0] - 2026-07-26

### Changed
- **Full visual revamp of the renderer UI** — the app's markup and interaction patterns were modernized while keeping the exact same neon color theme/palette. Emoji-as-icons throughout the header, panel headers, and history dates replaced with hand-authored inline SVG (Feather-style outline icons, recolor via `currentColor`). ~15 inline `style="..."` attributes in `index.html` extracted into real CSS classes. Self-hosted Inter now covers dense body/help copy; Orbitron (headers) and Share Tech Mono (stats/filenames) are unchanged.
- **Settings form controls restyled** — the `#max-concurrent` select and all 7 settings checkboxes now match the app's glassmorphism/glow language (custom chevron dropdown, toggle switches). Underlying element IDs, `.value`/`.checked` semantics, and the `save-settings` IPC whitelist are unchanged — this is markup/CSS only. Settings grouped into "Download Behavior" and "Notifications & Startup" fieldsets.
- **Download/history status indicators** — `.download-state` badges are now color-coded per status (cyan downloading/extracting, lime completed, red failed/cancelled/error, amber paused) with a small glowing status dot, reusing the same dot+pill language `.connection-status` already had. Extended to `.category-badge` too. Progress bars now shimmer while a download is actively running.
- **Modal panels (Settings/History/7z Help)** now fade and scale open/closed via a `.is-open` class instead of snapping via inline `display:none/block`; the old `.settings-panel[style*="display: block"]` CSS selector hack is removed.
- **Toast notifications** added for "Settings saved" and "History cleared" (previously silent).
- **Empty states** for the downloads list and history list now show the ARMGDDN skull mark instead of plain placeholder text.
- **`update.html` reconciled** with the shared stylesheet — its duplicated gradient-heading and `.progress-bar` rules now reuse `styles.css`'s versions instead of redeclaring them locally.
- **Accessibility** — icon-only close buttons now have `aria-label="Close"`; opening a modal now traps focus inside it and marks the rest of the app `inert`, restoring focus to the trigger button on close.

### Fixed
- **Header gradient-text clip regression** (caught before release) — extracting the gradient-text-clip mechanic into a shared `.gradient-heading` utility class initially broke `.app-header h1`'s title rendering: that selector's higher specificity meant its `background:` shorthand silently reset `background-clip` back to `border-box`, making the gradient render as a solid block instead of clipping to the text. Re-declared the clip properties explicitly on `.app-header h1` as well.

### CI
- **`build-win32` and `mobile-android` jobs moved from a self-hosted Windows runner to GitHub-hosted `windows-latest`** — the self-hosted runner was decommissioned. `mobile-android` also drops the hardcoded self-hosted paths (`GRADLE_USER_HOME=C:\gradle-home`, `ANDROID_HOME=C:\Android`) in favor of the runner image's own preinstalled Android SDK, and adds an explicit JDK 17 setup step.

## [4.3.43] - 2026-07-08

### Fixed
- **"Authentication required" right after starting a download** — The previous fix stopped the unnecessary reauth popup by trying the browser's fresh token first, but the very next steps (fetching the manifest, then starting the download) were still hardcoded to ignore that token and fall back entirely to the Companion's own possibly-stale saved session. Now the fresh token carries through the whole flow, and successfully starting a download updates the saved session to match.

### Changed
- Removed an unrecognized `overwrite` input from the release workflow step (cosmetic — GitHub Actions was already silently ignoring it).

## [4.3.42] - 2026-07-08

### Fixed
- **No more unnecessary reauth popup when starting a download** — Clicking "Download with App" while already logged into the website in your browser would still sometimes open the Companion's reauth popup and demand a fresh Telegram login, even though the browser had already handed the app a valid, freshly-minted token via the deep link. That token was being silently ignored (`resolve-download-token` only ever used the Companion's own separately stored session). It's now tried first as a one-shot attempt — never persisted as the saved session, so a stale or crafted deep link still can't silently swap what account the app is logged in as — and only falls back to the stored session / reauth popup if that fails.

## [4.3.41] - 2026-07-08

### Fixed
- **Re-auth popup no longer plays the site's login animation/audio** — The re-auth window (shown when the Companion's session token expires) loads the full site just to re-confirm Telegram login. Its Electron session is a separate storage silo from any regular browser, so the site's once-per-user login-lightning animation was firing as if it were a first-ever visit. The popup now passes `?companionAuth=1` so the site skips it there.

## [4.3.2] - 2026-05-16

### Fixed
- **KDE Plasma compatibility** — Resolved multiple window-management issues on Linux desktops running KDE Plasma:
  - `progressWin` (update overlay) no longer has `parent: mainWindow` on Linux. The `WM_TRANSIENT_FOR` hint caused KDE's compositor to raise the main window to the front whenever the overlay was shown or received focus. The overlay now uses `alwaysOnTop` + `skipTaskbar` without a parent relationship, which correctly positions it without disturbing the window stack.
  - `authWindow` (login dialog) no longer sets `parent` or `modal: true` on Linux. The `_NET_WM_STATE_MODAL` + transient-for combination caused KDE to pop the main window to the front on every focus change inside the modal. The window still functions as a login step via app-level logic.
  - `focus()` calls replaced with `moveTop()` on Linux in the second-instance handler, deep-link flush, and tray restore. KDE's focus-stealing prevention silently drops `focus()` from background processes; `moveTop()` raises the window reliably without triggering the block.
  - `withDialogFocus` / `withDialogFocusSync` skip the `setAlwaysOnTop(false)` + `moveTop()` dance on Linux. X11/Wayland system dialogs appear above all windows natively, so the manipulation is unnecessary — and calling `moveTop()` on a window that previously had a parent could raise the wrong window on KDE.
  - Tray icon now raises the window with `moveTop()` on Linux (both `click` and `double-click` events). KDE Plasma may route tray activation as either event depending on system settings.

## [4.2.99] - 2026-05-14

### Fixed
- **Auto-update double-runner loop** — Added an `_installUpdateInProgress` mutex to the `install-update` IPC handler. Previously the `%ERRORLEVEL%` clobbering bug (fixed in 4.2.98) could trigger a false app relaunch after a failed install, causing a second auto-update cycle to start immediately. The mutex blocks any duplicate `install-update` call while one is already in flight. The flag is cleared on all failure paths so the user can retry without restarting the app.

## [4.2.98] - 2026-05-13

### Fixed
- **Windows auto-update rc=2 (UAC denial)** — Added `"perMachine": false` to the NSIS config so the installer runs per-user and no longer requests UAC elevation. Silent installs (`/S`) now complete without a UAC prompt.
- **`%ERRORLEVEL%` clobbering in update runner** — The `echo` command immediately after the installer call was resetting `%ERRORLEVEL%` to 0, making every install appear successful regardless of the actual exit code. The runner now captures `set RC=%ERRORLEVEL%` immediately after the installer exits and uses `%RC%` for all subsequent checks. This also prevented the false relaunch that caused the double-runner loop.
- **Node.js version in CI** — Updated GitHub Actions `node-version` from 20 → 22 (required by Electron 42).

## [4.2.97] - 2026-05-12

### Fixed
- **Mac build failure** — `@xmldom/xmldom` override pinned to `~0.8.13` (was `^0.9.0`). The 0.9.x release broke the `plist@3` dependency used by electron-builder for macOS `.pkg` builds: `parseFromString` now requires a mimeType argument that `plist@3` never passes.

## [4.2.96] - 2026-05-12

### Changed
- **Electron 39 → 42** — Upgraded to Electron 42. Requires Node.js 22+ in CI.

### Fixed
- **npm audit vulnerabilities** — Corrected all `overrides` floor versions to clear 8 audit advisories (moderate + high). Added `@electron/get@5` override to drop the deprecated `global-agent`/`boolean` transitive dependency. Pinned `@xmldom/xmldom`, `tar`, `ip-address`, `lodash`, `picomatch`, `minimatch`, `brace-expansion`, `glob`, `rimraf`.

## [4.2.95] - 2026-05-11

### Fixed
- **Downloads stuck at 0% indefinitely** — `resolveDownloadRedirectUrl` made a HEAD request to `/api/download-file` with no timeout. If the server accepted the TCP connection but was slow to respond, the download would hang forever with `downloadedSize=0, hasActive=false`. Added an 8-second timeout with `req.destroy()` and a fallback to the original proxy URL.

## [1.0.24] - 2025-12-06

### Added
- **Git Hook**: Pre-commit hook automatically syncs version numbers across all files
- **Version Management**: Only need to update package.json, rest syncs automatically

## [1.0.23] - 2025-12-06

### Added
- **Deep Link Debugging**: Added visible alerts to track deep link handling
- **Verbose Logging**: Shows protocol, hostname, manifest, and token status

## [1.0.22] - 2025-12-06

### Fixed
- **Download Command**: Use snake_case `download_id` parameter to match Rust backend
- **Parameter Consistency**: Fixed all start_download calls to use correct parameter name

## [1.0.21] - 2025-12-06

### Added
- **Dev Tools**: Enabled via config (right-click → Inspect)
- **Production Debugging**: Dev tools available in production builds

## [1.0.20] - 2025-12-06

### Fixed
- **Panel Display**: Fixed CSS so panels respect inline display:none while staying centered when visible
- **Auto-open Issue**: Panels no longer auto-open on app launch

### Added
- **Dev Tools**: Enabled dev console (F12) for debugging

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
- Mobile version (iOS/Android)
- Folder organization by category
- Search/filter in download history

---

[1.0.0]: https://github.com/Nildyanna/armgddn-downloader/releases/tag/v1.0.0
