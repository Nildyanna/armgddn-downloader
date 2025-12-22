# Auto-Update Setup Guide

This guide explains how to set up auto-updates for the ARMGDDN Companion app.

## Overview

The app checks GitHub Releases to determine whether a newer installer is available.

## How Auto-Update Works

### For Users

1. **On App Startup**: The app silently checks for updates in the background
2. **Manual Check**: Users can click "🔄 Check for Updates" button
3. **Update Available**: A dialog appears asking if they want to download and install
4. **Download**: Update downloads in the background with progress
5. **Install**: After download, user is prompted to restart the app
6. **Restart**: App relaunches with the new version

### For Developers

1. **Update Version**: Edit `package.json` `version` (e.g. `4.1.28`)
2. **Commit Changes**: `git commit -am "v4.1.28: ..."`
3. **Create Tag**: `git tag v4.1.28`
4. **Push Tag**: `git push origin v4.1.28`
5. **GitHub Actions / Releases**: Upload the built installers to that GitHub Release
6. **Users Get Update**: Next time users open the app or click "Check for Updates"

## Update Manifest

GitHub Actions automatically generates `latest.json` which contains:

- Version number
- Download URLs for each platform
- Cryptographic signatures
- Release notes

The app checks this file at:

```text
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
**Update doesn't appear**:

- Ensure the GitHub Release tag (e.g. `v4.1.28`) is higher than the installed app version
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
