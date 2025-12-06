; Custom NSIS hooks for ARMGDDN Downloader
; This file adds protocol registration to the default Tauri installer

!macro customInstall
  ; Kill any running instances before installing
  nsExec::ExecToLog 'taskkill /F /IM "ARMGDDN Downloader.exe"'
  Sleep 1000
  
  ; Force delete old files to prevent caching
  Delete "$INSTDIR\ARMGDDN Downloader.exe"
  Delete "$INSTDIR\*.dll"
  RMDir /r "$INSTDIR\resources"
  
  ; Clear app data cache
  RMDir /r "$APPDATA\com.armgddn.downloader\webview"
  RMDir /r "$LOCALAPPDATA\com.armgddn.downloader\webview"
  
  ; Register armgddn:// protocol in HKCU (doesn't require admin)
  WriteRegStr HKCU "Software\Classes\armgddn" "" "URL:ARMGDDN Protocol"
  WriteRegStr HKCU "Software\Classes\armgddn" "URL Protocol" ""
  WriteRegStr HKCU "Software\Classes\armgddn\DefaultIcon" "" "$INSTDIR\ARMGDDN Downloader.exe,0"
  WriteRegStr HKCU "Software\Classes\armgddn\shell\open\command" "" '"$INSTDIR\ARMGDDN Downloader.exe" "%1"'
  
  ; Also try HKCR for system-wide registration (may fail without admin, but that's ok)
  WriteRegStr HKCR "armgddn" "" "URL:ARMGDDN Protocol"
  WriteRegStr HKCR "armgddn" "URL Protocol" ""
  WriteRegStr HKCR "armgddn\DefaultIcon" "" "$INSTDIR\ARMGDDN Downloader.exe,0"
  WriteRegStr HKCR "armgddn\shell\open\command" "" '"$INSTDIR\ARMGDDN Downloader.exe" "%1"'
  
  ; Fix desktop shortcut icon
  SetOutPath "$INSTDIR"
  CreateShortcut "$DESKTOP\ARMGDDN Downloader.lnk" "$INSTDIR\ARMGDDN Downloader.exe" "" "$INSTDIR\ARMGDDN Downloader.exe" 0
!macroend

!macro customUnInstall
  ; Unregister armgddn:// protocol from both locations
  DeleteRegKey HKCU "Software\Classes\armgddn"
  DeleteRegKey HKCR "armgddn"
  
  ; Remove desktop shortcut
  Delete "$DESKTOP\ARMGDDN Downloader.lnk"
  
  ; Remove all app data (but don't remove install dir - Tauri handles that)
  RMDir /r "$APPDATA\com.armgddn.downloader"
  RMDir /r "$LOCALAPPDATA\com.armgddn.downloader"
!macroend
