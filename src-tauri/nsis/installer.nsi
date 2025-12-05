!include MUI2.nsh
!include FileFunc.nsh
!include x64.nsh
!include WordFunc.nsh

!define MANUFACTURER "{{manufacturer}}"
!define PRODUCTNAME "{{product_name}}"
!define VERSION "{{version}}"
!define INSTALLMODE "{{install_mode}}"
!define LICENSE "{{license}}"
!define INSTALLERICON "{{installer_icon}}"
!define SIDEBARIMAGE "{{sidebar_image}}"
!define HEADERIMAGE "{{header_image}}"
!define MAINBINARYNAME "{{main_binary_name}}"
!define MAINBINARYSRCPATH "{{main_binary_path}}"
!define BUNDLEID "{{bundle_id}}"
!define COPYRIGHT "{{copyright}}"
!define OUTFILE "{{out_file}}"
!define ARCH "{{arch}}"
!define PLUGINSPATH "{{additional_plugins_path}}"
!define ALLOWDOWNGRADES "{{allow_downgrades}}"
!define INSTALLWEBVIEW2MODE "{{install_webview2_mode}}"
!define WEBVIEW2INSTALLERARGS "{{webview2_installer_args}}"
!define WEBVIEW2BOOTSTRAPPERPATH "{{webview2_bootstrapper_path}}"
!define WEBVIEW2INSTALLERPATH "{{webview2_installer_path}}"
!define UNINSTKEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCTNAME}"
!define MANUPRODUCTKEY "Software\${MANUFACTURER}\${PRODUCTNAME}"
!define UNINSTALLERSIGNCOMMAND "{{uninstaller_sign_cmd}}"
!define ESTIMATEDSIZE "{{estimated_size}}"

Name "${PRODUCTNAME}"
OutFile "${OUTFILE}"
Unicode true
SetCompressor /SOLID lzma

!if "${INSTALLMODE}" == "perMachine"
  RequestExecutionLevel admin
  InstallDir "$PROGRAMFILES64\${PRODUCTNAME}"
!else if "${INSTALLMODE}" == "currentUser"
  RequestExecutionLevel user
  InstallDir "$LOCALAPPDATA\${PRODUCTNAME}"
!endif

!include "StrFunc.nsh"

${StrCase}
${StrLoc}
${StrRep}
${StrTok}
${StrTrimNewLines}

!macro CheckIfAppIsRunning
  !define APP_EXECUTABLE "${MAINBINARYNAME}.exe"
  nsExec::ExecToStack 'TaskList /FI "IMAGENAME eq ${APP_EXECUTABLE}" /FO CSV /NH'
  Pop $0
  Pop $1
  ${If} $0 == 0
    ${StrLoc} $2 $1 "${APP_EXECUTABLE}" ">"
    ${If} $2 != ""
      MessageBox MB_OKCANCEL|MB_ICONEXCLAMATION "${PRODUCTNAME} is currently running. Please close it and try again." IDOK TryAgain IDCANCEL Cancel
      TryAgain:
        !insertmacro CheckIfAppIsRunning
      Cancel:
        Quit
    ${EndIf}
  ${EndIf}
!macroend

Function .onInit
  !if "${INSTALLMODE}" == "perMachine"
    ${If} ${RunningX64}
      ${If} "$INSTDIR" == "$PROGRAMFILES64\${PRODUCTNAME}"
        StrCpy $INSTDIR "$PROGRAMFILES64\${PRODUCTNAME}"
      ${EndIf}
    ${EndIf}
  !endif

  !insertmacro CheckIfAppIsRunning
FunctionEnd

!insertmacro MUI_PAGE_WELCOME
!ifdef LICENSE
  !insertmacro MUI_PAGE_LICENSE "${LICENSE}"
!endif
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "English"

Section "Install"
  SetOutPath $INSTDIR

  File /r "${MAINBINARYSRCPATH}\*"

  WriteUninstaller "$INSTDIR\uninstall.exe"

  WriteRegStr SHCTX "${UNINSTKEY}" "DisplayName" "${PRODUCTNAME}"
  WriteRegStr SHCTX "${UNINSTKEY}" "DisplayIcon" "$INSTDIR\${MAINBINARYNAME}.exe,0"
  WriteRegStr SHCTX "${UNINSTKEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr SHCTX "${UNINSTKEY}" "Publisher" "${MANUFACTURER}"
  WriteRegStr SHCTX "${UNINSTKEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr SHCTX "${UNINSTKEY}" "UninstallString" "$\"$INSTDIR\uninstall.exe$\""
  WriteRegDWORD SHCTX "${UNINSTKEY}" "NoModify" 1
  WriteRegDWORD SHCTX "${UNINSTKEY}" "NoRepair" 1
  WriteRegDWORD SHCTX "${UNINSTKEY}" "EstimatedSize" ${ESTIMATEDSIZE}

  ; Register armgddn:// protocol
  WriteRegStr HKCR "armgddn" "" "URL:ARMGDDN Protocol"
  WriteRegStr HKCR "armgddn" "URL Protocol" ""
  WriteRegStr HKCR "armgddn\DefaultIcon" "" "$INSTDIR\${MAINBINARYNAME}.exe,0"
  WriteRegStr HKCR "armgddn\shell\open\command" "" '"$INSTDIR\${MAINBINARYNAME}.exe" "%1"'

  CreateShortcut "$SMPROGRAMS\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
  CreateShortcut "$DESKTOP\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
SectionEnd

Section "Uninstall"
  !insertmacro CheckIfAppIsRunning

  RMDir /r "$INSTDIR"

  Delete "$SMPROGRAMS\${PRODUCTNAME}.lnk"
  Delete "$DESKTOP\${PRODUCTNAME}.lnk"

  DeleteRegKey SHCTX "${UNINSTKEY}"
  DeleteRegKey SHCTX "${MANUPRODUCTKEY}"
  
  ; Unregister armgddn:// protocol
  DeleteRegKey HKCR "armgddn"
SectionEnd
