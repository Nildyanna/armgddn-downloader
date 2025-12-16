!include "LogicLib.nsh"

; Minimal substring check: sets $R9 to "1" if $R8 contains $R7, else "0".
Function _ArmgddnStrContains
  Exch $R7
  Exch 1
  Exch $R8

  StrCpy $R9 "0"
  StrLen $R6 $R7
  StrLen $R5 $R8
  StrCpy $R4 "0"

  loop:
    IntCmp $R4 $R5 done
    StrCpy $R3 $R8 $R6 $R4
    StrCmp $R3 $R7 found
    IntOp $R4 $R4 + 1
    Goto loop

  found:
    StrCpy $R9 "1"
    Goto done

  done:
    Pop $R7
    Exch $R9
FunctionEnd

!macro _ArmgddnStrContains OUT NEEDLE HAYSTACK
  Push "${HAYSTACK}"
  Push "${NEEDLE}"
  Call _ArmgddnStrContains
  Pop "${OUT}"
!macroend

!define ArmgddnStrContains '!insertmacro "_ArmgddnStrContains"'

!macro customInit
  IfSilent 0 done

  ${ArmgddnStrContains} $0 "armgddnbootstrapped" "$CMDLINE"
  StrCmp $0 "1" done

  StrCpy $1 "$TEMP\armgddn-update-bootstrap.cmd"
  StrCpy $2 "$TEMP\armgddn-nsis-bootstrap.log"

  ClearErrors
  FileOpen $3 $2 w
  ${IfNot} ${Errors}
    FileWrite $3 "bootstrap start$\r$\n"
    FileWrite $3 "$CMDLINE$\r$\n"
    FileClose $3
  ${EndIf}

  ClearErrors
  FileOpen $3 $1 w
  ${IfNot} ${Errors}
    FileWrite $3 "@echo off$\r$\n"
    FileWrite $3 "\"$EXEPATH\" /S /armgddnbootstrapped=1$\r$\n"
    FileWrite $3 "start \"\" \"$INSTDIR\\${APP_EXECUTABLE_FILENAME}\"$\r$\n"
    FileWrite $3 "\"$SYSDIR\\schtasks.exe\" /Delete /TN ARMGDDNCompanionUpdate /F >nul 2>&1$\r$\n"
    FileWrite $3 "del \"%~f0\" >nul 2>&1$\r$\n"
    FileClose $3
  ${EndIf}

  ; Create+run a scheduled task so the installer can rerun outside Electron's Job Object.
  nsExec::ExecToStack '"$SYSDIR\\schtasks.exe" /Create /F /TN ARMGDDNCompanionUpdate /SC ONLOGON /RL LIMITED /TR "$1"'
  Pop $4
  Pop $5

  nsExec::ExecToStack '"$SYSDIR\\schtasks.exe" /Run /TN ARMGDDNCompanionUpdate'
  Pop $4
  Pop $5

  !insertmacro quitSuccess

  done:
!macroend
