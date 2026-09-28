/** Asking for files off the device.
 *
 *  A file input and nothing else, which is the one picker every platform already
 *  has: on a desktop it is the system's file dialog, in a browser the same, and on
 *  Android `accept="image/*"` is what makes the sheet offer the gallery, the camera
 *  and the files app together. It hands back real `File`s, which is what storing a
 *  picture or reading an export wants; a Tauri dialog would hand back a path whose
 *  bytes then have to be read back out through the crate.
 *
 *  It only opens from inside a click or a key, which every caller is: a menu row, a
 *  sheet's button, a shortcut. */

/** What a chooser offers when it is asked for a picture: everything the renderer, a
 *  plane and the webview can all draw. The same list `isPicture` recognises on a
 *  plane, so a picture that can be chosen is one that is drawn. */
export const PICTURES = 'image/*,.png,.jpg,.jpeg,.gif,.webp,.avif,.svg,.bmp'

interface Asking {
  /** The types to offer, as the input's own `accept` says them. Everything when left
   *  out. */
  accept?: string
  multiple?: boolean
  /** The camera rather than the picker. An Android webview reads the attribute and
   *  offers the camera app, a phone browser does the same, and a desktop browser
   *  ignores it - which is why the row that asks for it is only offered on a phone. */
  camera?: boolean
}

/** The files somebody chose, or none at all if they thought better of it.
 *
 *  The input is put in the document because a browser will not open a picker for an
 *  element that is not there, and taken out again as soon as it has answered. It is
 *  never shown: `hidden` would stop the click on some browsers, so it is simply
 *  nowhere anybody can see. */
export function chooseFiles(asking: Asking = {}): Promise<File[]> {
  if (typeof document === 'undefined') return Promise.resolve([])

  const { accept, multiple = false, camera = false } = asking

  return new Promise((settle) => {
    const input = document.createElement('input')
    input.type = 'file'
    if (accept !== undefined) input.accept = accept
    input.multiple = multiple
    if (camera) input.capture = 'environment'
    input.style.position = 'fixed'
    input.style.left = '-1000px'
    input.style.opacity = '0'

    let answered = false
    const answer = (files: File[]) => {
      if (answered) return

      answered = true
      input.remove()
      settle(files)
    }

    input.addEventListener('change', () => answer([...(input.files ?? [])]))
    // A picker closed with nothing chosen. Not every browser fires it, so the promise
    // is also settled by the change above and by nothing at all: an unresolved
    // promise here costs one closure and no picker stays open.
    input.addEventListener('cancel', () => answer([]))

    document.body.append(input)
    input.click()
  })
}
