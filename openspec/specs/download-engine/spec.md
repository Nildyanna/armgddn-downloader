# download-engine Specification

## Purpose

Define how the ARMGDDN Downloader's core download engine interprets manifests, orchestrates per-file downloads using rclone, tracks progress, handles pause/cancel, persists history, and reports status back to the ARMGDDN server.

## Requirements

### Requirement: Manifest-Based Download Initialization

The download engine SHALL accept a manifest object from the renderer and normalize it into a unified internal download model.

- The engine SHALL support the following manifest shapes:
  - An object with `files` array (each entry having at least `url`, `name`, `size` fields), plus optional `path` and `totalSize`.
  - A single-file object with `url`, and optional `name` and `size`.
  - A raw array of file objects (each with at least `url` and `name`).
- If the `files` array is present but empty, the engine SHALL refuse to start the download and return a clear error indicating that no files were found.
- The `name` used for the download SHALL be derived from the manifest's logical path or first file name, and SHALL be used for the target folder name on disk.

#### Scenario: Standard multi-file manifest

- **WHEN** the manifest includes a non-empty `files` array and an overall `path`
- **THEN** the engine derives the download's display name from the last segment of `path`
- **AND** it calculates the total size from `manifest.totalSize` if present, otherwise by summing file sizes.

#### Scenario: Single-file manifest

- **WHEN** the manifest is a single object with `url` and optional `name` and `size`
- **THEN** the engine treats it as a one-file download
- **AND** the total size equals the file size (if provided)
- **AND** the download name defaults to the manifest `name` or `'download'`.

### Requirement: Download Directory and File Layout

The download engine SHALL create a dedicated folder for each download under the configured download path and ensure that parent directories exist for nested files.

- The effective download root SHALL be `settings.downloadPath`.
- For each new download, the engine SHALL create a subfolder named after the download's `name`.
- Before writing a file, the engine SHALL ensure that the parent directory of the output file path exists, creating nested directories as needed.

#### Scenario: Download folder creation

- **WHEN** a new download is started for a game named `Some Game`
- **THEN** the engine creates (if necessary) a folder `<downloadPath>/Some Game`
- **AND** all downloaded files for that manifest are written under this folder (preserving any relative paths defined in the manifest).

### Requirement: Per-File Download via rclone

Each file in a manifest SHALL be downloaded via the bundled `rclone` binary using secure HTTP URLs.

- The engine SHALL reject any file that does not specify a `url` starting with `https://` and mark the download as failed with a clear security error.
- The rclone executable path SHALL be resolved from the app's resources based on the current platform (Windows vs Linux/macOS) and the `rclone/` directory bundled with the app.
- Files SHALL be downloaded using `rclone copyurl` to the computed output path.
- The rclone command-line SHALL include progress flags so that output contains progress percentage, speed, and ETA.

#### Scenario: Valid HTTPS file download

- **WHEN** a manifest file entry has a valid `https://` URL
- **THEN** the engine spawns rclone `copyurl` pointing at that URL and the computed local path
- **AND** it parses rclone's stdout/stderr to maintain per-file progress, speed, and ETA fields.

#### Scenario: Non-HTTPS URL is rejected

- **WHEN** a manifest file entry has a URL that does not start with `https://`
- **THEN** the engine rejects the file with a security error stating that HTTPS is required
- **AND** the overall download status is set to `error` with a descriptive message
- **AND** no rclone process is started for that file.

### Requirement: Concurrent File Downloads

The engine SHALL support downloading multiple files from a manifest in parallel while keeping download state consistent and bounded.

- For each manifest download, the engine SHALL maintain a queue of file entries to be downloaded.
- It SHALL spawn multiple rclone processes in parallel up to a fixed concurrency limit per download (implementation-defined; currently a small integer greater than 1).
- It SHALL track active rclone processes for each download so that they can be cancelled or paused.
- It SHALL maintain per-file progress objects for active files, including `name`, `size`, `progress`, `speed`, `eta`, and `status`.

#### Scenario: Parallel downloads from a multi-file manifest

- **WHEN** a manifest contains N files and N is greater than the configured concurrency limit
- **THEN** the engine starts downloading up to the concurrency limit in parallel
- **AND** as each file completes or fails, a new file from the queue is started until all files are processed or the download is cancelled.

### Requirement: Aggregate Progress and Speed Calculation

The engine SHALL compute overall download progress and aggregate speed from per-file data and expose these metrics to the renderer and to the server progress reporter.

- Overall progress percentage SHALL be based on completed files and the current progress of active files.
- Aggregate speed SHALL be derived from the sum of the `speedBytes` of active file downloads.
- Progress updates SHALL be throttled to avoid overwhelming the UI (e.g., no more than a few times per second per download).

#### Scenario: UI receives throttled progress updates

