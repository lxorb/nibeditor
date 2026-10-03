; Registers nibeditor the way Windows expects of an application other programs hand
; things to: a ProgID saying how to launch it, a Capabilities block listing what it
; handles, and an entry in RegisteredApplications so that it appears under
; Settings > Default apps as a browser for http and https links.
;
; The browser half is the values the app writes for itself when a copy got here
; without this installer, and the ones the MSI writes; src/default_browser.rs holds
; this file and wix/browser.wxs to them.
;
; No file type. Nib opens nothing from outside its spaces, so it claims no
; extension and is in no "Open with" list, and an install over an older Nib takes
; away what the older one claimed; see NIB_FORGET_FILES.
;
; Windows 8 and later will not let an installer claim a scheme on its own. The
; assignment is sealed with a per-user hash the shell verifies, so the most an
; installer can honestly do is register. The choice itself is made under
; Settings > Default apps, which the app's own Settings opens, and the installer
; does not ask about it.
;
; Only core instructions here. Hook files are included before the template defines
; ${PRODUCTNAME}, ${MANUFACTURER} and the rest, so a function written in this file
; (as opposed to a macro, which is read where it is inserted) cannot use them.

; Until 0.11 the product was called Nib, and Tauri's template names an install by the
; product: its folder, its Apps & Features entry, the folder it remembers for the next
; install, its shortcuts and its client key among the browsers. None of those carry
; over to a new name on their own, so an update would have put a second copy beside
; the first. What follows makes the first install the one that is updated:
;
; - The folder stays where it is. A pinned taskbar icon and every agent nib was added
;   to as an MCP server name the program by its path, and both keep working only if
;   the program is where it was. A fresh install goes under the new name.
; - The old Apps & Features entry and remembered folder go; the new ones are the
;   template's. The old Start menu and desktop shortcuts are renamed rather than made
;   again, so whatever was pinned from them stays pinned.
; - The browser's client key and its line in RegisteredApplications move to the new
;   name. The ProgID, NibURL, stays: the choice Windows sealed under Default apps
;   names the ProgID, and so nib stays the default browser.
; - A per-machine MSI install under the old name is taken away the way the template
;   takes away one under the current name when its NSIS installer replaces it.
!define NIB_OLD_NAME "Nib"
; `productName` in tauri.conf.json, written out for the function below, which is read
; before the template defines it; default_browser.rs holds the two together.
!define NIB_NAME "nibeditor"
!define NIB_OLD_UNINSTKEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\${NIB_OLD_NAME}"

; Where the install under the old name is, once NibFindOldInstall has looked.
Var NibOldDir
Var NibOldAsked

; Before the first page, so the folder page shows the folder that will be used.
!define MUI_CUSTOMFUNCTION_GUIINIT NibFindOldInstall

; Finds the install under the old name and makes its folder this install's, unless a
; folder was asked for (`/D=`) or an install under the new name is remembered: only
; the template's default for a fresh install is replaced. Its own Apps & Features
; entry says where the old install is, in quotes; one whose uninstaller is gone is no
; install, and its entry is dropped after the install like any other trace.
Function NibFindOldInstall
  StrCmp $NibOldAsked "1" nib_find_done
  StrCpy $NibOldAsked "1"

  ReadRegStr $NibOldDir SHCTX "${NIB_OLD_UNINSTKEY}" "InstallLocation"
  ; Its caller's $R9 is given back: the install hook keeps a folder in it.
  Push $R9
  StrCpy $R9 $NibOldDir 1
  StrCmp $R9 '"' 0 nib_find_unquoted
    StrCpy $NibOldDir $NibOldDir "" 1
    StrCpy $NibOldDir $NibOldDir -1
  nib_find_unquoted:
  Pop $R9
  StrCmp $NibOldDir "" nib_find_done
  IfFileExists "$NibOldDir\uninstall.exe" nib_find_found
    StrCpy $NibOldDir ""
    Goto nib_find_done
  nib_find_found:
    StrCmp $INSTDIR "$LOCALAPPDATA\${NIB_NAME}" 0 nib_find_done
    StrCpy $INSTDIR $NibOldDir
  nib_find_done:
FunctionEnd

