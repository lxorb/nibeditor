/** A file dragged in from another app and let go where nothing takes it.
 *
 *  A webview does with it what a browser does with a file dropped on a page that
 *  did not ask for one: it opens the file in place of the page, and the app becomes
 *  one markdown file's text. nib opens nothing from outside its spaces, so a file
 *  drag no surface has taken is answered here, at the window, with nothing: the
 *  pointer says no and the drop lands nowhere. The surfaces that do take files keep
 *  them - the file list copies them into the space, a note copies them in beside
 *  itself, the import sheet reads them, a terminal writes their path.
 *
 *  On the window and after everything else, because a surface that takes the drag
 *  says so first, with `preventDefault` on its own event, and this only answers
 *  what is left. Only files: text and links dragged over a field are the field's. */

import { isFileDrop } from './drag-paths'

export function guardDrops(): () => void {
  const over = (event: DragEvent) => {
    if (event.defaultPrevented || !isFileDrop(event.dataTransfer)) return

    event.preventDefault()
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'none'
  }

  // A surface that let the drag hover and then did nothing with the drop would leave
  // the webview to open the file after all.
  const drop = (event: DragEvent) => {
    if (!event.defaultPrevented && isFileDrop(event.dataTransfer)) event.preventDefault()
  }

  window.addEventListener('dragover', over)
  window.addEventListener('drop', drop)

  return () => {
    window.removeEventListener('dragover', over)
    window.removeEventListener('drop', drop)
  }
}
