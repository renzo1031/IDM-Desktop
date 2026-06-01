!macro NSIS_HOOK_POSTINSTALL
  !searchreplace WEBVIEW2LOADER_SRC "${MAINBINARYSRCPATH}" "${MAINBINARYNAME}.exe" "WebView2Loader.dll"
  File /a "/oname=WebView2Loader.dll" "${WEBVIEW2LOADER_SRC}"
  !undef WEBVIEW2LOADER_SRC
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  Delete "$INSTDIR\WebView2Loader.dll"
!macroend
