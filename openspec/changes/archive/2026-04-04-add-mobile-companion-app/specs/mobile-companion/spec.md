# mobile-companion Specification

## ADDED Requirements

### Requirement: Cross-Platform Mobile Companion App

The system SHALL provide a mobile Companion application built for Android and iOS using a shared codebase.

#### Scenario: Mobile app supports both major mobile platforms

- **WHEN** the mobile Companion is built for release
- **THEN** it SHALL target Android and iOS from the same project
- **AND** it SHALL present the same Companion branding and download handoff purpose on both platforms.

### Requirement: Mobile Deep-Link Handoff

The mobile Companion SHALL accept the same `armgddn://download` handoff used by the browser for desktop Companion downloads.

#### Scenario: Mobile app receives a browser handoff

- **WHEN** the browser opens an `armgddn://download?...` URL on a mobile device
- **THEN** the mobile Companion SHALL parse the deep link
- **AND** it SHALL resolve the browser-issued download token into a manifest URL using the existing server contract
- **AND** it SHALL continue the download flow without requiring a separate mobile-only backend.

### Requirement: Mobile Manifest Fetch and Download Start

The mobile Companion SHALL fetch the download manifest from the ARMGDDN server and begin downloading the referenced files when a valid handoff is received.

#### Scenario: Valid handoff starts a mobile download

- **WHEN** the mobile Companion receives a valid download token and app token
- **THEN** it SHALL resolve the token into a manifest URL
- **AND** it SHALL fetch the manifest over HTTPS
- **AND** it SHALL begin downloading the file set described by the manifest.

### Requirement: Mobile Download Progress UI

The mobile Companion SHALL show basic download state and progress while downloads are running.

#### Scenario: User sees download status on mobile

- **WHEN** a download is in progress on the mobile Companion
- **THEN** the app SHALL display the current download state, progress, and error status if one occurs
- **AND** the UI SHALL remain usable while the download is active.
