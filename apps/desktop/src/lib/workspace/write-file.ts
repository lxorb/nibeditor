/** A file of the space written by the app, and the link index told what it says.
 *
 *  Two steps that are one: nothing rescans a space while it is open, so the index
 *  knows a file the app wrote only because the writer said so - and every writer
 *  that forgot left a file `[[its name]]` did not reach until the next launch. A
 *  website made from the file list, the address typed into one and a note turned
 *  into a shortcut all wrote straight to the disk, and each of them was that file.
 *  So the app's writes of a whole file come through here, and saying so is not a
 *  thing a new one can forget.
 *
 *  `noteSaved` knows a note from a canvas, a page note and a website by its name,
 *  so this is the same call whatever kind of file is written. The editor's own save
 *  tells the index itself, between the write and the rest of what a save does; see
 *  saving.svelte.ts. */

import { links } from '../link-index.svelte'
import { invoke } from '../tauri'

export async function writeFile(path: string, content: string): Promise<void> {
  await invoke('write_note', { path, content })
  links.noteSaved(path, content)
}
