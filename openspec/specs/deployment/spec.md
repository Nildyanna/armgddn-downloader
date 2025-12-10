# deployment Specification

## Purpose

Define how the ARMGDDN Downloader Electron application is built, packaged, and distributed across platforms, including how rclone binaries and protocol handlers are wired into installers.

## Requirements

### Requirement: Build Prerequisites

The project SHALL document and rely on a minimal set of tooling for development builds and production packaging.

#### Scenario: Development build

- **WHEN** a developer runs `npm install` followed by `npm start` from the project root
- **THEN** the Electron app launches in development mode using `main.js` as the entry point
- **AND** the renderer loads `renderer/index.html` with `renderer/renderer.js`.

#### Scenario: Production build commands

- **WHEN** a maintainer wants to build production artifacts for the current platform
- **THEN** they can run `npm run build`
- **AND** for platform-specific builds, `npm run build:win`, `npm run build:linux`, or `npm run build:mac` exist and invoke electron-builder with appropriate targets.

### Requirement: Electron-Builder Configuration

The application SHALL use electron-builder configuration in `package.json` to define product identity, output locations, and platform targets.

#### Scenario: Stable app identity

- **WHEN** electron-builder runs using the repo configuration
- **THEN** the app id is `com.armgddn.downloader`
- **AND** the product name is `ARMGDDN Downloader`
- **AND** build artifacts are written under the `dist/` directory by default.

#### Scenario: Windows packaging targets

- **WHEN** building for Windows via electron-builder
- **THEN** an NSIS installer (`.exe`) is produced
- **AND** the Windows build uses `assets/icon.ico` for installer and app icons
- **AND** the NSIS configuration allows changing the installation directory.

#### Scenario: Linux packaging targets

- **WHEN** building for Linux via electron-builder
- **THEN** at least an AppImage and a Deb package are produced
- **AND** the Linux build uses `assets/icon.png` as the app icon
- **AND** the desktop category is `Utility`.

#### Scenario: macOS packaging targets

- **WHEN** building for macOS via electron-builder
- **THEN** a DMG image is produced
- **AND** the macOS build uses `assets/skull-logo-512.png` as the app icon
- **AND** the app category is `public.app-category.utilities`.

### Requirement: Bundled rclone Binaries

The deployment configuration SHALL bundle platform-specific rclone binaries with the packaged app so that downloads work offline without separate installation.

#### Scenario: Windows rclone resources

- **WHEN** building for Windows
- **THEN** the contents of `rclone/win32` are included in the packaged app under a `rclone/` directory
- **AND** the runtime rclone path resolution in `main.js` locates `rclone/rclone.exe` from the app resources.

#### Scenario: Linux rclone resources

- **WHEN** building for Linux
- **THEN** the contents of `rclone/linux` are included in the packaged app under a `rclone/` directory
- **AND** the runtime rclone path resolution in `main.js` locates `rclone/rclone` from the app resources.

#### Scenario: macOS rclone resources

- **WHEN** building for macOS
- **THEN** the contents of `rclone/darwin` are included in the packaged app under a `rclone/` directory
- **AND** the runtime rclone path resolution in `main.js` locates `rclone/rclone` from the app resources.

### Requirement: Custom Protocol Registration in Installers

The packaged application SHALL register the `armgddn` custom protocol so that deep links from ARMGDDN Browser can launch or focus the downloader.

#### Scenario: Protocol metadata in build config

- **WHEN** electron-builder runs with the configured `protocols` section
- **THEN** the product registers a protocol named `ARMGDDN Protocol` with the `armgddn` scheme
- **AND** on supported platforms, `armgddn://...` links are routed to the ARMGDDN Downloader executable.

### Requirement: Release Artifacts for Update System

The deployment process SHALL produce release artifacts that are compatible with the update-system expectations and GitHub Releases workflow.

#### Scenario: Windows release artifacts

- **WHEN** a Windows release is published to GitHub
- **THEN** it includes at least one `.exe` installer asset
- **AND** the file name follows a stable convention (e.g., includes product name and version) so the update system can detect it via `.exe` extension.

#### Scenario: Linux release artifacts

- **WHEN** a Linux release is published to GitHub
- **THEN** it includes at least one `.AppImage` asset and/or a `.deb` asset
- **AND** the update system can select the `.AppImage` or `.deb` by file extension.

#### Scenario: macOS release artifacts

- **WHEN** a macOS release is published to GitHub
- **THEN** it includes at least one `.dmg` asset
- **AND** the update system can select it by `.dmg` extension.

### Requirement: Configuration of Download Location and UserData

The deployment SHALL rely on Electron's `userData` directory and a configurable download path, without requiring manual configuration files from end users.

#### Scenario: First-run defaults

- **WHEN** the app runs for the first time on a new machine
- **THEN** it chooses a default download location under the OS Downloads folder (e.g., `Downloads/ARMGDDN`)
- **AND** it creates configuration, session, history, and log files under the Electron `userData` directory as needed.

#### Scenario: Preserving user configuration across updates

- **WHEN** a user installs a newer version of ARMGDDN Downloader over an existing installation
- **THEN** previously saved settings and history stored under `userData` remain intact
- **AND** the new version continues to read and write to the same `userData` path.
