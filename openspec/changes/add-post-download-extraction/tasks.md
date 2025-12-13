# Tasks: add-post-download-extraction

## Spec and Validation

- [ ] Add spec deltas for `download-engine` and `desktop-ui`.
- [ ] Validate the change strictly: `openspec validate add-post-download-extraction --strict`.

## Settings + Persistence

- [ ] Add a new persisted setting (default OFF): `extract7zAfterDownload`.
- [ ] Expose the setting in the Settings UI.
- [ ] Ensure settings migrations handle older config files (missing field).

## Extraction Behavior (Main Process)

- [ ] Detect `.7z` archives in the completed download directory.
- [ ] When extraction is enabled, run extraction after download completion and before final `completed` UI notification.
- [ ] Ensure extraction is restricted to the download directory (no writing outside target path).
- [ ] Ensure extraction errors are surfaced to the user and logged, without deleting downloaded content.
- [ ] Add a new download lifecycle state for extraction (e.g., `extracting`).

## Bundled 7z Binary

- [ ] Add a small platform-specific `7z` extraction binary to packaged `extraResources`.
- [ ] Resolve the `7z` path at runtime similarly to rclone path resolution.
- [ ] Add license/attribution for the bundled `7z` binary.

## UI Integration

- [ ] Display `Extracting` status in the downloads list when post-processing is running.
- [ ] On extraction failure, show a clear extraction error state/message while keeping the download accessible.
- [ ] Ensure `Open Folder` still opens the download folder.

## QA

- [ ] Happy path: download completes, extraction runs, extracted content present.
- [ ] Disabled path: download completes, no extraction.
- [ ] Failure path: extraction binary missing / extraction command fails.
- [ ] Large archive performance sanity check (UI still responsive).
