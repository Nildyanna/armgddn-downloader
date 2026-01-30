# update-system Specification Delta

## ADDED Requirements

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

## MODIFIED Requirements

### Requirement: Installer Download and Execution

The application SHALL download and launch the installer when the user opts into an automatic update and an installer URL is available.

#### Scenario: Installer execution requires prior verification

- **WHEN** running an automatic update install
- **THEN** execution/opening of the installer is gated on successful signed installer verification.
