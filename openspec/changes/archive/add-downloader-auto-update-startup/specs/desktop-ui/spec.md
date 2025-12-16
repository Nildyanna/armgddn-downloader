# desktop-ui Delta

## MODIFIED Requirements

### Requirement: Settings Panel
The desktop UI SHALL expose a settings panel where users can configure download location, concurrency, speed limiting, extraction behavior, update behavior, notifications, tray behavior, and startup behavior.

#### Scenario: Open and close settings
- **WHEN** the user clicks the `Settings` button in the header
- **THEN** the settings panel becomes visible
- **AND** clicking the close button hides the panel without discarding already-saved settings.

#### Scenario: Settings values loaded on startup
- **WHEN** the app initializes the renderer
- **THEN** it calls `getSettings` via IPC
- **AND** populates the settings form controls from the returned values.

#### Scenario: Save settings
- **WHEN** the user changes one or more settings and clicks `Save Settings`
- **THEN** the renderer gathers the current values from the form
- **AND** calls `saveSettings` via IPC
- **AND** on success, applies these values to its local settings object and hides the settings panel.

## ADDED Requirements

### Requirement: Auto-Update Setting
The desktop UI SHALL provide a user-controlled `Auto-update` toggle.

#### Scenario: User enables auto-update
- **WHEN** the user enables `Auto-update` and saves settings
- **THEN** the renderer persists the preference via `saveSettings`
- **AND** the UI reflects the saved state on next startup.

### Requirement: Start With OS Startup Setting
The desktop UI SHALL provide a user-controlled `Start with OS startup` toggle.

#### Scenario: User enables start with startup
- **WHEN** the user enables `Start with OS startup` and saves settings
- **THEN** the renderer persists the preference via `saveSettings`
- **AND** the UI reflects the saved state on next startup.
