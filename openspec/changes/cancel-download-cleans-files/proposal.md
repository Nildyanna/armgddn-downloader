# Cancel download cleans up files

Cancelling a Companion download currently stops its rclone processes but leaves partial and completed files from that request in the target folder. Make cancellation remove files produced by the canceled request while preserving files that were already complete before it began.

## Scope

- Wait for active transfers and in-flight file tasks to stop before cleanup.
- Delete only safe, manifest-listed files inside the request's download folder.
- Preserve pre-existing complete files and files another active request still owns.
- Explain this behavior in the cancel confirmation.

## Impact

The download engine and desktop UI change. No server API or database changes are required.
