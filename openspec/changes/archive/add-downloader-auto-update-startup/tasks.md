# Tasks

## 1. Proposal Validation
- [ ] 1.1 Run `openspec validate add-downloader-auto-update-startup --strict` and resolve any errors.

## 2. Settings Persistence
- [ ] 2.1 Extend the settings schema to include auto-update + start-with-startup.
- [ ] 2.2 Ensure settings are loaded on startup and saved to `userData/config.json`.
- [ ] 2.3 Add migration/defaulting so older configs keep working.

## 3. UI Updates
- [ ] 3.1 Add Settings UI toggles: Auto-update, Start with OS startup.
- [ ] 3.2 Ensure Settings UI loads saved values on app startup.

## 4. Startup Integration
- [ ] 4.1 Implement start-on-login for Windows/macOS.
- [ ] 4.2 Implement start-on-login for Linux (desktop entry / autostart integration).

## 5. Fully Automatic Updates (Opt-in)
- [ ] 5.1 When Auto-update is enabled, check for updates on startup and automatically download/install supported installers.
- [ ] 5.2 Preserve existing security allowlist restrictions for update hosts and HTTPS.
- [ ] 5.3 Ensure the app exits cleanly before running the installer.

## 6. Silent Installer Option (User-Consented)
- [ ] 6.1 Add support for passing silent flags to installers when available (e.g. NSIS `/S`).
- [ ] 6.2 Add a user-visible, documented way to enable silent install/update behavior.

## 7. Verification
- [ ] 7.1 Manual test: settings persist across restart.
- [ ] 7.2 Manual test: update installs automatically when enabled.
- [ ] 7.3 Manual test: start-on-boot toggling works.
