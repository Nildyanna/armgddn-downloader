# session-and-auth Specification

## Purpose

Define how the ARMGDDN Downloader acquires, stores, validates, and exposes session/authentication state so that only authenticated ARMGDDN Browser users can initiate downloads and report progress.

## Requirements

### Requirement: Encrypted Session Persistence

The application SHALL persist session information securely on disk so that users do not need to log in on every launch, while respecting expiry.

- Session data SHALL be stored in a `session.json` file under the Electron `userData` directory.
- The stored record SHALL include at least `cookie` (or equivalent token string), `expiresAt`, and a boolean `encrypted` flag.
- When the platform's `safeStorage` encryption is available, the cookie/token value SHALL be encrypted before being written to disk and stored as base64-encoded data.
- When `safeStorage` encryption is not available, the cookie/token MAY be stored in plaintext, but SHALL still be wrapped in the same JSON structure.
- On load, expired sessions (past `expiresAt`) SHALL be ignored and discarded.

#### Scenario: Session is written with encryption

- **WHEN** the app saves a new session on a platform where `safeStorage` is available
- **THEN** it encrypts the cookie/token string with `safeStorage`
- **AND** stores the encrypted value as base64 in `session.json`
- **AND** sets `encrypted: true`.

#### Scenario: Session is read and decrypted

- **WHEN** the app starts and finds `session.json` with a non-expired record and `encrypted: true`
- **THEN** it base64-decodes the stored value
- **AND** decrypts it using `safeStorage`
- **AND** populates the in-memory session cookie/token for later use.

### Requirement: Session Acquisition via Embedded Browser Login

The downloader SHALL allow users to establish a session by logging into the ARMGDDN Browser site inside a dedicated authentication window.

- When a session is missing or invalid, the app SHALL be able to open a modal login window that loads the ARMGDDN Browser website.
- While this window is open, the app SHALL monitor cookies for the ARMGDDN Browser domain.
- When a suitable authentication cookie is detected (e.g., `tg_auth`, `session`, or `PHPSESSID`), the app SHALL construct a cookie string (or equivalent token) and persist it via the encrypted session mechanism.
- After a successful session capture, the login window SHALL close automatically.

#### Scenario: User logs in via embedded browser

- **WHEN** the user chooses to log in from the downloader
- **THEN** a modal login window opens pointing at the ARMGDDN Browser site
- **AND** after the user completes login, the app detects the presence of the session cookie(s)
- **AND** it saves a session record and closes the login window.

#### Scenario: Login window closes without session

- **WHEN** the user closes the login window without completing authentication
- **THEN** the app resolves the login attempt as unsuccessful
- **AND** no new session record is saved
- **AND** the connection status remains in a non-connected state.

### Requirement: Session Validation Against Server

The downloader SHALL validate its current session against the ARMGDDN backend before claiming that it is connected.

- Validation SHALL be performed by making an HTTPS request to an authentication status endpoint on the ARMGDDN Browser server.
- The request SHALL include the stored session credential in an `Authorization` header or other agreed mechanism.
- The app SHALL interpret a JSON response with an `authenticated: true` field as a valid session; any other response or error SHALL be treated as invalid.
- Network or parsing errors SHALL result in a conservative assumption of an invalid session.

#### Scenario: Session validated successfully

- **WHEN** a session cookie/token is present
- **AND** the auth-status endpoint responds with `{ "authenticated": true, ... }`
- **THEN** the app treats the session as valid
- **AND** the connection status exposed to the renderer indicates that the downloader is connected.

#### Scenario: Session validation fails

- **WHEN** a session cookie/token is present
- **AND** the auth-status request fails or returns JSON without `authenticated: true`
- **THEN** the app treats the session as invalid
- **AND** the connection status reflects that the app is not currently connected.

### Requirement: Session Status API to Renderer

The main process SHALL expose a simple session status API over IPC so the renderer can show an accurate connection indicator.

- The IPC handler for session status SHALL return an object including at least:
  - `hasSession`: whether an in-memory session credential is currently loaded.
  - `isValid`: the result of the most recent auth-status validation call.
- The renderer SHALL use this API to periodically refresh the UI connection badge.

#### Scenario: Renderer polls session status

- **WHEN** the renderer calls the session status API on startup and periodically thereafter
- **THEN** it receives `hasSession` and `isValid` flags
- **AND** it maps these flags to UI text such as `Connected` or `Awaiting First Download` as defined in the desktop UI specification.

### Requirement: Explicit Session Clearing

The app SHALL support clearing session state when needed.

- Clearing the session SHALL:
  - Delete the `session.json` file from disk if it exists.
  - Clear any in-memory session credential.
- After clearing, subsequent manifest fetches or progress reports that rely on the session SHALL be treated as unauthenticated unless a new session is acquired.

#### Scenario: Session is cleared due to error or user action

- **WHEN** the app decides to clear session state (e.g., after detecting persistent auth failures or via a future settings control)
- **THEN** it removes any `session.json` file
- **AND** resets in-memory session variables
- **AND** future session status checks indicate `hasSession: false` until a new login is performed.
