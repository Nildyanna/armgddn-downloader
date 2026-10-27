## MODIFIED Requirements

### Requirement: Pause and Cancel Behavior

The engine SHALL support pausing and cancelling downloads initiated by the user.

- Cancelling a download SHALL:
  - Mark the download as `cancelled`.
  - Set a flag so that no new files are started.
  - Attempt to terminate all active rclone processes and wait for in-flight file tasks to stop.
  - Delete files belonging to this request, including partial files, after transfers stop.
  - Preserve files that were already complete on disk before this request started.
  - Avoid deleting a file another active download still owns in a shared target folder.
  - Emit a `download-cancelled` event to the renderer after cleanup.
- Pausing a download SHALL:
  - Mark the download as `paused`.
  - Attempt to terminate active rclone processes for the current files.
  - Leave already-completed files on disk.

#### Scenario: User cancels an active download

- **WHEN** the renderer requests cancellation for an in-progress download
- **THEN** the engine marks the download as `cancelled`
- **AND** terminates all active rclone processes for that download
- **AND** waits for any in-flight file tasks to stop before removing their output files
- **AND** deletes files produced by this request, including partial files
- **AND** preserves files that were already complete before this request started
- **AND** notifies the renderer that the download was cancelled so the UI can remove it from the list or update its status.
