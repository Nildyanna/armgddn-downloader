# Implementation Tasks

- [ ] Define the signature artifact convention for releases (e.g. `<asset>.sig` alongside installer asset).
- [ ] Add a pinned public key to the main process (not renderer) for signature verification.
- [ ] Update `install-update` flow to:
  - [ ] Download installer to the existing platform-specific download directory.
  - [ ] Download the signature artifact over HTTPS with the same update host allowlist and redirect limits.
  - [ ] Verify the installer bytes against the signature before executing/opening the installer.
  - [ ] If verification fails or signature is missing, do not execute; guide the user to manual installation.
- [ ] Update renderer error handling to treat signature failures as a one-time manual update path (open release URL).
- [ ] Update OpenSpec `update-system` capability via spec delta.
- [ ] Validate OpenSpec change: `openspec validate add-signed-update-verification --strict`.
