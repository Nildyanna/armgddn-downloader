# Implementation Tasks

- [x] Define the signature artifact convention for releases (e.g. `<asset>.sig` alongside installer asset).
- [x] Add a pinned public key to the main process (not renderer) for signature verification.
- [x] Update `install-update` flow to:
  - [x] Download installer to the existing platform-specific download directory.
  - [x] Download the signature artifact over HTTPS with the same update host allowlist and redirect limits.
  - [x] Verify the installer bytes against the signature before executing/opening the installer.
  - [x] If verification fails or signature is missing, do not execute; guide the user to manual installation.
- [x] Update renderer error handling to treat signature failures as a one-time manual update path (open release URL).
- [x] Update OpenSpec `update-system` capability via spec delta.
- [x] Validate OpenSpec change: `openspec validate add-signed-update-verification --strict`.
