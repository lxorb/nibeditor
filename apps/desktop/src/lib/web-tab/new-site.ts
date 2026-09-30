/** A website in a folder, named before it has an address.
 *
 *  The file list's gesture, and the mirror of a note's: a row goes into the tree
 *  waiting to be named, the name it is given is the title, and the shortcut is written
 *  the moment there is one - with no address in it yet, because the address is what
 *  the bar asks for next. The row is in the list from that moment, which is the whole
 *  point of naming a thing before making it. Where there is no list to type in, the
 *  same stepped `Untitled` every other kind falls back to.
 *
 *  What arrives from the list is a file name, ending and all - the field puts the row's
 *  own ending back before it commits, as it does for every other kind - so the ending
 *  comes off before the name is read as a title. Without that the row wrote
 *  `Blog.url.url` and put `Blog.url` in the shortcut's own `Title`, which is the `.url`
 *  Emil kept seeing in the file list. Fetched with the first; see `createWebsite` in
 *  workspace.svelte.ts, which opens it. */

import { nameFromTitle, shownName } from '../note-name'
import { samePath } from '../space-paths'
import { joinPath } from '../tauri'
import type { Entry, Space } from '../workspace.svelte'
import { UNTITLED } from '../workspace/documents.svelte'
import { writeFile } from '../workspace/write-file'
import { writeShortcut } from './shortcut'

/** What making one needs of the store. */
export interface Sites {
  readonly activeSpace: Space | null
  readonly device: { expand(folder: string): void }
  freeName(dir: string, wanted: string): string
  showEntry(entry: Entry): void
  freshEntry(path: string, isFolder: boolean): Entry
}

/** The shortcut written in `dir`, its row in the list first; answers its path. */
export async function newSite(ws: Sites, dir: string, named?: string): Promise<string> {
  const title = named === undefined ? UNTITLED : shownName(named)
  const path = joinPath(dir, ws.freeName(dir, `${nameFromTitle(title) ?? UNTITLED}.url`))

  ws.showEntry(ws.freshEntry(path, false))
  if (!samePath(dir, ws.activeSpace?.root)) ws.device.expand(dir)

  await writeFile(path, writeShortcut('', title, new Date()))
  return path
}