- **WHEN** rclone emits frequent progress lines for multiple active files
- **THEN** the engine updates the in-memory per-file data on every line
- **BUT** emits `download-progress` events to the renderer no more frequently than the configured UI throttle interval
- **AND** each emitted event includes overall `progress`, total speed, completed file count, and active file summaries.

### Requirement: Pause and Cancel Behavior

The engine SHALL support pausing and cancelling downloads initiated by the user.

- Cancelling a download SHALL:
  - Mark the download as `cancelled`.
  - Set a flag so that no new files are started.
  - Attempt to terminate all active rclone processes.
  - Emit a `download-cancelled` event to the renderer.
- Pausing a download SHALL:
  - Mark the download as `paused`.
  - Attempt to terminate active rclone processes for the current files.
  - Leave already-completed files on disk.

#### Scenario: User cancels an active download

- **WHEN** the renderer requests cancellation for an in-progress download
- **THEN** the engine marks the download as `cancelled`
- **AND** terminates all active rclone processes for that download
- **AND** notifies the renderer that the download was cancelled so the UI can remove it from the list or update its status.

#### Scenario: User pauses an active download

- **WHEN** the renderer requests a pause for an in-progress download
- **THEN** the engine marks the download as `paused`
- **AND** terminates the active rclone processes
- **AND** preserves information about which files completed
- **AND** does not delete already-downloaded files.

#### Scenario: User resumes a paused download

- **WHEN** the renderer requests resume for a paused download
- **THEN** the engine restarts downloads only for files that did not complete previously
- **AND** it MAY need to restart the last in-progress file from the beginning
- **AND** it continues to send progress updates as files complete.

### Requirement: Error Classification and User Feedback

The engine SHALL classify certain common error conditions and surface clear messages to the renderer for display.

- If rclone output indicates a quota or rate-limit error, the engine SHALL set the download status to `error` with a message explaining that the file is temporarily unavailable due to high demand.
- If rclone output indicates an authentication or token error, the engine SHALL set the status to `error` with a message explaining that the download link has expired and the user should retry from the website.
- For other non-zero exit codes, the engine SHALL report a generic failure message including the exit code.

#### Scenario: Quota error messaging

- **WHEN** a file download fails and the rclone logs include indications of quota or rate-limit errors
- **THEN** the engine marks the download as `error`
- **AND** sets a human-readable error message telling the user that the download quota has been exceeded and to try again later or choose a different game.

#### Scenario: Expired link messaging

- **WHEN** a file download fails and the rclone logs indicate an expired or invalid token (e.g., HTTP 401/unauthorized semantics)
- **THEN** the engine marks the download as `error`
- **AND** instructs the user (via the error message) to start the download again from the website.

### Requirement: Completion, Notifications, and History Persistence

When a download completes successfully, the engine SHALL update state, notify the user, and persist a history record.

- On completion of all files without cancellation or error, the download status SHALL be set to `completed` and overall progress to `100%`.
- A completion timestamp SHALL be recorded.
- A history record (including id, name, totalSize, startTime, endTime, and status) SHALL be inserted at the front of the history list and written to `history.json` in the user data directory.
- A user-visible OS-level notification (tray balloon or toast) SHALL be shown indicating that the download has finished.

#### Scenario: Successful download is added to history

- **WHEN** a download completes all files without errors or cancellation
- **THEN** the engine writes a new entry to the history file with `status: completed`
- **AND** the renderer's history panel can subsequently display this entry with name, size, and completion date/time.

### Requirement: Server-Side Progress Reporting

The download engine SHALL periodically report download progress back to the ARMGDDN Browser server for telemetry and trending, when a valid token is available.

- Each download MAY carry an associated token, derived from the deep-link or manifest flow.
- If no token is present, the engine SHALL skip progress reporting but continue the download normally.
- When a token is present, the engine SHALL periodically send POST requests to the server's progress endpoint with:
  - A stable `downloadId`.
  - `fileName` and `remotePath` for the content being downloaded.
  - `bytesDownloaded` and `totalBytes`.
  - A normalized `status` string (e.g., `downloading`, `completed`, `error`, `cancelled`).
  - An optional `error` message when applicable.
- Progress reports SHALL be throttled to a reasonable cadence (e.g., no more than once every few seconds per download).

#### Scenario: Progress reports while downloading

- **WHEN** a download is in progress and has a valid token
- **THEN** the engine periodically sends progress updates to the server with the current bytes downloaded and status `downloading`
- **AND** it logs the request and response in the debug log for diagnostics.

#### Scenario: Final completion report

- **WHEN** a download reaches `completed` status
- **THEN** the engine sends a final progress report with `status: completed` and `bytesDownloaded` equal to `totalBytes`
- **AND** this report is sent before the download is removed from the active download map.
