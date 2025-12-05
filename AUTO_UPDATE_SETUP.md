# Auto-Update Setup Guide

This guide explains how to set up auto-updates for the ARMGDDN Downloader app.

## Overview

The app uses Tauri's built-in updater plugin to check for updates from GitHub Releases. Updates are cryptographically signed to ensure security.

## One-Time Setup: Generate Signing Keys

You only need to do this once. The keys will be used to sign all future releases.

### 1. Install Tauri CLI (if not already installed)

```bash
cargo install tauri-cli
```

### 2. Generate Signing Keys

```bash
cd /home/armgddn/ArmgddnDownloader
cargo tauri signer generate -w ~/.tauri/armgddn-downloader.key
```

This will:
- Generate a private key and save it to `~/.tauri/armgddn-downloader.key`
- Display the public key in the terminal

### 3. Save the Public Key

Copy the public key output (it looks like `dW50cnVzdGVkIGNvbW1lbnQ6...`) and update it in `src-tauri/tauri.conf.json`:

```json
"updater": {
  "pubkey": "YOUR_PUBLIC_KEY_HERE"
}
```

**Note**: The current pubkey in the config is a placeholder. Replace it with your actual public key.

### 4. Add Secrets to GitHub

Go to your GitHub repository settings:
1. Navigate to **Settings** → **Secrets and variables** → **Actions**
2. Click **New repository secret**
3. Add two secrets:

**Secret 1: TAURI_SIGNING_PRIVATE_KEY**
- Name: `TAURI_SIGNING_PRIVATE_KEY`
- Value: Contents of `~/.tauri/armgddn-downloader.key` (the entire file)

**Secret 2: TAURI_SIGNING_PRIVATE_KEY_PASSWORD**
- Name: `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`  
- Value: The password you entered when generating the key (or leave empty if you didn't set one)

## How Auto-Update Works

### For Users

1. **On App Startup**: The app silently checks for updates in the background
2. **Manual Check**: Users can click "🔄 Check for Updates" button
3. **Update Available**: A dialog appears asking if they want to download and install
4. **Download**: Update downloads in the background with progress
5. **Install**: After download, user is prompted to restart the app
6. **Restart**: App relaunches with the new version

### For Developers

1. **Update Version**: Edit `src-tauri/Cargo.toml` and `src-tauri/tauri.conf.json`
2. **Commit Changes**: `git commit -am "Bump version to X.Y.Z"`
3. **Create Tag**: `git tag vX.Y.Z`
4. **Push Tag**: `git push origin vX.Y.Z`
5. **GitHub Actions**: Automatically builds, signs, and creates a release with `latest.json`
6. **Users Get Update**: Next time users open the app or click "Check for Updates"

## Update Manifest

GitHub Actions automatically generates `latest.json` which contains:
- Version number
- Download URLs for each platform
- Cryptographic signatures
- Release notes

The app checks this file at:
```
https://github.com/Nildyanna/armgddn-downloader/releases/latest/download/latest.json
```

## Security

- All updates are cryptographically signed with your private key
- The app verifies signatures using the public key before installing
- Updates are downloaded over HTTPS
- Users must confirm before downloading and installing

## Troubleshooting

**Update check fails**:
- Ensure GitHub repository is public or user has access
- Check that `latest.json` exists in the latest release
- Verify the public key in `tauri.conf.json` matches your generated key

**Signature verification fails**:
- Ensure GitHub secrets are set correctly
- Verify the private key hasn't been corrupted
- Check that the public key in the config matches the private key

**Update doesn't appear**:
- Ensure the version in `tauri.conf.json` is higher than the current version
- Check that the release is not marked as draft or prerelease
- Wait a few minutes for GitHub CDN to propagate the release

## Testing

To test auto-updates locally:

1. Build and install version 1.0.0
2. Update version to 1.0.1 in the code
3. Create a tag and push: `git tag v1.0.1 && git push origin v1.0.1`
4. Wait for GitHub Actions to complete
5. Open the installed app and click "Check for Updates"
6. Should see update dialog for version 1.0.1

## Version Numbering

Follow semantic versioning:
- **Major** (X.0.0): Breaking changes
- **Minor** (1.X.0): New features, backwards compatible
- **Patch** (1.0.X): Bug fixes, backwards compatible

Example: `1.0.0` → `1.0.1` (bug fix) → `1.1.0` (new feature) → `2.0.0` (breaking change)
