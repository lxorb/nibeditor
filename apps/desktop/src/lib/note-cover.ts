/** Giving a note a cover, and taking it away again.
 *
 *  It goes in the file, under `cover:` and `cover-position:`, for the same reason an
 *  icon does: a cover that lived in this machine's store would be a cover one
 *  machine had. Obsidian shows neither key and changes neither, so a note with a
 *  cover opens there as the note it is, and a published page has read `cover:` as
 *  its `og:image` since before there was a banner to draw. See cover.ts in
 *  @nib/markdown, which is the one place that knows the two keys.
 *
 *  The picture is chosen through the browser's own file chooser and stored the way a
 *  pasted one is - `storeImage`, addressed by the hash of its bytes - so a picture
 *  already in the space's assets lands on the file that is already there rather than
 *  on a second copy of it, and a picture from anywhere else lands beside the note in
 *  the folder the Attachments setting names.
 *
 *  Written through the workspace as an edit the size of the keys that changed, the
 *  way setFileIcon beside this writes an icon: a note open in a pane takes the change
 *  in its editor rather than off the disk under its reader's caret, and one undo puts
 *  it back. */

import { COVER_KEY, COVER_POSITION_KEY } from '@nib/markdown/cover'
import { frontMatterEdits } from '@nib/markdown/front-matter'
import { storeImage } from './assets'
import { busy } from './busy.svelte'
import { key, message, t } from './i18n.svelte'
import { reverse } from './search/replace'
import { settings } from './settings.svelte'
import { isMarkdownPath } from './space-paths'
import { usage } from './usage.svelte'
import { workspace } from './workspace.svelte'

/** What a file chooser will offer: everything every surface that draws a note can
 *  draw. The same list the Picture row offers, because a cover is a picture. */
const PICTURES = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'svg', 'bmp']

/** Whether a path is a thing that can have one. A note: a canvas and a set of pages
 *  are JSON with no front matter, and a folder is not a file. */
export function canHaveCover(path: string | null | undefined): boolean {
  return !!path && isMarkdownPath(path)
}

/** The chooser. It only opens from inside a click, which a menu row is; the same
 *  input the Picture row uses, and for the same reason - a webview hands back a real
 *  `File`, which is what the storing wants. */
function pickPicture(): Promise<File | null> {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = [...PICTURES.map((one) => `.${one}`), 'image/*'].join(',')

  return new Promise((resolve) => {
    input.onchange = () => resolve(input.files?.[0] ?? null)
    input.oncancel = () => resolve(null)
    input.click()
  })
}

/** Writes the two keys, or takes both away when `src` is null. One write, so a
 *  cover is one thing to undo; nothing at all where the note already says that.
 *
 *  Apart from the choosing, so the writing can be driven without a file chooser -
 *  which is a dialog the machine owns and a test has no way to answer. */
export async function setCover(path: string, src: string | null): Promise<void> {
  const before = await workspace.noteText(path)
  if (before === null) return

  // A position with no picture to position is not a position, so taking the cover
  // away takes both keys. A new picture starts in the middle, which is what a note
  // that never said gets - and what `coverOf` answers - so the key is left off
  // rather than written out as the number it would mean anyway.
  const edit = frontMatterEdits(before, [
    [COVER_KEY, src],
    [COVER_POSITION_KEY, null],
  ])
  if (!edit) return

  const after = before.slice(0, edit.from) + edit.insert + before.slice(edit.to)
  const edits = [edit]

  try {
    await workspace.replaceInNotes([{ path, before, after, edits, back: reverse(before, edits) }])
  } catch (error) {
    settings.error = message(error, key('That cover could not be written.'))
  }
}

/** Chooses a picture and makes it this note's cover. */
export async function chooseCover(path: string): Promise<void> {
  const file = await pickPicture()
  if (!file) return

  try {
    const src = await busy.run(t('Storing the image'), () => storeImage(file, path))
    void usage.refresh()
    if (src) await setCover(path, src)
  } catch (error) {
    void usage.refresh()
    settings.error = message(error, key('That image does not fit in your storage.'))
  }
}

/** Takes the cover off, keys and all. */
export function removeCover(path: string): Promise<void> {
  return setCover(path, null)
}
