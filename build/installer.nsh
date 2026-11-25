!macro customInstall
  ; Write Control Panel Icon for XPDF Editor
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\com.xpdf.editor" "DisplayIcon" "$INSTDIR\XPDF Editor.exe,0"
!macroend

!macro customUnInstall
  ; Electron-builder handles removing com.xpdf.editor registry keys and file associations cleanly.
!macroend
