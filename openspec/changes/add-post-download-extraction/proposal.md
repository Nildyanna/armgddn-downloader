# Change Proposal: add-post-download-extraction

## Summary

Add an optional post-download step that automatically extracts `.7z` archives into the user’s configured download location after a download completes successfully.

This capability will be controlled by a user setting (default OFF) and will ship with a lightweight bundled `7z` CLI that is used strictly for extraction.

## Motivation

- Users frequently download content that arrives as `.7z` archives.
- Manual extraction is error-prone and adds friction (especially for large multi-part downloads).
- Automating extraction improves the “download -> play” flow.

## Goals

- Provide a **Settings toggle** to enable/disable `.7z` extraction.
- After a successful download completion, if the resulting content includes one or more `.7z` archives, automatically extract them.
- Bundle a **minimal `7z` executable** per platform in the app package, used only for extraction.
- Keep the extracted content in the user’s configured download location.

## Non-Goals

- Supporting password-protected archives.
- Supporting archive formats beyond `.7z`.
- Providing a full archive management UI.

## User Experience

- A new setting `Extract .7z after download` is available in Settings.
- When enabled and a download finishes:
  - The download card transitions to an `Extracting` state.
  - On success, the download is marked `Completed`.
  - On failure, the download remains `Completed` but surfaces a clear extraction error in the UI (without deleting any downloaded files).

## Technical Notes

- The main process will spawn the bundled `7z` CLI (platform-specific) to perform extraction.
- Extraction should be a sequential post-processing step per completed download to avoid heavy CPU/disk contention.
- The binary must be resolved from packaged resources similarly to how `rclone` is resolved.

## Packaging Notes

- The build will include a lightweight `7z` CLI per platform (Windows, Linux, macOS) as an `extraResource`.
- The packaged binary is used strictly for extraction.

## Risks / Considerations

- Extraction can be slow and CPU intensive; the UI must clearly communicate the state.
- Extraction errors should not destroy a successfully completed download.
- Path traversal / unsafe extraction must be considered; extraction should target the download directory and avoid writing outside it.
