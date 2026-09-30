; Registers Nib the way Windows expects of an application other programs hand
; things to: a ProgID saying how to launch it, a Capabilities block listing what it
; handles, and an entry in RegisteredApplications so that Nib appears under
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
; Only core instructions here. Hook files are included before the template pulls in
; LogicLib, so ${If} and friends are not available yet.

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

  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, i 0, i 0)'
!macroend
