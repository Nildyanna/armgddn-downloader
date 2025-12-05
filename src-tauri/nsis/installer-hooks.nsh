; Custom NSIS hooks for ARMGDDN Downloader
; This file adds protocol registration to the default Tauri installer

!macro customInstall
  ; Register armgddn:// protocol
  WriteRegStr HKCR "armgddn" "" "URL:ARMGDDN Protocol"
  WriteRegStr HKCR "armgddn" "URL Protocol" ""
  WriteRegStr HKCR "armgddn\DefaultIcon" "" "$INSTDIR\ARMGDDN Downloader.exe,0"
  WriteRegStr HKCR "armgddn\shell\open\command" "" '"$INSTDIR\ARMGDDN Downloader.exe" "%1"'
!macroend

!macro customUnInstall
  ; Unregister armgddn:// protocol
  DeleteRegKey HKCR "armgddn"
!macroend
