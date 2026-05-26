# ArmgddnCompanion — Claude Code Context

## Project Overview
ArmgddnCompanion is an Electron desktop app — a download manager for ARMGDDN content. It receives download requests via the `armgddn://` deep-link protocol, downloads files using bundled `rclone` binaries, and reports progress back to ArmgddnBrowser via `/api/app-progress`.

## Repository Structure
```
/home/armgddn/src/ArmgddnCompanion/
├── main.js              # Main Electron process — all IPC, download logic, tray, deep links
├── preload.js           # Preload script for renderer context bridge
├── preload-update.js    # Preload script for the update overlay window
├── renderer/            # Frontend UI (HTML/CSS/JS)
├── assets/              # Icons, media
├── rclone/
│   ├── win32/rclone.exe
│   ├── linux/rclone
│   └── darwin/rclone
├── sync-version.js      # Postversion hook — syncs version across both repos
├── package.json         # Version source of truth
└── CHANGELOG.md         # Release notes
```

## Key Architecture Decisions
- **Single main process**: All download logic, IPC handlers, tray, and window management live in `main.js`.
- **rclone for transfers**: Files are downloaded via spawned `rclone` child processes using a bundled binary from `rclone/<platform>/`.
- **Deep link protocol**: `armgddn://` links are registered at install time. On second-instance launch, the deep link is forwarded to the running instance via `app.on('second-instance')`.
- **Progress reporting**: The Companion POSTs progress to ArmgddnBrowser at `/api/app-progress` so the browser UI can show live download state.
- **Platform-specific window management**: Linux (KDE Plasma) requires `moveTop()` instead of `focus()`, and parent/modal relationships must be skipped to avoid X11/Wayland compositor issues.

## Release / Tagging Workflow
```bash
# 1. Bump version in package.json (use X.Y.0Z format, e.g. 4.3.03)
# 2. The postversion hook (sync-version.js) runs automatically and syncs
#    the version to ArmgddnBrowser's package.json and default.php
# 3. Commit and push
# 4. Create and push a tag — CI builds release artifacts from the tag
git tag v4.3.03
git push origin main
git push origin v4.3.03
```
**Important**: GitHub Actions triggers on tag push (`vX.Y.Z`). If a tag already exists at HEAD, Actions will NOT re-fire — always bump the version and push a fresh tag.

## Build
```bash
npm install
npm start                # Run in dev
npm run build            # Build for current platform
npm run build:win        # Windows NSIS installer
npm run build:linux      # Linux AppImage + deb
npm run build:mac        # macOS pkg
```

## Packaging Requirements
Bundled rclone binaries must exist before building:
- `rclone/win32/rclone.exe`
- `rclone/linux/rclone`
- `rclone/darwin/rclone`

## Version Format
Versions use a zero-padded patch format: `4.3.01`, `4.3.02`, `4.3.03`, etc.
`package.json` normalizes these (e.g. `4.3.03` → `4.3.3`) but git tags always use the user's padded format (`v4.3.03`).

## Git / GitHub
- Repo: `https://github.com/Nildyanna/armgddn-downloader`
- Branch: `main`
- CI builds on tag push matching `v*`

## Things to Never Do
- Never push a tag without bumping the version first — re-tagging the same commit won't trigger CI
- Never edit `rclone/` binaries — they are pre-built platform binaries
- Never remove the `sync-version.js` postversion hook — it keeps ArmgddnBrowser in sync
- Never set `parent` or `modal: true` on any window on Linux — causes KDE Plasma to raise the wrong window
- Never use `focus()` to raise a window on Linux — use `moveTop()` instead
