# update-system Specification

## Purpose

Define how the ARMGDDN Companion checks for new releases, compares versions, selects an appropriate installer asset per platform, and performs or assists with the update installation.
## Requirements
### Requirement: GitHub Release Discovery

The application SHALL query GitHub Releases to determine the latest available version of ARMGDDN Companion.

#### Scenario: Fetch latest release metadata

- **WHEN** the main process handles a `check-updates` request
- **THEN** it sends an HTTPS GET request to the GitHub API endpoint for the latest release of the repository (e.g., `/repos/Nildyanna/armgddn-downloader/releases/latest`)
- **AND** it includes a suitable `User-Agent` header as required by the GitHub API
- **AND** it parses the JSON response body into a release object.

### Requirement: Update Host Allowlist

The update system SHALL restrict installer URLs and any followed redirects to an allowlist of known GitHub-controlled hosts.

#### Scenario: Installer URL host is validated

- **WHEN** the update system selects an installer asset URL from GitHub release metadata
- **THEN** it MUST require `https:`
- **AND** it MUST require the URL hostname to match the update host allowlist.

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

#### Scenario: Installer execution requires prior verification

- **WHEN** running an automatic update install
- **THEN** execution/opening of the installer is gated on successful signed installer verification.

### Requirement: Auto-Update Startup Behavior

The renderer SHALL support automatically checking for updates on startup.

#### Scenario: Auto-update enabled

- **WHEN** the user's settings have `autoUpdate: true`
- **THEN** the renderer checks for updates on startup
- **AND** if an installer URL is available, it initiates `installUpdate` without prompting.

#### Scenario: Auto-update disabled

- **WHEN** the user's settings have `autoUpdate: false`
- **THEN** the renderer performs a silent update check on startup and MAY notify the user only when an update is available.

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

### Requirement: Signed Installer Verification

The update system SHALL verify a downloaded installer using a cryptographic signature before executing or opening it.

#### Scenario: Download and verify signature before execution

- **WHEN** the renderer calls `installUpdate` with a non-empty installer URL
- **AND** the installer download succeeds
- **THEN** the main process downloads a corresponding signature artifact for the installer over HTTPS
- **AND** it validates the signature using a pinned public key embedded in the application
- **AND** it MUST NOT execute/open the installer unless signature verification succeeds.

#### Scenario: Signature missing or invalid triggers manual fallback

- **WHEN** the installer signature is missing or fails verification
- **THEN** `installUpdate` returns `{ success: false, error: ... }`
- **AND** the renderer guides the user to a manual installation path (e.g., open the release page).

