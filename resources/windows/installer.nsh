; electron-builder NSIS hooks: put <install>\bin (shovel.cmd) on PATH.
; Per-user installs use the user PATH, per-machine installs the system PATH.
; The PATH itself is edited by windows-path.ps1 (also used by the app's settings dialog),
; which avoids NSIS's string length limit truncating a long PATH.

!macro shovelEditPath ACTION SCOPE
  nsExec::Exec '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$INSTDIR\resources\cli\windows-path.ps1" -Action ${ACTION} -Scope ${SCOPE} -Dir "$INSTDIR\bin"'
  Pop $0
!macroend

!macro customInstall
  ${if} $installMode == "all"
    !insertmacro shovelEditPath add Machine
  ${else}
    !insertmacro shovelEditPath add User
  ${endif}
!macroend

!macro customUnInstall
  ${ifNot} ${isUpdated}
    ; The settings dialog only ever adds to the user PATH.
    !insertmacro shovelEditPath remove User
    ${if} $installMode == "all"
      !insertmacro shovelEditPath remove Machine
    ${endif}
  ${endif}
!macroend
