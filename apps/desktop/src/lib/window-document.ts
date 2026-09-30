/** What the window says about its document to whatever lists windows: the
 *  taskbar, Mission Control, the Window menu. A Mac shows the file as the window's
 *  document, so its title is just the name, as in TextEdit. The edited dot in a
 *  Mac's close button is never lit: every note writes itself, so there is never
 *  anything in the window that is not on the disk a moment later. See
 *  src-tauri/src/document_window.rs. */

export interface Showing {
  shown: string
  path: string | null
}

/** What `show_document` is handed; `edited` and `path` are a Mac's alone. */
export interface WindowDocument {
  title: string
  edited: boolean
  path: string | null
}

const APP = 'nibeditor'

/** The window's side of the tab in front. */
export function windowDocument(active: Showing | null, mac: boolean): WindowDocument {
  if (!active) return { title: APP, edited: false, path: null }

  if (mac) {
    const path = active.path?.startsWith('/') ? active.path : null
    return { title: active.shown, edited: false, path }
  }

  return { title: `${active.shown} - ${APP}`, edited: false, path: null }
}
