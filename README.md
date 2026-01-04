# ARMGDDN Companion

ARMGDDN Companion is a desktop download manager for ARMGDDN content.

It uses `rclone` under the hood to download files reliably and quickly, while providing a simple UI for managing download progress, pausing/resuming, and history.

## What this app does

- Accepts ARMGDDN download requests (including via the `armgddn://` deep-link protocol)
- Downloads the files to a local folder using `rclone`
- Shows progress, transfer speed, and completion state in the UI
- Keeps a local download history

## Features

- **Deep link support**
  - Registers the `armgddn://` protocol so the Browser/website can open the Companion directly.
- **Fast downloads via rclone**
  - Uses `rclone` for resilient transfers and good performance.
- **Pause / Resume**
  - You can pause in-progress downloads and resume later - With caveats.
  - Pausing a download will stop all concurrent workers and pause the download.
  - Resuming a download will keep all completed files of a multi-part download but restart any files that hadn't yet reached completion.
- **Download history**
  - Completed downloads are recorded locally.
- **System tray integration**
  - Minimization-to-tray behavior is configurable in Settings.
- **Bandwidth throttling**
  - Optional overall download speed limit (MB/s).
- **Cross-platform packaging**
  - Windows, Linux (and macOS support in the build config).

## Getting started (users)

1. Install the latest release for your OS.
2. Launch **ARMGDDN Companion**.
3. Open Settings and confirm:
   - Download folder
   - Max concurrent downloads
   - Optional download speed limit
4. Start a download from the ARMGDDN Browser/website (or open an `armgddn://...` link).

## Settings

The Settings panel controls how downloads are performed.

- **Download Path**
  - Where files will be saved on disk.
- **Max Concurrent Downloads**
  - Maximum number of parallel file transfers the app will run per download.
  - **SSD / NVMe**: Safe to set to **10-20** to maximize speed on fast fiber connections.
  - **HDD (Mechanical/External)**: Recommend **3-6**. Higher values will cause disk thrashing and system lag.
- **Download Speed Limit (MB/s)**
  - Caps overall download speed (useful to avoid saturating your home bandwidth).
  - This is applied by dividing the cap across concurrent workers and passing `--bwlimit` to each `rclone` process.
  - Set to `0` to disable the limit.
- **Notifications**
  - Enables/disables OS-level notifications.
- **Minimize to tray on minimize / close**
  - Controls whether the window hides to tray rather than quitting.

## Troubleshooting

- **Where is the log file?**
  - The app writes a `debug.log` file under the Electron `userData` directory.
  - The tray menu includes an **Open Log Folder** shortcut.

- **Windows Defender SmartScreen warning**
  - Some Windows systems may show a SmartScreen prompt (e.g. "Windows protected your PC" / "Unknown publisher") when launching the installer.
  - This behavior depends on Microsoft's reputation systems and whether the downloaded file is marked as coming from the internet.
  - There is no reliable technical workaround for SmartScreen prompts on unsigned installers.
  - **Mitigation**: sign the Windows installer and binaries with an Authenticode code-signing certificate (EV certificates typically reduce prompts faster).

- **Downloads are slow**
  - Check your **Max Concurrent Downloads** setting.
  - If you enabled **Download Speed Limit (MB/s)**, try raising it or setting it to `0`.
  - Your ISP/router may also limit many concurrent connections.

- **Deep links don’t open the app**
  - Reinstall the app so the `armgddn://` protocol handler is registered again.
  - On Linux, desktop environments can require a log out / log in after installing protocol handlers.

## Support

- Telegram: [https://t.me/ARMGDDNGames](https://t.me/ARMGDDNGames)

## Development

### Prerequisites

- Node.js + npm
- `rclone` binaries in the `rclone/` directory (see below)

### Install + run

```bash
npm install
npm start
```

### Build

```bash
# Build for current platform
npm run build

# Build for specific platform
npm run build:win
npm run build:linux
npm run build:mac
```

## Packaging requirements (rclone)

The app bundles platform-specific `rclone` binaries. Ensure these paths exist before building:

- `rclone/win32/rclone.exe` (Windows)
- `rclone/linux/rclone` (Linux)
- `rclone/darwin/rclone` (macOS)

## Release process (high level)

1. Bump `package.json` version.
2. Commit and push to `main`.
3. Create and push a tag in the form `vX.Y.Z`.
4. CI will build release artifacts from the tag.

## License

MIT
