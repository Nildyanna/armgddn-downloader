# update-system Specification

## Purpose

Define how the ARMGDDN Downloader checks for new releases, compares versions, selects an appropriate installer asset per platform, and performs or assists with the update installation.

## Requirements

### Requirement: GitHub Release Discovery

The application SHALL query GitHub Releases to determine the latest available version of ARMGDDN Downloader.

#### Scenario: Fetch latest release metadata

- **WHEN** the main process handles a `check-updates` request
- **THEN** it sends an HTTPS GET request to the GitHub API endpoint for the latest release of the repository (e.g., `/repos/Nildyanna/armgddn-downloader/releases/latest`)
- **AND** it includes a suitable `User-Agent` header as required by the GitHub API
- **AND** it parses the JSON response body into a release object.

### Requirement: Version Comparison

The update system SHALL compare the installed app version against the latest release version using semantic version order.

#### Scenario: Determine if update is available

- **WHEN** a latest release is successfully fetched
- **THEN** the system extracts the release version (e.g., from `tag_name`, stripping leading `v`)
- **AND** compares it with `app.getVersion()` using numeric components split on `.`
- **AND** sets `hasUpdate` to `true` if and only if the latest version is greater than the current version.

### Requirement: Platform-Specific Installer Selection

The update system SHALL select an appropriate installer asset from the latest release for the current platform, when such an asset exists.

#### Scenario: Windows installer selection

- **WHEN** running on Windows and the latest release contains one or more `.exe` assets
- **THEN** the update system chooses a suitable `.exe` asset and exposes its `browser_download_url` as `installerUrl` in the `check-updates` response.

#### Scenario: Linux installer selection

- **WHEN** running on Linux and the latest release contains `.AppImage` or `.deb` assets
- **THEN** the update system prefers an `.AppImage` asset when available
- **AND** otherwise falls back to a `.deb` asset
- **AND** exposes the chosen asset's `browser_download_url` as `installerUrl`.

#### Scenario: macOS installer selection

- **WHEN** running on macOS and the latest release contains `.dmg` assets
- **THEN** the update system chooses a suitable `.dmg` asset and exposes its `browser_download_url` as `installerUrl`.

#### Scenario: No installer asset available

- **WHEN** the latest release does not contain a suitable installer asset for the current platform
- **THEN** the update system returns `installerUrl: null` (or equivalent) while still indicating `hasUpdate: true`
- **AND** provides the release page URL so the renderer can open it in the user's browser.

### Requirement: Error Handling for Update Checks

The update system SHALL fail gracefully when the GitHub API call or JSON parsing fails.

#### Scenario: Network or API error

- **WHEN** the GitHub request fails due to network error or non-200 status code
- **THEN** the update system returns an object with `hasUpdate: false`, the current installed version, and an `error` message summarizing the failure.

#### Scenario: Malformed JSON response

- **WHEN** the GitHub API responds with a body that cannot be parsed as JSON
- **THEN** the update system treats the check as failed and returns an object with `hasUpdate: false`, the current version, and an `error` field.

### Requirement: Installer Download and Execution

The application SHALL download and launch the installer when the user opts into an automatic update and an installer URL is available.

#### Scenario: Download installer to temporary directory

- **WHEN** the renderer calls `installUpdate` with a non-empty installer URL
- **THEN** the main process downloads the installer file to a temporary directory path under the OS temp folder
- **AND** it uses a unique filename based on timestamp and platform.

#### Scenario: Launch Windows installer and exit

- **WHEN** running on Windows and the installer file is a `.exe`
- **THEN** the main process spawns the installer as a detached process so it continues after the Electron app exits
- **AND** it marks the app as quitting and calls `app.quit()` shortly after spawning the installer
- **AND** it reports `{ success: true }` back to the renderer if the spawn succeeded.

#### Scenario: Launch Linux AppImage installer

- **WHEN** running on Linux and the installer file is an `.AppImage`
- **THEN** the main process sets the file as executable
- **AND** spawns it as a detached process
- **AND** then quits the app so the AppImage can proceed.

#### Scenario: Linux deb installer manual path

- **WHEN** running on Linux and the installer file is a `.deb`
- **THEN** the main process downloads the `.deb` file
- **AND** opens the containing folder or file location in the file manager
- **AND** returns a success result with a message instructing the user to install the package manually.

#### Scenario: Launch macOS DMG

- **WHEN** running on macOS and the installer file is a `.dmg`
- **THEN** the main process opens the DMG using the default system handler
- **AND** returns a success result indicating that installation should be completed manually.

### Requirement: Installer Download Error Handling

The update system SHALL detect and report failures that occur while downloading or launching the installer.

#### Scenario: Installer download fails

- **WHEN** the HTTP request for the installer fails or receives a non-200 status code
- **THEN** `installUpdate` returns an object with `success: false` and an `error` message
- **AND** no attempt is made to launch an installer executable.

#### Scenario: Installer spawn failure

- **WHEN** the main process is unable to spawn the installer process (e.g., permission or filesystem error)
- **THEN** it logs the error to the debug log
- **AND** returns an object with `success: false` and a concise error message for the renderer to display
- **AND** the Electron app remains running so the user can attempt other actions or fall back to manual installation.
