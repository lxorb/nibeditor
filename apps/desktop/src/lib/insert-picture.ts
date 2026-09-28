/** Putting one thing into the note where the caret is: a picture chosen from the
 *  disk, a photograph taken on the spot, something another app shared, a sentence
 *  the phone heard.
 *
 *  The same road a pasted or dropped picture takes - `storeImage`, which puts it
 *  in the account or in the folder the Attachments setting names and answers with
 *  the path the note should carry - so a picture inserted from the menu and one
 *  dragged in are the same picture in the same place. The only new part is the
 *  choosing.
 *
 *  The browser's own file chooser does that on all three builds. A webview has one
 *  too, and it hands back a real `File`, which is what the storing wants; a Tauri
 *  dialog would hand back a path and the bytes would have to be read back out of
 *  the crate to make one. The camera is the same chooser with `capture` on it: an
 *  Android webview answers that with the camera app rather than the picker, and a
 *  phone browser does the same, so one input is both rows. */

import type { EditorView } from '@nib/editor'
import { storeImage } from './assets'
import { busy } from './busy.svelte'
import { chooseFiles, PICTURES } from './choose-files'
import { key, message, t } from './i18n.svelte'
import { settings } from './settings.svelte'
import { usage } from './usage.svelte'
import { viewport } from './viewport.svelte'
import { workspace } from './workspace.svelte'

/** Whether the row is worth offering: a note open, and open for writing. */
export function canInsertPicture(view?: EditorView): boolean {
  return !!view && !view.state.readOnly && !!workspace.active
}

/** And whether a camera row is worth offering at all: only where the glass is
 *  under a finger. A desktop's `capture` is ignored by every browser, so the row
 *  there would be the Picture row above it under another name. */
export function canTakePhoto(view?: EditorView): boolean {
  return viewport.touch && canInsertPicture(view)
}

export async function insertPicture(view: EditorView): Promise<void> {
  const [file] = await chooseFiles({ accept: PICTURES })
  if (file) await putPicture(view, file)
}

/** The camera, on a phone. Nothing else differs: what comes back is a `File` and
 *  it is stored and drawn exactly as a pasted one is. */
export async function takePhoto(view: EditorView): Promise<void> {
  const [file] = await chooseFiles({ accept: 'image/*', camera: true })
  if (file) await putPicture(view, file)
}

/** Stores one file beside the note and draws it where the caret is. */
export async function putPicture(view: EditorView, file: File): Promise<void> {
  const note = workspace.active
  if (!note) return

  try {
    const src = await busy.run(t('Storing the image'), () => storeImage(file, note.path))
    void usage.refresh()
    if (src) writeAtCaret(view, `![${alt(file.name)}](${encodeURI(src)})`)
  } catch (error) {
    void usage.refresh()
    settings.error = message(error, key('That image does not fit in your storage.'))
  }
}

/** The file's own name as the alt text: it is the only description there is at
 *  this point, and an empty one reads as a picture nobody described. */
function alt(name: string): string {
  return name.replace(/\.[^.]+$/, '').replace(/[[\]]/g, '')
}

/** Writes one thing into the note where the caret is, and leaves the caret after
 *  it.
 *
 *  Here rather than at each call site, because a picture from the menu, a photo, a
 *  share and a dictated sentence are four things arriving one way: as text, at the
 *  caret, in a note somebody is looking at. The editor's own paste has a second
 *  answer for the same question - `receiveImages` maps the position through
 *  whatever was typed while the bytes were being stored, which a drop needs and a
 *  press does not; see packages/editor/src/images.ts. */
export function writeAtCaret(view: EditorView, text: string): void {
  const range = view.state.selection.main

  view.dispatch({
    changes: { from: range.from, to: range.to, insert: text },
    selection: { anchor: range.from + text.length },
    scrollIntoView: true,
    userEvent: 'input',
  })
  view.focus()
}
