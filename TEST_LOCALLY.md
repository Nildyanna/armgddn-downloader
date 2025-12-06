# Test Locally on Windows

Instead of waiting for builds, test directly on your Windows machine:

## Option 1: Dev Mode (Fastest)
```powershell
# In the ArmgddnDownloader folder
npm install
npm run tauri dev
```

This opens the app in dev mode with hot reload. Any changes to the code will instantly update.

## Option 2: Local Build
```powershell
# Build locally
npm run tauri build
```

The built installer will be in:
`src-tauri/target/release/bundle/nsis/ARMGDDN Downloader_x.x.x_x64-setup.exe`

## What to check:
1. Does the alert appear in dev mode?
2. Open browser dev tools (F12) - are there any errors in the console?
3. Check the Network tab - is `index.html` and the JS file loading?

## If dev mode works but production doesn't:
The issue is in the build/bundling process, not the code itself.
