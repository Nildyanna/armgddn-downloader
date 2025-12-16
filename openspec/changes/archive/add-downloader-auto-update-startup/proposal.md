# Add Downloader Auto-Update and Startup

## Why
Users expect ARMGDDN Companion to retain their preferences across updates and to support a set-it-and-forget-it experience (automatic updates, optional startup on boot). Today, settings exist but are not fully aligned with all UI options and there is no explicit user-controlled auto-update / start-on-boot preference.

## What Changes
- Persist all settings shown in the Settings UI (download location, max concurrent downloads, speed limit, auto-extract, notifications, tray behaviors) using the existing `userData/config.json` mechanism.
- Add two new settings:
  - `Auto-update` (when enabled, updates install automatically with minimal interruption).
  - `Start with OS startup` (when enabled, registers the app to start on login).
- Update behavior:
  - Auto-update is opt-in and user-controlled.
  - Installer execution can be automated but MUST remain user-consented and transparent.
  - Windows installer supports a documented silent flag; the app may be configured to launch after install in a user-visible way.

## Impact
- Affected specs:
  - `openspec/specs/desktop-ui/spec.md`
  - `openspec/specs/update-system/spec.md`
  - `openspec/specs/deployment/spec.md`
- Affected code (expected):
  - `main.js` (settings schema/migration, startup registration, auto-update scheduling)
  - `preload.js` (IPC surface if needed)
  - `renderer/renderer.js` + `renderer/index.html` (Settings UI toggles)
  - `package.json` (electron-builder/NSIS options as needed)
- Security considerations:
  - Auto-update remains restricted to allowlisted HTTPS hosts.
  - Startup registration should be reversible and scoped to the user account.
