# ARMGDDN Companion Mobile

> **Retired (2026-10-30).** The Android app is no longer built or released: Companion is Windows, Linux and macOS only. The release workflow
> does not build an APK any more and releases carry no APK. This folder is kept for reference only.

Expo React Native mobile Companion for Android and iOS.

## What it does

- Receives `armgddn://download` handoff links from the browser.
- Resolves browser-issued download tokens into manifest URLs.
- Fetches the manifest from the same ARMGDDN server contract used by the desktop Companion.
- Downloads the files locally on the device and shows progress.
- On Android, writes downloads into a user-approved public folder (choose Downloads/ARMGDDN Downloads when prompted).
- Detects `.7z` files after download; automatic extraction is currently skipped in this mobile build.

## Run locally

```bash
npm install
npm run start
```

Then use the Expo QR/code flow to open the app in a simulator or on a device.

## Platform scripts

- `npm run android`
- `npm run ios`
- `npm run web`

## Notes

- The browser and server remain the source of truth for token minting and manifest generation.
- The mobile app is intentionally separate from the desktop Electron app so both can evolve independently.
