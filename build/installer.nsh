!macro CB_CHECK_APP_RUNNING
  nsExec::Exec '"$SYSDIR\cmd.exe" /C tasklist /FI "USERNAME eq %USERNAME%" /FI "IMAGENAME eq ${APP_EXECUTABLE_FILENAME}" /FO CSV /NH | "$SYSDIR\findstr.exe" /B /I /C:"\"${APP_EXECUTABLE_FILENAME}\""'
  Pop $R0
  ${If} $R0 == 0
    ${IfNot} ${Silent}
    ${AndIfNot} ${isUpdated}
      MessageBox MB_YESNO|MB_ICONEXCLAMATION "检测到 ${PRODUCT_NAME} 正在运行中。$\r$\n$\r$\n为避免文件占用导致安装或卸载失败，请先关闭 ${PRODUCT_NAME}。$\r$\n点击「是」将尝试自动关闭程序并继续，点击「否」取消操作。" /SD IDYES IDYES +2
      Quit
    ${ElseIf} ${isUpdated}
      Sleep 500
    ${EndIf}

    nsExec::Exec '"$SYSDIR\taskkill.exe" /FI "USERNAME eq %USERNAME%" /IM "${APP_EXECUTABLE_FILENAME}"'
    Pop $R0
    Sleep 800

    StrCpy $R1 0
    ${Do}
      nsExec::Exec '"$SYSDIR\cmd.exe" /C tasklist /FI "USERNAME eq %USERNAME%" /FI "IMAGENAME eq ${APP_EXECUTABLE_FILENAME}" /FO CSV /NH | "$SYSDIR\findstr.exe" /B /I /C:"\"${APP_EXECUTABLE_FILENAME}\""'
      Pop $R0
      ${If} $R0 != 0
        ${ExitDo}
      ${EndIf}

      nsExec::Exec '"$SYSDIR\taskkill.exe" /F /FI "USERNAME eq %USERNAME%" /IM "${APP_EXECUTABLE_FILENAME}"'
      Pop $R0
      Sleep 800

      nsExec::Exec '"$SYSDIR\cmd.exe" /C tasklist /FI "USERNAME eq %USERNAME%" /FI "IMAGENAME eq ${APP_EXECUTABLE_FILENAME}" /FO CSV /NH | "$SYSDIR\findstr.exe" /B /I /C:"\"${APP_EXECUTABLE_FILENAME}\""'
      Pop $R0
      ${If} $R0 != 0
        ${ExitDo}
      ${EndIf}

      IntOp $R1 $R1 + 1
      ${If} $R1 >= 2
        MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "无法自动关闭正在运行的 ${PRODUCT_NAME}（可能正以更高权限运行）。$\r$\n请手动关闭程序后点击「重试」，或点击「取消」退出。" /SD IDCANCEL IDRETRY +2
        Quit
        StrCpy $R1 0
      ${EndIf}
    ${Loop}
  ${EndIf}
!macroend

!macro preInit
  !ifndef BUILD_UNINSTALLER
    ${IfNot} ${UAC_IsInnerInstance}
      System::Call 'kernel32::CreateMutex(p 0, i 1, t "Local\ChatBeauty_Setup_SingleInstance") ?e'
      Pop $R0
      ${If} $R0 == 183
        StrCpy $1 ""
        StrLen $0 "$(^SetupCaption)"
        IntOp $0 $0 + 1
        ${Do}
          FindWindow $1 "#32770" "" "" $1
          ${If} $1 == 0
          ${OrIf} $1 == ""
            ${ExitDo}
          ${EndIf}
          System::Call 'user32::GetWindowText(p r1, t .r2, i r0)'
          ${If} $2 == "$(^SetupCaption)"
            SendMessage $1 0x112 0xF120 0 /TIMEOUT=2000
            System::Call 'user32::SetForegroundWindow(p r1)'
            ${ExitDo}
          ${EndIf}
        ${Loop}
        ${IfNot} ${Silent}
          MessageBox MB_OK|MB_ICONEXCLAMATION "ChatBeauty 安装程序已在运行中，请勿同时打开多个安装窗口。" /SD IDOK
        ${EndIf}
        Abort
      ${EndIf}
    ${EndIf}
  !endif
!macroend

!macro customInit
  !ifndef BUILD_UNINSTALLER
    ${IfNot} ${UAC_IsInnerInstance}
    ${AndIfNot} ${Silent}
      !insertmacro CB_CHECK_APP_RUNNING
    ${EndIf}
  !endif
!macroend

!macro customCheckAppRunning
  !insertmacro CB_CHECK_APP_RUNNING
!macroend

!macro customUnInit
  ${IfNot} ${UAC_IsInnerInstance}
    System::Call 'kernel32::CreateMutex(p 0, i 1, t "Local\ChatBeauty_Uninstaller_SingleInstance") ?e'
    Pop $R0
    ${If} $R0 == 183
      ${IfNot} ${Silent}
        MessageBox MB_OK|MB_ICONEXCLAMATION "ChatBeauty 卸载程序已在运行中，请勿同时打开多个卸载窗口。" /SD IDOK
      ${EndIf}
      Abort
    ${EndIf}
  ${EndIf}
  !insertmacro CB_CHECK_APP_RUNNING
!macroend

!macro customInstall
  !ifndef DO_NOT_CREATE_START_MENU_SHORTCUT
    ${IfNot} ${FileExists} "$newStartMenuLink"
      !insertmacro createMenuDirectory
      CreateShortCut "$newStartMenuLink" "$appExe" "" "$appExe" 0 "" "" "${APP_DESCRIPTION}"
      ClearErrors
      WinShell::SetLnkAUMI "$newStartMenuLink" "${APP_ID}"
      System::Call 'Shell32::SHChangeNotify(i 0x8000000, i 0, i 0, i 0)'
    ${EndIf}
  !endif
!macroend
