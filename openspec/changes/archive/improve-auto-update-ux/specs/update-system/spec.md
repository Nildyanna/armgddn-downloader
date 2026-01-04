# update-system Spec Delta

## MODIFIED Requirements

### Requirement: Installer Download and Execution

The application SHALL provide visual feedback during the installer download process and inform the user before exiting for installation. This applies to both automatic background updates and user-initiated manual updates.

#### Scenario: Download installer with progress feedback

- **WHEN** the renderer calls `installUpdate` with a non-empty installer URL (triggered automatically or via "Update Now" button)
- **THEN** the main process opens an "Update Progress" window (or modal overlay)
- **AND** downloads the installer file to a temporary directory
- **AND** sends download progress events (percentage, speed) to the Update Progress window.

#### Scenario: Launch Windows installer with exit notification

- **WHEN** running on Windows and the installer file is a `.exe` and download is complete
- **THEN** the Update Progress window displays a "Installing..." or "Restarting..." message
- **AND** the main process spawns the installer as a detached process
- **AND** it marks the app as quitting and calls `app.quit()` after a short delay (e.g., 2 seconds) to allow the user to read the message.

#### Scenario: Launch Linux AppImage installer with notification

- **WHEN** running on Linux and the installer file is an `.AppImage` and download is complete
- **THEN** the Update Progress window displays a "Restarting..." message
- **AND** the main process sets the file as executable
- **AND** spawns it as a detached process
- **AND** then quits the app.
