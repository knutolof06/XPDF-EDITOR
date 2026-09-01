!macro customInstall
  DetailPrint "Registering PDF Explorer Thumbnail Handler..."
  ExecWait 'regsvr32.exe /s "$INSTDIR\resources\tools\thumbnail-provider\PdfThumbHandler.dll"'
  WriteRegStr HKCU "Software\Classes\.pdf\ShellEx\{e357fccd-a995-4576-b01f-234630154e96}" "" "{3AF5A38C-78A5-4CE1-BCE5-6421BF94DCAD}"
  WriteRegStr HKCU "Software\Classes\SystemFileAssociations\.pdf\ShellEx\{e357fccd-a995-4576-b01f-234630154e96}" "" "{3AF5A38C-78A5-4CE1-BCE5-6421BF94DCAD}"
  WriteRegStr HKCU "Software\Classes\PDF Document\ShellEx\{e357fccd-a995-4576-b01f-234630154e96}" "" "{3AF5A38C-78A5-4CE1-BCE5-6421BF94DCAD}"
!macroend

!macro customUnInstall
  ExecWait 'regsvr32.exe /u /s "$INSTDIR\resources\tools\thumbnail-provider\PdfThumbHandler.dll"'
  DeleteRegKey HKCU "Software\Classes\.pdf\ShellEx\{e357fccd-a995-4576-b01f-234630154e96}"
  DeleteRegKey HKCU "Software\Classes\SystemFileAssociations\.pdf\ShellEx\{e357fccd-a995-4576-b01f-234630154e96}"
  DeleteRegKey HKCU "Software\Classes\PDF Document\ShellEx\{e357fccd-a995-4576-b01f-234630154e96}"
!macroend
