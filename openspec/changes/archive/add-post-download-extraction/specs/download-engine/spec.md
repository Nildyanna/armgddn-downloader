# download-engine Specification (Change: add-post-download-extraction)

## ADDED Requirements

### Requirement: Optional Post-Download `.7z` Extraction

When a download completes successfully, the download engine SHALL optionally extract `.7z` archives located in the completed download directory.

- The extraction feature SHALL be controlled by a persisted user setting (default OFF).
- When enabled, extraction SHALL run only after the download has finished transferring all files without cancellation or error.
- Extraction SHALL target the download’s output directory under `settings.downloadPath` and SHALL NOT write outside that directory.
- Extraction failures SHALL NOT delete the downloaded archives or other downloaded files.
- The engine SHALL surface extraction failure information to the renderer in a user-visible manner.

#### Scenario: Extraction disabled

- **WHEN** a download completes successfully
- **AND** the user setting for `.7z` extraction is disabled
- **THEN** the engine marks the download as `completed` without running any extraction step.

#### Scenario: Extraction enabled and `.7z` archive present

- **WHEN** a download completes successfully
- **AND** the user setting for `.7z` extraction is enabled
- **AND** one or more files ending in `.7z` exist in the download directory
- **THEN** the engine transitions the download into an extraction state
- **AND** runs the bundled `7z` extraction tool to extract the archive(s) into the download directory
- **AND** once extraction completes successfully, the engine transitions the download to `completed`.

#### Scenario: Extraction enabled but extraction fails

- **WHEN** a download completes successfully
- **AND** `.7z` extraction is enabled
- **AND** the extraction command fails (non-zero exit code) or the extraction tool is missing
- **THEN** the engine records an extraction error for the download
- **AND** it notifies the renderer of the extraction failure
- **AND** the downloaded content remains on disk.

### Requirement: Bundled `7z` Extraction Tool Resolution

The download engine SHALL resolve a platform-specific bundled `7z` extraction executable from the app’s packaged resources.

- The `7z` binary SHALL be included as an application resource per platform.
- The engine SHALL use the bundled `7z` binary strictly for extraction (no archive creation).

#### Scenario: Packaged app uses bundled `7z`

- **WHEN** the app is running from a packaged build
- **THEN** the engine resolves the `7z` executable from packaged resources
- **AND** does not require a system-wide `7z` installation.

## MODIFIED Requirements

### Requirement: Completion, Notifications, and History Persistence

When a download completes successfully, the engine SHALL update state, notify the user, and persist a history record.

- On completion of all files without cancellation or error, the download status SHALL be set to `completed` and overall progress to `100%`.
- If `.7z` extraction is enabled and applicable, the engine SHALL complete the extraction step before emitting the final completion event and notification.
- A completion timestamp SHALL be recorded.
- A history record (including id, name, totalSize, startTime, endTime, and status) SHALL be inserted at the front of the history list and written to `history.json` in the user data directory.
- A user-visible OS-level notification (tray balloon or toast) SHALL be shown indicating that the download has finished.

#### Scenario: Successful download with extraction completes

- **WHEN** a download completes all files without errors or cancellation
- **AND** extraction is enabled and succeeds
- **THEN** the engine emits a final completion event only after extraction finishes
- **AND** it records completion in history.
