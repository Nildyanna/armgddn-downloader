# Improve Auto-Update UX

## Problem

Currently, when an update is triggered (either automatically or manually by the user), the application downloads the installer and immediately quits to spawn the installer process. This results in a jarring experience where the application simply "disappears" without feedback, leaving the user wondering if it crashed or if the update is actually running.

## Solution

We will introduce a "Update in Progress" window or modal that:
1. Displays download progress of the installer.
2. Informs the user that the application is about to restart/update.
3. Prevents interaction with the main app while the update is being prepared.

This flow will be used for **both** automatic background updates and manual "Update Now" actions.

## Impact

- **User Experience**: Significantly improved clarity during updates.
- **Implementation**: Requires a new ephemeral window or IPC flow to report installer download progress before `app.quit()`.
