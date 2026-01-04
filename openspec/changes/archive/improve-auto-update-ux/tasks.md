# Implementation Tasks

- [x] Create a new `UpdateProgressWindow` or reuse the existing Splash/Modal logic to show update status.
- [x] Update `main.js` auto-update logic to:
  - [x] Open the progress window when an update is available and accepted.
  - [x] Report download progress (percentage/bytes) to this window.
  - [x] Show a "Installing..." or "Restarting..." message before spawning the installer.
  - [x] Delay `app.quit()` slightly to ensure the user sees the final status.
- [x] Update `renderer` IPC handlers to support the new update flow events.
