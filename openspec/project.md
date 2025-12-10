# Project Context

<!-- markdownlint-disable MD013 -->

## Purpose

ARMGDDN Downloader is a **desktop Electron application** that acts as an external download manager for ARMGDDN Browser.

It is designed to:

- Receive **deep links** from the website via the custom protocol `armgddn://`.
- Fetch a **download manifest** from the ARMGDDN server (JSON describing files and signed URLs).
- Use a bundled **rclone** binary on the users machine to perform HTTP downloads with good throughput.
- Provide a **modern desktop UI** for progress, status, history, and settings.
- Reduce server load by offloading all heavy download work to the client.

The app is **standalone**: users install it once (Windows, Linux, macOS) and then launch downloads directly from the browser via the deep link scheme.

## Tech Stack

- **Electron (main process)**
  - `main.js` is the entry point (CommonJS modules).
  - Integrates with the OS for:
    - Custom protocol handling (`armgddn://...`).
    - System tray icon and context menu.
    - Native notifications (tray balloon on Windows, OS toasts where available).
  - Manages windows, IPC, and access to the filesystem and rclone.

- **Electron (renderer)**
  - `renderer/index.html` defines the UI shell (connection status, downloads list, history panel, settings panel).
  - `renderer/renderer.js` is a vanilla JS bundle running in the renderer, talking to the main process via a preload bridge (`window.electronAPI`).
  - No frontend framework (React/Vue/etc); just DOM APIs and CSS.

- **Packaging (electron-builder)**
  - Defined in `package.json` under `build`.
  - Targets:
    - Windows (NSIS installer).
    - Linux (AppImage, Deb).
    - macOS (DMG).
  - Uses `extraResources` per platform to bundle the correct `rclone` binary into the app resources under `rclone/`.

- **rclone Integration**
  - The app does **not** mount remotes; it uses `rclone copyurl` to download from signed HTTPS URLs.
  - `main.js` computes the rclone path based on platform and packaged resources.
  - rclone is used purely as a robust downloader (buffering, retries, resume) over HTTPS.

## Project Conventions

### Main Process (`main.js`)

- **CommonJS style** (`require`, `module.exports`).
- **State is kept in memory** for the current session:
  - `activeDownloads` map (per-download status, files, progress, rclone processes).
  - `downloadHistory` array.
  - `settings` object.
  - `sessionCookie` representing the web session for manifest and progress reporting.
- **Persistent storage** lives under `app.getPath('userData')`:
  - `config.json` for user settings (download path, max concurrency, tray behavior, notifications).
  - `history.json` for completed downloads.
  - `session.json` for the encrypted session cookie.
- **Security-sensitive data**:
  - Session cookie is encrypted using `safeStorage` when available, with clear migration behavior if encryption is not possible.
  - Deep links are validated (`armgddn://` protocol, allowed hosts like `download`/`open`, basic checks on query parameters).
  - File URLs from manifests must be HTTPS; non-HTTPS URLs are rejected.
- **Logging & diagnostics**:
  - Human-readable debug logs are written to a `debug.log` file under `userData` via `logToFile(...)`.
  - Console logging is used for development; file logging is used to diagnose production issues (deep-link parsing, session loading, rclone output errors).

### Renderer (`renderer/renderer.js` + `index.html`)

- Uses an IIFE with `'use strict'` to avoid leaking globals.
- All communication with the main process flows through `window.electronAPI` (preload-defined API) for:
  - Getting and saving settings.
  - Fetching manifests.
  - Starting downloads.
  - Receiving download events (`download-started`, `download-progress`, `download-completed`, `download-error`, `download-cancelled`).
  - Checking session status.
  - Checking for app updates.
- UI conventions:
  - **Connection status** badge at the top (`Disconnected`, `Awaiting First Download`, or `Connected`) based on session state.
  - **Downloads list** shows active and completed downloads, with throttled re-renders to avoid flicker.
  - **History panel** shows past downloads with timestamps and sizes.
  - **Settings panel** controls:
    - Download path.
    - Maximum concurrent downloads.
    - Notification and tray behavior toggles.
- The renderer is responsible only for presentation and user interaction logic. It does **not** call rclone directly.

### Architecture Patterns

- **Deep link driven workflow**
  - Browser opens `armgddn://download?manifest=<url>&token=<token>`.
  - Electron registers as the handler for the `armgddn` protocol.
  - Main process receives the deep link and informs the renderer.
  - Renderer parses and logs the manifest URL and token, then asks the main process to fetch and start the download.

- **Manifest-based downloads**
  - The server returns a **manifest** describing files and HTTPS URLs.
  - Main process parses the manifest into an internal download object (name, total size, per-file entries).
  - Downloads are executed using rclone `copyurl` in parallel with bounded concurrency.

- **Progress tracking and reporting**
  - rclone stdout/stderr is parsed to estimate per-file and aggregate progress, speed, and ETA.
  - Renderer receives periodic `download-progress` updates and re-renders the list.
  - Optionally, the app may report progress back to the website using the token (for trending/telemetry).

- **Resilience & user experience**
  - Download failures (per file) are tracked; some errors (quota, expired tokens) are interpreted from rclone output.
  - Cancel and pause are implemented by terminating or tracking rclone processes and updating download state.
  - System tray integration allows the app to keep running while the window is hidden.

## Domain Context

- **Primary role:** Client-side offload for ARMGDDN Browser.
  - All heavy I/O is moved from the server to user machines.
  - The website is responsible for manifest generation and token issuance.
  - The downloader is responsible for reliable, resumable local storage of content.

- **Security expectations:**
  - Only manifests generated by the ARMGDDN server should be used.
  - Session cookies and tokens must be treated as sensitive and not written to logs.
  - Downloads must use HTTPS URLs; non-HTTPS URLs are rejected to avoid downgrade attacks.

## Important Constraints

- App is packaged with **platform-specific rclone binaries** under `rclone/`.
- The OS **userData** directory must be writable for settings, history, and logs.
- The app is expected to run on **user desktops** (not on servers).
- The **website and downloader versions may drift**; capabilities should be designed to degrade gracefully when older/ newer versions interact (for example, unknown manifest fields should be ignored, not treated as fatal).

## External Dependencies

- **Electron** for desktop shell, windows, IPC, tray, notifications.
- **rclone** CLI for robust HTTP downloads.
- **Host OS** for deep link registration and tray integration.
- **ARMGDDN Browser server** for:
  - `/api/download-manifest` (or equivalent) JSON manifest endpoint.
  - Optional progress reporting endpoint keyed by a token.

## Using OpenSpec in This Repo

- Use **capability specs** under `openspec/specs/` for things like:
  - `deep-link-handling/` – how `armgddn://` URLs are validated and dispatched.
  - `download-orchestration/` – queueing, concurrency, retry behavior.
  - `session-and-auth/` – cookie handling, token usage, security constraints.
  - `desktop-ui/` – what the user sees in downloads, history, and settings.
- Use **change proposals** under `openspec/changes/<change-id>/` whenever you:
  - Introduce a new capability (e.g., multi-queue support, per-remote defaults).
  - Change behavior for existing flows (e.g., new deep-link verbs, new error handling rules).
  - Make security or performance changes that alter user-observable behavior.

Specs describe what the Electron downloader **does**; changes describe how it **should evolve**.
