# Why

Users want a Companion experience on phones and tablets, not just the existing desktop Electron app. The browser already issues the same tokenized download handoff used by desktop, so we can add a mobile client that reuses that flow instead of inventing a separate backend path.

## What Changes

- Add a new mobile Companion app built with Expo React Native.
- Reuse the existing deep-link handoff flow (`armgddn://download?...`) and token resolution flow.
- Fetch manifests from the same ARMGDDN server endpoints used by the desktop Companion.
- Download files locally on mobile using a native filesystem-backed implementation.
- Provide a mobile UI for connection state, manifest details, download progress, and basic error handling.

## Impact

- Affected specs: `mobile-companion`
- Affected code: new `mobile/` app directory, deep-link handling, manifest resolution, download orchestration, and app packaging/configuration.
