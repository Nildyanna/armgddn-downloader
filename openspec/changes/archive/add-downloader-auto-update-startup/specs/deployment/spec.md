# deployment Delta

## ADDED Requirements

### Requirement: Startup Registration
The packaged application SHALL support user-controlled registration to start on OS login.

#### Scenario: User enables start with OS startup
- **WHEN** the user enables `Start with OS startup`
- **THEN** the app registers itself to start on login using the platform-appropriate mechanism
- **AND** the user can disable the setting to remove the registration.

### Requirement: Silent Windows Installer Mode (User-Consented)
The Windows NSIS installer SHALL support a silent install mode that can be invoked via a documented flag.

#### Scenario: NSIS silent install invocation
- **WHEN** the installer is launched with the `/S` flag
- **THEN** installation proceeds without interactive prompts
- **AND** the installer exits with a success or failure code.
