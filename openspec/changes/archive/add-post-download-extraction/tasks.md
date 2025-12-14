# Tasks: add-post-download-extraction

## Spec and Validation

- [x] Add spec deltas for `download-engine` and `desktop-ui`.
- [x] Validate the change strictly: `openspec validate add-post-download-extraction --strict`.

## Settings + Persistence

- [x] Add a new persisted setting (default OFF): `extract7zAfterDownload`.
- [x] Expose the setting in the Settings UI.
- [x] Ensure settings migrations handle older config files (missing field).

## Extraction Behavior (Main Process)

- [x] Detect `.7z` archives in the completed download directory.
- [x] When extraction is enabled, run extraction after download completion and before final `completed` UI notification.
- [x] Ensure extraction is restricted to the download directory (no writing outside target path).
- [x] Ensure extraction errors are surfaced to the user and logged, without deleting downloaded content.
- [x] Add a new download lifecycle state for extraction (e.g., `extracting`).

## Bundled 7z Binary

- [x] Add a small platform-specific `7z` extraction binary to packaged `extraResources`.
- [x] Resolve the `7z` path at runtime similarly to rclone path resolution.
- [x] Add license/attribution for the bundled `7z` binary.

## UI Integration

- [x] Display `Extracting` status in the downloads list when post-processing is running.
- [x] On extraction failure, show a clear extraction error state/message while keeping the download accessible.
- [x] Ensure `Open Folder` still opens the download folder.

## QA

- [x] Happy path: download completes, extraction runs, extracted content present.
- [x] Disabled path: download completes, no extraction.
- [x] Failure path: extraction binary missing / extraction command fails.
- [x] Large archive performance sanity check (UI still responsive).
