# desktop-ui Specification (Change: add-post-download-extraction)

## ADDED Requirements

### Requirement: Settings Toggle for Post-Download `.7z` Extraction

The desktop UI SHALL provide a user-facing setting to enable or disable automatic extraction of `.7z` archives after a download completes.

- The setting SHALL be persisted via the existing settings persistence flow.
- The default value SHALL be OFF.

#### Scenario: Settings panel shows extraction toggle

- **WHEN** the user opens the Settings panel
- **THEN** the UI displays a toggle option for `.7z` extraction
- **AND** its state reflects the persisted setting value.

#### Scenario: User enables extraction and saves

- **WHEN** the user enables the `.7z` extraction toggle and clicks `Save Settings`
- **THEN** the renderer persists the setting via `saveSettings`
- **AND** subsequent completed downloads may run the extraction step.

### Requirement: Download Card Displays Extraction State

The desktop UI SHALL display a distinct download state while post-download extraction is running.

#### Scenario: Download transitions to extracting

- **WHEN** the renderer receives an update indicating the download is in an extraction state
- **THEN** the download card status displays `Extracting`
- **AND** progress/speed UI remains stable (no misleading transfer-speed display during extraction).

#### Scenario: Extraction error is shown

- **WHEN** the renderer receives an extraction failure indicator for a completed download
- **THEN** the UI displays a clear error message indicating extraction failed
- **AND** the user can still click `Open Folder` to access the downloaded archives.

## MODIFIED Requirements

### Requirement: Settings Panel

The desktop UI SHALL expose a settings panel where users can configure download location, concurrency, notifications, tray behavior, and post-download extraction.

#### Scenario: Settings values loaded on startup

- **WHEN** the app initializes the renderer
- **THEN** it calls `getSettings` via IPC
- **AND** populates the settings form controls (including the `.7z` extraction toggle) from the returned values.

#### Scenario: Save settings

- **WHEN** the user changes one or more settings (including the `.7z` extraction toggle) and clicks `Save Settings`
- **THEN** the renderer gathers the current values from the form
- **AND** calls `saveSettings` via IPC
- **AND** on success, applies these values to its local settings object and hides the settings panel.