; A shortcut the old install made, under the new name: renamed when it starts this
; copy (its pins, its place on the desktop and its AppUserModelID go with it), deleted
; when the new one is there already or it starts the old copy somewhere else.
!macro NIB_RENAME_SHORTCUT DIR ID
  IfFileExists "${DIR}\${NIB_OLD_NAME}.lnk" 0 nib_lnk_${ID}_done
  !insertmacro IsShortcutTarget "${DIR}\${NIB_OLD_NAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
  Pop $0
  StrCmp $0 1 nib_lnk_${ID}_here
  StrCmp $NibOldDir "" nib_lnk_${ID}_done
  !insertmacro IsShortcutTarget "${DIR}\${NIB_OLD_NAME}.lnk" "$NibOldDir\${MAINBINARYNAME}.exe"
  Pop $0
  StrCmp $0 1 nib_lnk_${ID}_gone nib_lnk_${ID}_done
  nib_lnk_${ID}_here:
    IfFileExists "${DIR}\${PRODUCTNAME}.lnk" nib_lnk_${ID}_gone
    Rename "${DIR}\${NIB_OLD_NAME}.lnk" "${DIR}\${PRODUCTNAME}.lnk"
    !insertmacro SetLnkAppUserModelId "${DIR}\${PRODUCTNAME}.lnk"
    Goto nib_lnk_${ID}_done
  nib_lnk_${ID}_gone:
    Delete "${DIR}\${NIB_OLD_NAME}.lnk"
  nib_lnk_${ID}_done:
!macroend

; The browser's client under the old name, when it starts this copy, the old copy, or
; a program that is gone. A portable copy somebody registered on purpose keeps it.
!macro NIB_FORGET_OLD_BROWSER ID
  ReadRegStr $R7 SHCTX "Software\Clients\StartMenuInternet\${NIB_OLD_NAME}\shell\open\command" ""
  StrCmp $R7 "" nib_browser_${ID}_done
  StrCmp $R7 '"$INSTDIR\${MAINBINARYNAME}.exe"' nib_browser_${ID}_forget
  StrCmp $R7 '"$NibOldDir\${MAINBINARYNAME}.exe"' nib_browser_${ID}_forget
  StrCpy $R6 $R7 "" 1
  StrCpy $R6 $R6 -1
  IfFileExists $R6 nib_browser_${ID}_done
  nib_browser_${ID}_forget:
    DeleteRegKey SHCTX "Software\Clients\StartMenuInternet\${NIB_OLD_NAME}"
    DeleteRegValue SHCTX "Software\RegisteredApplications" "${NIB_OLD_NAME}"
  nib_browser_${ID}_done:
!macroend

