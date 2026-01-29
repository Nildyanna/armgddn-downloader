# Add Signed Update Verification

## Problem

The current update system relies on HTTPS plus an allowlist of update hosts when downloading installers. This reduces exposure, but it does not provide cryptographic integrity or authenticity guarantees for the downloaded installer.

If a trusted host is compromised, a release asset is replaced, or a network attacker can influence content delivery despite HTTPS, the app could download and execute a malicious installer.

## Solution

Introduce signed-update verification for automatic installs.

- The updater downloads the installer as it does today.
- It also downloads a signature artifact for that installer.
- Signature naming convention: download the signature from `<installerUrl>.sig`.
- The app verifies the installer payload against the signature using an embedded public key.
- Only if verification succeeds will the updater execute/open the installer.
- If verification fails or the signature is missing, the updater falls back to manual installation (open release page / show installer location) and returns a clear error to the renderer.
- Network safety bounds: update checks and downloads use timeouts and response/installer size caps, and partial installer downloads are cleaned up on error/abort.
- Update host safety: installer/signature downloads are restricted to an allowlist of GitHub release/CDN hosts.

## Impact

- **Security**: Substantially strengthens the update trust chain (integrity + authenticity).
- **Release process**: Requires publishing signatures alongside installer assets.
- **User Experience**: Automatic update remains seamless when signatures exist; otherwise the app guides users through a one-time manual update path.
