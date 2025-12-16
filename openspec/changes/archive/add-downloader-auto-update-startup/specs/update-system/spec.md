# update-system Delta

## MODIFIED Requirements

### Requirement: Installer Download and Execution
The application SHALL download and launch the installer when automatic updates are enabled and an installer URL is available.

#### Scenario: Download installer to temporary directory
- **WHEN** the update system decides to install an update automatically
- **THEN** the main process downloads the installer file to a temporary directory path under the OS temp folder
- **AND** it uses a unique filename based on timestamp and platform.

#### Scenario: Launch Windows installer and exit
- **WHEN** running on Windows and the installer file is a `.exe`
- **THEN** the main process spawns the installer as a detached process so it continues after the Electron app exits
- **AND** it marks the app as quitting and calls `app.quit()` shortly after spawning the installer.

## ADDED Requirements

### Requirement: Fully Automatic Updates (Opt-in)
The update system SHALL support fully automatic update installation when and only when the user has enabled the `Auto-update` setting.

#### Scenario: Auto-update enabled and update available
- **WHEN** the app starts and `Auto-update` is enabled
- **AND** `check-updates` reports `hasUpdate: true` and a non-null installer URL
- **THEN** the app begins the update install flow without prompting the user
- **AND** it logs progress to the debug log.

#### Scenario: Auto-update disabled
- **WHEN** `Auto-update` is disabled
- **THEN** the update system does not install updates automatically
- **AND** it continues to support user-invoked update checks and installs.

### Requirement: Silent Installer Invocation (User-Consented)
The update system SHALL support passing a platform-appropriate silent flag to installers when the user has explicitly enabled silent update behavior.

#### Scenario: Windows NSIS silent install
- **WHEN** running on Windows and the selected installer is an NSIS `.exe`
- **AND** the user has enabled silent update behavior
- **THEN** the installer is spawned with the `/S` flag.
