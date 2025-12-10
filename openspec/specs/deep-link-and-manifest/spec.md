# deep-link-and-manifest Specification

## Purpose

Define how the ARMGDDN Downloader desktop app receives, validates, and handles `armgddn://` deep links from the browser, and how it turns those deep links into manifest fetches against the ARMGDDN server.

## Requirements

### Requirement: Custom Protocol Registration

The application SHALL register the `armgddn` custom protocol so that deep links from the browser are opened in ARMGDDN Downloader.

#### Scenario: Protocol registration in packaged app

- **WHEN** the packaged desktop application starts on a supported platform
- **THEN** it registers itself as the default handler for the `armgddn://` protocol (where supported by the OS)
- **AND** subsequent `armgddn://...` links open ARMGDDN Downloader instead of a generic browser dialog.

#### Scenario: Development mode protocol registration

- **WHEN** the app is launched in development mode (e.g., via `electron .`)
- **THEN** it still attempts to register the `armgddn` protocol using the current executable path
- **AND** deep links opened while the dev instance is running are routed to that instance.

### Requirement: Single-Instance Deep Link Routing

The application SHALL enforce a single running instance and route new deep-link activations to the existing window instead of starting a second app instance.

#### Scenario: Second instance forwards deep link

- **WHEN** a second instance of ARMGDDN Downloader is launched due to a user clicking an `armgddn://...` link
- **THEN** the second instance immediately exits
- **AND** the existing instance's main window is restored (if minimized or hidden)
- **AND** the deep-link URL is delivered to that main instance for processing.

#### Scenario: Deep link while app is hidden to tray

- **WHEN** the app is running but its main window is hidden to the system tray
- **AND** the user clicks an `armgddn://...` link
- **THEN** the existing instance handles the deep link
- **AND** the main window is shown and focused so the user can see the new download.

### Requirement: Deep Link Validation

The app SHALL validate incoming deep-link URLs before acting on them, rejecting malformed or unexpected values.

- Only URLs with protocol `armgddn:` SHALL be accepted.
- Only a whitelisted set of hosts (e.g. `download`, `open`) SHALL be processed; any other host SHALL be rejected.
- The `manifest` query parameter, if present, SHALL be treated as an opaque value and inspected for obvious corruption before use.

#### Scenario: Invalid protocol is rejected

- **WHEN** the OS delivers a URL with a protocol other than `armgddn:` to the app
- **THEN** the app SHALL reject the URL without starting any download
- **AND** the rejection SHALL be logged to the debug log for troubleshooting.

#### Scenario: Unknown host is rejected

- **WHEN** a deep link is received with host `armgddn://something-else?...`
- **THEN** the app SHALL ignore the link for download purposes
- **AND** a diagnostic line SHALL be written to the debug log noting the invalid host.

#### Scenario: Missing manifest parameter is rejected

- **WHEN** a deep link is received without a `manifest` parameter
- **THEN** the app SHALL reject the link as invalid
- **AND** it SHALL NOT attempt to contact the server for a manifest.

### Requirement: Renderer Receives Deep Link Events

The main process SHALL forward validated deep-link URLs into the renderer process so that the UI layer can coordinate manifest fetch and download start.

#### Scenario: Deep link forwarded to renderer

- **WHEN** a deep link passes protocol and host validation in the main process
- **THEN** the main process emits a `deep-link` event over IPC to the renderer
- **AND** the renderer's registered callback receives the original deep-link URL string.

### Requirement: Manifest URL Extraction and Logging

The renderer SHALL extract the manifest URL and authentication token from the deep-link URL, perform basic decoding, and log key components for troubleshooting before asking the main process to fetch the manifest.

#### Scenario: Manifest URL and token are parsed from deep link

- **WHEN** the renderer receives a `deep-link` event for a URL of the form `armgddn://download?manifest=...&token=...`
- **THEN** it parses the URL
- **AND** it extracts the `manifest` parameter as a string representing the manifest endpoint URL
- **AND** it extracts the optional `token` parameter for authentication
- **AND** it logs both the raw and decoded manifest value for debugging.

#### Scenario: Missing manifest produces user-facing error

- **WHEN** the renderer handles a deep link that does not contain a `manifest` parameter
- **THEN** it SHALL show a clear error message to the user (e.g., via an alert) indicating that the download link is invalid
- **AND** it SHALL NOT call into the manifest fetch API.

### Requirement: Secure Manifest Fetch in Main Process

Given a manifest URL and token from the renderer, the main process SHALL securely fetch the manifest JSON from the ARMGDDN server over HTTPS.

- Only `https://` manifest URLs SHALL be accepted; all other schemes SHALL be rejected with a clear error.
- The manifest URL's query string SHALL be parsed into a `remote` and `path` parameter.
- If either `remote` or `path` is missing, the manifest fetch SHALL fail with a descriptive error.
- The manifest request SHALL be sent as an HTTPS POST with JSON body `{ remote, path }`.
- When a token is provided, it SHALL be attached as an `Authorization: Bearer <token>` header.

#### Scenario: Successful manifest fetch

- **WHEN** the renderer calls `fetchManifest` with a valid `https://` manifest URL and token
- **AND** the server responds with a JSON body describing the download
- **THEN** the main process parses the JSON
- **AND** returns the parsed manifest object back to the renderer
- **AND** logs the manifest response in the debug log (truncated as appropriate for size).

#### Scenario: Manifest fetch fails due to missing parameters

- **WHEN** the manifest URL query string does not contain both `remote` and `path`
- **THEN** the main process rejects the manifest fetch with an error explaining which parameter is missing
- **AND** the error message includes the raw query string for debugging (but not sensitive tokens).

#### Scenario: Manifest fetch enforces HTTPS

- **WHEN** the renderer passes a manifest URL that does not use the `https:` scheme
- **THEN** the main process rejects the request with a security error indicating that only HTTPS connections are allowed
- **AND** it SHALL NOT attempt any network call for that URL.

### Requirement: Manifest-Level Redirect Handling

The manifest API MAY instruct the downloader to retry a different remote/path location (for example, if a game has moved). The downloader SHALL support this via a manifest-level redirect.

#### Scenario: Server instructs redirect to new location

- **WHEN** the manifest response JSON includes a redirect indicator with `redirect: true` and non-empty `newRemote` and `newPath` fields
- **THEN** the downloader constructs a new manifest URL using the same hostname and path as the original
- **AND** it replaces the `remote` and `path` query parameters with the server-provided `newRemote` and `newPath`
- **AND** it retries the manifest fetch once from this new location.

#### Scenario: Redirect failure leads to descriptive error

- **WHEN** the downloader retries a manifest fetch from the server-provided `newRemote` and `newPath`
- **AND** that retry fails (e.g., due to network or server error)
- **THEN** the downloader rejects the overall manifest fetch with an error message indicating that the game was moved but the new location could not be loaded
- **AND** the original error from the retry attempt is included in the debug logs for diagnosis.