; The template's own migration from its MSI, for the MSI's old name: Tauri's updater
; hands every install the NSIS setup, and the template only looks for an MSI under
; the current name. Run the same way it runs, and only where it runs, which is when
; pages are shown (the updater's passive mode is one). The shortcuts the MSI took with
; it are made again, as the template does for its own migration.
!macro NIB_FORGET_OLD_MSI
  IfSilent nib_msi_done
  StrCpy $R8 0
  nib_msi_loop:
    EnumRegKey $R7 HKLM "SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall" $R8
    StrCmp $R7 "" nib_msi_done
    IntOp $R8 $R8 + 1
    ReadRegStr $R6 HKLM "SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\$R7" "DisplayName"
    ReadRegStr $R5 HKLM "SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\$R7" "Publisher"
    StrCmp "$R6$R5" "${NIB_OLD_NAME}${MANUFACTURER}" 0 nib_msi_loop
    ReadRegStr $R6 HKLM "SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\$R7" "UninstallString"
    ${StrCase} $R5 $R6 "L"
    ${StrLoc} $R5 $R5 "msiexec" ">"
    StrCmp $R5 0 0 nib_msi_loop
    ExecWait '$R6'
    StrCpy $WixMode 1
  nib_msi_done:
  ClearErrors
!macroend

!macro NSIS_HOOK_PREINSTALL
  ; A silent install shows no page, so the old install is looked for here, and the
  ; folder the template has just made under the new name is given back - once it is
  ; no longer the installer's working folder, which Windows will not remove.
  StrCmp $NibOldAsked "1" nib_pre_asked
    StrCpy $R9 $INSTDIR
    Call NibFindOldInstall
    StrCmp $INSTDIR $R9 nib_pre_asked
      SetOutPath $INSTDIR
      RMDir $R9
  nib_pre_asked:

  ; The old install somewhere else, because somebody chose another folder on the
  ; folder page: its own uninstaller takes its files, the way an update would, which
  ; leaves the app's data, its pins and its AppUserModelID alone.
  StrCmp $NibOldDir "" nib_pre_moved
  StrCmp $NibOldDir $INSTDIR nib_pre_moved
    ExecWait '"$NibOldDir\uninstall.exe" /S /UPDATE _?=$NibOldDir'
    Delete "$NibOldDir\uninstall.exe"
    RMDir "$NibOldDir"
  nib_pre_moved:

  !insertmacro NIB_FORGET_OLD_MSI
!macroend

; What Nib 0.9 and earlier wrote so that a double click on a markdown file opened
; it, taken away again. Tauri's own file association wrote `.md`, `.markdown`,
; `.mdown` and `.mkd` pointing at a ProgID named `Markdown`, the old value kept
; beside it as `Markdown_backup`, and this file added `Nib.markdown` and a
; FileAssociations block under the capabilities.
;
; Run by every install, the updater's included: an update is this installer with
; /UPDATE, which leaves the old uninstaller - the one thing that knew about these
; keys - unrun. What that uninstaller would have done is done here: each extension
; gets back the value it had before Nib, and the ProgID goes. Only while the ProgID
; is still Nib's, though: `Markdown` is a name other programs use too, and an
; extension pointing at theirs is theirs.
!macro NIB_FORGET_EXTENSION EXT
  ReadRegStr $R0 SHCTX "Software\Classes\.${EXT}" ""
  StrCmp $R0 "Markdown" 0 nib_forget_${EXT}_backup
    ReadRegStr $R1 SHCTX "Software\Classes\.${EXT}" "Markdown_backup"
    StrCmp $R1 "" nib_forget_${EXT}_unset
      WriteRegStr SHCTX "Software\Classes\.${EXT}" "" $R1
      Goto nib_forget_${EXT}_backup
    nib_forget_${EXT}_unset:
      DeleteRegValue SHCTX "Software\Classes\.${EXT}" ""
  nib_forget_${EXT}_backup:
  DeleteRegValue SHCTX "Software\Classes\.${EXT}" "Markdown_backup"
!macroend

!macro NIB_FORGET_FILES
  ; Nib's when its command starts this copy, and when an older uninstaller took it
  ; and left the extensions behind.
  ReadRegStr $R2 SHCTX "Software\Classes\Markdown\shell\open\command" ""
  StrCmp $R2 '$INSTDIR\${MAINBINARYNAME}.exe "%1"' nib_forget_extensions
  StrCmp $R2 "" nib_forget_extensions nib_forget_progid_kept
  nib_forget_extensions:
    !insertmacro NIB_FORGET_EXTENSION "md"
    !insertmacro NIB_FORGET_EXTENSION "markdown"
    !insertmacro NIB_FORGET_EXTENSION "mdown"
    !insertmacro NIB_FORGET_EXTENSION "mkd"
    StrCmp $R2 "" nib_forget_progid_kept
      DeleteRegKey SHCTX "Software\Classes\Markdown"
  nib_forget_progid_kept:

  DeleteRegKey SHCTX "Software\Classes\Nib.markdown"
  DeleteRegKey SHCTX "Software\Clients\StartMenuInternet\${PRODUCTNAME}\Capabilities\FileAssociations"
  ; Where earlier installers kept the capabilities. One application has one page
  ; under Default apps, so the block moved in with the browser's.
  DeleteRegKey SHCTX "Software\Nib"

  ; A key that was never there sets the error flag, and the template reads that flag
  ; afterwards for the updater's restart; nothing here is an error.
  ClearErrors
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ; How to open a web page with Nib. The flag says the launch is a link's, so
  ; nothing else on its command line is ever read as a note.
  WriteRegStr SHCTX "Software\Classes\NibURL" "" "${PRODUCTNAME} URL"
  WriteRegStr SHCTX "Software\Classes\NibURL\Application" "ApplicationName" "${PRODUCTNAME}"
  WriteRegStr SHCTX "Software\Classes\NibURL\Application" "ApplicationIcon" "$INSTDIR\${MAINBINARYNAME}.exe,0"
  WriteRegStr SHCTX "Software\Classes\NibURL\DefaultIcon" "" "$INSTDIR\${MAINBINARYNAME}.exe,0"
  WriteRegStr SHCTX "Software\Classes\NibURL\shell\open\command" "" '"$INSTDIR\${MAINBINARYNAME}.exe" --url "%1"'

  ; Nib among the browsers, and what it is capable of opening, which is what
  ; Default apps reads. The web's two schemes and no file type: a saved page
  ; is a local file, and Nib opens none.
  WriteRegStr SHCTX "Software\Clients\StartMenuInternet\${PRODUCTNAME}" "" "${PRODUCTNAME}"
  WriteRegStr SHCTX "Software\Clients\StartMenuInternet\${PRODUCTNAME}\DefaultIcon" "" "$INSTDIR\${MAINBINARYNAME}.exe,0"
  WriteRegStr SHCTX "Software\Clients\StartMenuInternet\${PRODUCTNAME}\shell\open\command" "" '"$INSTDIR\${MAINBINARYNAME}.exe"'
  WriteRegStr SHCTX "Software\Clients\StartMenuInternet\${PRODUCTNAME}\Capabilities" "ApplicationName" "${PRODUCTNAME}"
  WriteRegStr SHCTX "Software\Clients\StartMenuInternet\${PRODUCTNAME}\Capabilities" "ApplicationDescription" "Notes and the web in one window."
  WriteRegStr SHCTX "Software\Clients\StartMenuInternet\${PRODUCTNAME}\Capabilities" "ApplicationIcon" "$INSTDIR\${MAINBINARYNAME}.exe,0"
  WriteRegStr SHCTX "Software\Clients\StartMenuInternet\${PRODUCTNAME}\Capabilities\Startmenu" "StartMenuInternet" "${PRODUCTNAME}"
  WriteRegStr SHCTX "Software\Clients\StartMenuInternet\${PRODUCTNAME}\Capabilities\URLAssociations" "http" "NibURL"
  WriteRegStr SHCTX "Software\Clients\StartMenuInternet\${PRODUCTNAME}\Capabilities\URLAssociations" "https" "NibURL"
  WriteRegStr SHCTX "Software\RegisteredApplications" "${PRODUCTNAME}" "Software\Clients\StartMenuInternet\${PRODUCTNAME}\Capabilities"

  !insertmacro NIB_FORGET_FILES

  ; What the old name left: one install, under one name, in Apps & Features.
  !insertmacro NIB_RENAME_SHORTCUT "$SMPROGRAMS" start
  !insertmacro NIB_RENAME_SHORTCUT "$DESKTOP" desktop
  DeleteRegKey SHCTX "${NIB_OLD_UNINSTKEY}"
  DeleteRegKey SHCTX "Software\${MANUFACTURER}\${NIB_OLD_NAME}"
  !insertmacro NIB_FORGET_OLD_BROWSER install
  ClearErrors

  ; Explorer caches file-type icons and handlers until it is told otherwise.
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, i 0, i 0)'
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  ; Nothing of a file type is written any more, but an install that was updated
  ; from an older Nib and never ran the install above goes clean all the same.
  !insertmacro NIB_FORGET_FILES

  ; The browser, unless a copy of Nib elsewhere has registered itself since: a
  ; portable copy the person chose on purpose keeps its place.
  ReadRegStr $R7 SHCTX "Software\Classes\NibURL\shell\open\command" ""
  StrCmp $R7 '"$INSTDIR\${MAINBINARYNAME}.exe" --url "%1"' 0 nib_browser_kept
    DeleteRegKey SHCTX "Software\Clients\StartMenuInternet\${PRODUCTNAME}"
    DeleteRegKey SHCTX "Software\Classes\NibURL"
    DeleteRegValue SHCTX "Software\RegisteredApplications" "${PRODUCTNAME}"
  nib_browser_kept:
  !insertmacro NIB_FORGET_OLD_BROWSER uninstall
  ClearErrors

  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, i 0, i 0)'
!macroend
