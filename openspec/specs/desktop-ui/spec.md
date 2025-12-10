# desktop-ui Specification

## Purpose

Define the user-facing desktop UI behavior of the ARMGDDN Downloader Electron renderer, including connection status, downloads list, history panel, settings panel, and integration with main-process actions.

## Requirements

### Requirement: Connection Status Indicator

The desktop UI SHALL display a prominent connection status indicator that reflects whether the downloader has a valid session with the ARMGDDN Browser server.

#### Scenario: Connected state

- **WHEN** the renderer receives a session status with `isValid: true`
- **THEN** the UI updates the connection badge text to `Connected`
- **AND** applies the "connected" visual styling (green dot / success style).

#### Scenario: Awaiting first download state

- **WHEN** the renderer receives a session status with `isValid: false`
- **THEN** the UI displays `Awaiting First Download` (or equivalent copy)
- **AND** applies a "pending" visual styling distinct from the connected state.

### Requirement: Downloads List Presentation

The desktop UI SHALL present current downloads in a list with clear status, progress, and summary information.

#### Scenario: Empty downloads list

- **WHEN** there are no active downloads in the renderer's local `downloads` map
- **THEN** the downloads list region displays an empty-state message explaining that the user should click "Download with App" on the website to begin
- **AND** no download cards are shown.

#### Scenario: Active download card

- **WHEN** the renderer receives a `download-started` event for a new download
- **THEN** it adds a card to the downloads list showing at least the download name, 0% progress (or initial progress), and an initial status (`Starting` or `In Progress`)
- **AND** subsequent `download-progress` events update the progress bar, percentage, file counts, and total size text.

#### Scenario: Completed download card

- **WHEN** the renderer receives a `download-completed` event for a given download id
- **THEN** it updates that card to status `Completed`
- **AND** it sets the progress bar to 100%.

### Requirement: Download Control Buttons

The desktop UI SHALL expose pause, resume, cancel, and open-folder controls per download, mapped to main-process IPC handlers.

#### Scenario: Pause running download

- **WHEN** a download is in a running state (`starting`, `in_progress`, or `downloading`)
- **AND** the user clicks the `Pause` button on that card
- **THEN** the renderer invokes the `pauseDownload` IPC handler with the download id
- **AND** on success, the card status text updates to `Paused`.

#### Scenario: Resume paused download

- **WHEN** a download is in `Paused` status
- **AND** the user clicks the `Resume` button on that card
- **THEN** the renderer invokes the `resumeDownload` IPC handler with the download id
- **AND** on success, the card status changes back to an active state and progress updates resume.

#### Scenario: Cancel download

- **WHEN** a download is active or paused
- **AND** the user clicks the `Cancel` button
- **THEN** the renderer invokes the `cancelDownload` IPC handler with the download id
- **AND** removes or updates the card in response to the `download-cancelled` event.

#### Scenario: Open download folder

- **WHEN** a download has completed successfully
- **AND** the user clicks `Open Folder`
- **THEN** the renderer invokes the `openFolder` IPC handler using the configured download path
- **AND** the OS opens the folder in the file manager.

### Requirement: Download History Panel

The desktop UI SHALL provide a history panel listing previously completed downloads.

#### Scenario: Show history panel

- **WHEN** the user clicks the `History` button in the header
- **THEN** the history panel becomes visible
- **AND** the renderer fetches the history via the `getHistory` IPC handler
- **AND** it renders one entry per history record with at least name, size, and completion date/time.

#### Scenario: Clear history

- **WHEN** the history panel is open
- **AND** the user confirms a clear-history action
- **THEN** the renderer calls `clearHistory`
- **AND** refreshes the panel, showing an empty-state message when there are no records.

### Requirement: Settings Panel

The desktop UI SHALL expose a settings panel where users can configure download location, concurrency, notifications, and tray behavior.

#### Scenario: Open and close settings

- **WHEN** the user clicks the `Settings` button in the header
- **THEN** the settings panel becomes visible
- **AND** clicking the close button hides the panel without discarding already-saved settings.

#### Scenario: Settings values loaded on startup

- **WHEN** the app initializes the renderer
- **THEN** it calls `getSettings` via IPC
- **AND** populates the settings form controls (download path, max concurrent downloads, notification and tray checkboxes) from the returned values.

#### Scenario: Save settings

- **WHEN** the user changes one or more settings and clicks `Save Settings`
- **THEN** the renderer gathers the current values from the form
- **AND** calls `saveSettings` via IPC
- **AND** on success, applies these values to its local settings object and hides the settings panel.

### Requirement: Version Display and Window Title

The desktop UI SHALL display the current application version in both the main window title and a small indicator in the header area.

#### Scenario: Version shown in header and title

- **WHEN** the renderer initializes
- **THEN** it calls `getVersion` via IPC
- **AND** sets the document title to include `ARMGDDN Downloader v<version>`
- **AND** displays `Version <version>` in the designated version label area of the header.

### Requirement: Update Check Integration

The desktop UI SHALL provide a user-invoked `Check for Updates` action that calls into the update system and presents results.

#### Scenario: Manual update check

- **WHEN** the user clicks `Check for Updates`
- **THEN** the renderer calls `checkUpdates` via IPC
- **AND** if an error is returned, shows a clear error message
- **AND** if `hasUpdate` is false, informs the user that the current version is up to date
- **AND** if `hasUpdate` is true, prompts the user to download and install the update or open the download page, as defined in the update-system specification.
