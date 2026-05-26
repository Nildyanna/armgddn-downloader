# CLAUDE.md — armgddn-downloader (ARMGDDN Companion)

Electron desktop download manager for ARMGDDN content. Uses bundled `rclone` binaries for resilient transfers. Receives downloads via `armgddn://` deep links from the ARMGDDN Browser.

---

## Key Files

| File | Purpose |
|------|---------|
| `main.js` | Electron main process — all app logic, IPC handlers, rclone management, deep link handling, tray, settings |
| `preload.js` | Contextbridge preload for the main renderer window |
| `preload-update.js` | Contextbridge preload for the updater window |
| `renderer/index.html` | Main renderer window HTML |
| `renderer/renderer.js` | Main renderer window JS — all UI logic |
| `renderer/styles.css` | Main renderer styles |
| `renderer/update.html` | Auto-update UI window |
| `renderer/update.js` | Auto-update window JS |
| `sync-version.js` | Run via `postversion` hook — syncs version across files after `npm version` |
| `update-ed25519-pub.pem` | Ed25519 public key used to verify auto-update installer signatures |

---

## Dev Commands

```bash
npm install          # install dependencies
npm start            # run app in development (electron .)
npm run build        # build for current platform
npm run build:win    # build Windows NSIS installer
npm run build:linux  # build Linux AppImage + deb
npm run build:mac    # build macOS pkg
```

Builds output to `dist/`.

---

## Architecture

```
armgddn:// deep link
       │
       ▼
  main.js (Electron main process)
  ├── Protocol handler (armgddn://)
  ├── Settings persistence (electron userData)
  ├── Download queue management
  ├── rclone subprocess spawning (bundled binary)
  ├── Progress parsing from rclone stdout
  ├── IPC channels to renderer
  └── System tray + notifications

preload.js ──→ renderer/renderer.js (UI)
preload-update.js ──→ renderer/update.js (updater UI)
```

---

## Tech Stack

- **Framework**: Electron (current: ^42)
- **Main process**: Node.js, CommonJS
- **Renderer**: vanilla JS, plain HTML/CSS (no React/Vue/bundler)
- **Downloads**: bundled `rclone` binaries (`rclone/win32/`, `rclone/linux/`, `rclone/darwin/`)
- **Compression**: bundled `7zip-bin` (from npm package)
- **Packaging**: `electron-builder` — NSIS (Windows), AppImage+deb (Linux), pkg (macOS)
- **Auto-update**: custom updater; verifies installer with Ed25519 signature before executing

---

## Code Conventions

- CommonJS throughout (`require`/`module.exports`) — do not introduce ESM
- Main process logic lives entirely in `main.js` (large single file by design)
- IPC: use `ipcMain`/`ipcRenderer` via the contextBridge exposed in preload scripts
- Settings stored via Electron's `app.getPath('userData')`
- No automated test suite — validation is manual

---

## Deep Link Protocol (`armgddn://`)

The app registers the `armgddn://` custom URL scheme on install. When the Browser sends a download:

1. Browser calls `/api/external-download-token` on the ARMGDDN Browser backend to get a short-lived token
2. Browser opens `armgddn://download?downloadToken=...&token=...`
3. Companion intercepts the deep link, calls `/api/external-download-token/resolve` on the browser backend to get the manifest
4. Companion downloads files using Bearer-authenticated rclone calls

On Windows and Linux, the protocol is registered by the NSIS/deb installer. On Linux, a log-out/log-in may be required after install for desktop environments to pick up the handler.

---

## rclone Integration

Bundled binaries must exist before building:

| Platform | Path |
|----------|------|
| Windows | `rclone/win32/rclone.exe` |
| Linux | `rclone/linux/rclone` |
| macOS | `rclone/darwin/rclone` |

These are packaged as `extraResources` by electron-builder and accessed at runtime via `process.resourcesPath`.

Key rclone flags used:
- `--bwlimit` — per-worker bandwidth throttle (derived from global speed limit ÷ concurrent workers)
- Progress output parsed from rclone's `--stats` JSON or text output to drive the UI

---

## Auto-Update

The updater downloads the new installer, then downloads a `.sig` file from `<installerUrl>.sig`. The installer is only executed if Ed25519 signature verification against `update-ed25519-pub.pem` succeeds. On failure, the app falls back to a manual update prompt.

The update UI is a separate Electron window (`renderer/update.html` + `renderer/update.js`).

---

## Pause / Resume Behavior

- Pausing stops all concurrent rclone workers immediately
- Resuming restarts from where multi-part downloads left off: completed files are kept, incomplete files restart from the beginning
- There is no byte-level resume within a single file transfer

---

## Settings

Stored in Electron userData. Configurable via the Settings panel in the UI:

| Setting | Description |
|---------|-------------|
| Download Path | Where files are saved |
| Max Concurrent Downloads | Number of parallel rclone workers (keep low for HDDs) |
| Download Speed Limit (MB/s) | Global cap; `0` = unlimited |
| Notifications | OS-level download notifications on/off |
| Minimize to tray | Whether minimize/close hides to tray instead of quitting |

---

## Build / Packaging Notes

- `postversion` runs `node sync-version.js` to keep version in sync after `npm version`
- Windows: NSIS installer, per-user install, no one-click
- Linux: AppImage + deb, artifact named `ARMGDDN.Companion-${version}-${arch}.${ext}`
- macOS: pkg, category `public.app-category.utilities`
- CI builds on push and creates GitHub Releases on version tags (`vX.Y.Z`)

---

## Release Process

```bash
npm version patch   # or minor / major — also runs sync-version.js via postversion
git push && git push --tags   # CI picks up the tag and builds + publishes a release
```

---

## Troubleshooting

- **Log file**: `debug.log` in Electron userData directory; tray menu has "Open Log Folder"
- **Windows SmartScreen**: unsigned installers may trigger SmartScreen; no technical workaround without an Authenticode EV certificate
- **Deep links not working**: reinstall so the protocol handler is re-registered; on Linux, log out and back in

---

## Related Projects

- **[ArmgddnBrowser](https://github.com/Nildyanna/ArmgddnBrowser)** — self-hosted browser/backend that generates `armgddn://` deep links and authenticates users via Telegram
