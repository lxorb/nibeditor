; Registers Nib the way Windows expects of an application other programs hand
; things to: a ProgID saying how to launch it, a Capabilities block listing what it
; handles, and an entry in RegisteredApplications so that Nib appears under
; Settings > Default apps - as a browser for http and https links, and as an
; editor for markdown files.
;
; The browser half is the values the app writes for itself when a copy got here
; without this installer, and the ones the MSI writes; src/default_browser.rs holds
; this file and wix/browser.wxs to them.
;
; Windows 8 and later will not let an installer claim a file type or a scheme on
; its own. The assignment is sealed with a per-user hash the shell verifies, so the
; most an installer can honestly do is register. The choice itself is made under
; Settings > Default apps, which the app's own Settings opens, and the installer
; does not ask about it.
;
; Only core instructions here. Hook files are included before the template pulls in
; LogicLib, so ${If} and friends are not available yet.

!macro NSIS_HOOK_POSTINSTALL
  ; How to open a markdown file with Nib. Deliberately not added to the
  ; OpenWithProgids list of any extension - Tauri's own file associations
  ; already do that, and a second entry would show Nib twice in "Open with".
  WriteRegStr SHCTX "Software\Classes\Nib.markdown" "" "Markdown document"
  WriteRegStr SHCTX "Software\Classes\Nib.markdown\DefaultIcon" "" "$INSTDIR\${MAINBINARYNAME}.exe,0"
  WriteRegStr SHCTX "Software\Classes\Nib.markdown\shell\open\command" "" '"$INSTDIR\${MAINBINARYNAME}.exe" "%1"'

  ; How to open a web page with Nib. The flag says the launch is a link's, so
  ; nothing else on its command line is ever read as a note.
  WriteRegStr SHCTX "Software\Classes\NibURL" "" "${PRODUCTNAME} URL"
  WriteRegStr SHCTX "Software\Classes\NibURL\Application" "ApplicationName" "${PRODUCTNAME}"
  WriteRegStr SHCTX "Software\Classes\NibURL\Application" "ApplicationIcon" "$INSTDIR\${MAINBINARYNAME}.exe,0"
  WriteRegStr SHCTX "Software\Classes\NibURL\DefaultIcon" "" "$INSTDIR\${MAINBINARYNAME}.exe,0"
  WriteRegStr SHCTX "Software\Classes\NibURL\shell\open\command" "" '"$INSTDIR\${MAINBINARYNAME}.exe" --url "%1"'

  ; Nib among the browsers, and what it is capable of opening, which is what
  ; Default apps reads. The web's two schemes and no web file type: a saved page
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
  WriteRegStr SHCTX "Software\Clients\StartMenuInternet\${PRODUCTNAME}\Capabilities\FileAssociations" ".md" "Nib.markdown"
  WriteRegStr SHCTX "Software\Clients\StartMenuInternet\${PRODUCTNAME}\Capabilities\FileAssociations" ".markdown" "Nib.markdown"
  WriteRegStr SHCTX "Software\Clients\StartMenuInternet\${PRODUCTNAME}\Capabilities\FileAssociations" ".mdown" "Nib.markdown"
  WriteRegStr SHCTX "Software\Clients\StartMenuInternet\${PRODUCTNAME}\Capabilities\FileAssociations" ".mkd" "Nib.markdown"
  WriteRegStr SHCTX "Software\RegisteredApplications" "${PRODUCTNAME}" "Software\Clients\StartMenuInternet\${PRODUCTNAME}\Capabilities"

  ; Where earlier installers kept the capabilities. One application has one page
  ; under Default apps, so the block moved in with the browser's.
  DeleteRegKey SHCTX "Software\Nib"

  ; Explorer caches file-type icons and handlers until it is told otherwise.
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, i 0, i 0)'
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  DeleteRegKey SHCTX "Software\Classes\Nib.markdown"
  DeleteRegKey SHCTX "Software\Nib"

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
