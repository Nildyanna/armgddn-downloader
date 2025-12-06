# Manual Uninstall Instructions

The installer is not properly replacing old files. Follow these steps:

## 1. Close the app completely
- Right-click system tray icon → Quit
- Or open Task Manager and end "ARMGDDN Downloader.exe"

## 2. Delete installation folder
Default location: `C:\Program Files\ARMGDDN Downloader`
Or: `C:\Users\[YourUsername]\AppData\Local\Programs\ARMGDDN Downloader`

Delete the entire folder.

## 3. Delete app data
- `C:\Users\[YourUsername]\AppData\Roaming\com.armgddn.downloader`
- `C:\Users\[YourUsername]\AppData\Local\com.armgddn.downloader`

Delete both folders.

## 4. Clear registry (optional but recommended)
Run in Command Prompt as Admin:
```
reg delete "HKCU\Software\Classes\armgddn" /f
reg delete "HKCR\armgddn" /f
```

## 5. Reinstall
Download and run the latest installer from GitHub releases.

You should now see the startup alert confirming the new version.
