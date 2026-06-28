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

  ; Try preferred method: re-run as current user without elevation
  Push "$EXEPATH"
  Push "open"
  Push "/S /armgddnbootstrapped=1"
  StdUtils::ExecShellAsUser /NOUNLOAD
  Pop $7
  StrCmp $7 "0" quitok execshell_fail

  execshell_fail:
    ; ExecShellAsUser failed - use direct Exec (we're already the current user)
    Exec '"$EXEPATH" /S /armgddnbootstrapped=1'
    StrCmp "" "" quitok runonce_fallback

  runonce_fallback:
    ; Last resort: schedule via RunOnce registry key (runs on next login)
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\RunOnce" "ARMGDDNCompanionUpdate" '"$EXEPATH" /S /armgddnbootstrapped=1'

  quitok:
    !insertmacro quitSuccess

  done:
!macroend

!macro customInstall
  ; After silent bootstrapped install, relaunch the app
  IfSilent 0 done_install
  ${GetParameters} $0
  ClearErrors
  ${GetOptions} $0 "/armgddnbootstrapped=" $6
  ${IfNot} ${Errors}
    StrCmp $6 "1" relaunch done_install
  ${EndIf}
  Goto done_install

  relaunch:
    Exec '"$INSTDIR\ARMGDDN Companion.exe"'

  done_install:
!macroend