!include "LogicLib.nsh"
!include "FileFunc.nsh"

!macro customInit
  IfSilent 0 done

  ${GetParameters} $0
  ClearErrors
  ${GetOptions} $0 "/armgddnbootstrapped=" $6
  ${IfNot} ${Errors}
    StrCmp $6 "1" done
  ${EndIf}

  StrCpy $2 "$EXEDIR\armgddn-nsis-bootstrap.log"

  ClearErrors
  FileOpen $3 $2 w
  ${IfNot} ${Errors}
    FileWrite $3 "customInit start$\r$\n"
    FileWrite $3 "$CMDLINE$\r$\n"
    FileClose $3
  ${EndIf}

  Push "$EXEPATH"
  Push "open"
  Push "/S /armgddnbootstrapped=1"
  StdUtils::ExecShellAsUser /NOUNLOAD
  Pop $7

  ClearErrors
  FileOpen $3 $2 a
  ${IfNot} ${Errors}
    FileWrite $3 "execshell rc=$7$\r$\n"
    FileClose $3
  ${EndIf}

  StrCmp $7 "0" execshell_ok execshell_fail
  execshell_ok:
    !insertmacro quitSuccess
  execshell_fail:

  StrCpy $1 "$EXEDIR\armgddn-update-bootstrap.cmd"

  ClearErrors
  FileOpen $3 $2 a
  ${IfNot} ${Errors}
    FileWrite $3 "schtasks bootstrap start$\r$\n"
    FileClose $3
  ${EndIf}

  ClearErrors
  FileOpen $3 $1 w
  ${IfNot} ${Errors}
    FileWrite $3 "@echo off$\r$\n"
    FileWrite $3 "$\"$EXEPATH$\" /S /armgddnbootstrapped=1$\r$\n"
    FileWrite $3 "start $\"$\" $\"$INSTDIR\\${APP_EXECUTABLE_FILENAME}$\"$\r$\n"
    FileWrite $3 "$\"$SYSDIR\\schtasks.exe$\" /Delete /TN ARMGDDNCompanionUpdate /F >nul 2>&1$\r$\n"
    FileWrite $3 "del $\"%~f0$\" >nul 2>&1$\r$\n"
    FileClose $3
  ${EndIf}

  nsExec::ExecToStack '"$SYSDIR\\schtasks.exe" /Create /F /TN ARMGDDNCompanionUpdate /SC ONLOGON /RL LIMITED /TR "$1"'
  Pop $4
  Pop $5
  StrCmp $4 "0" 0 done

  nsExec::ExecToStack '"$SYSDIR\\schtasks.exe" /Run /TN ARMGDDNCompanionUpdate'
  Pop $4
  Pop $5
  StrCmp $4 "0" 0 done

  !insertmacro quitSuccess

  done:
!macroend
