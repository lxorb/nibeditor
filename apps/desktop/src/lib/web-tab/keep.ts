/** The file keeps up with the page: a web note says where the reading has got to.
 *
 *  This is the whole of what makes a web note a browser tab rather than a bookmark.
 *  Emil, 2026-09-13: *"I believe currently it resets the page every time you reopen
 *  it. That is extremely annoying and should not be. It should basically reopen the
 *  exact same page you had open last time when you open that page."*
 *
 *  So `URL` is where the tab is, written on the same pause a note's words are written
 *  on (`SAVE_DELAY` in backoff.ts) and before the window goes, and `Nib-Home` keeps the address the note points at - what somebody typed
 *  into the bar or made the note with - for the one row that offers it back. The file
 *  is what syncs, so this is the half of a tab's state that reaches another machine;
 *  the place on the page and the trail behind it are this device's and live beside it.
 *  See place.ts and docs/web-tabs.md.
 *
 *  Written from here rather than from the workspace because it is about the shortcut
 *  and not about the session: the workspace still owns what a tab is, and it is the
 *  one that writes a file when somebody keeps the page - see `save`. A write
 *  is only ever made for a note that already has a file.
 *
 *  Quiet about a write that fails. A shortcut that could not be written is a note that
 *  opens where it opened yesterday, which is what it did before any of this. */

import { SAVE_AT_MOST, SAVE_DELAY } from '../backoff'
import { links } from '../link-index.svelte'
import { owes, writing } from '../parting'
import { invoke } from '../tauri'
import { afterQuiet, type Later } from '../timing'
import { isWebAddress } from './address'
import { readWebFile, writeShortcut } from './shortcut'

/** What one web note's file needs to be brought up to date. Named rather than
 *  positional because four strings in a row is four chances to swap two. */
export interface Kept {
  /** The file, which must already exist: this never makes one. */
  path: string
  /** What the file says now, so nothing is read from the disk to find out. */
  text: string
  /** Where the tab is. */
  url: string
  /** The site's own mark, or null while the page has not said. */
  icon: string | null
  /** Told what the file now says, so the tab's own copy of it stays the file's. */
  wrote: (text: string) => void
}

/** The write each note is waiting on, so a page that moves twice in a moment writes
 *  once. Keyed by path: two tabs on the same file are one file.
 *
 *  The notes' own pause, Emil's rule of 2026-09-14: the address is the document's and
 *  follows the reading the way the words follow the typing - a page that redirects on
 *  the way in moves faster than the pause, so it is still one write - and a reader
 *  clicking through a set of links without stopping is written every couple of seconds
 *  all the same. */
const waiting = new Map<string, { later: Later; write: () => void }>()

// A window closing runs no timer: what is waiting is written as it goes, and the window
// waits for it the way it waits for a note. See parting.ts.
owes(() => {
  for (const path of [...waiting.keys()]) keepNow(path)
})

/** The reading has moved on. The file follows, once it stops moving. */
export function keepPage(kept: Kept) {
  if (!isWebAddress(kept.url)) return

  const said = readWebFile(kept.path, kept.text)
  if (!said) return

  // The home is whatever the file already says it is, and the address it was written
  // with the first time this happens: a note that has never been browsed out of keeps
  // the address it points at from the moment the reading leaves it.
  const home = said.home ?? said.url
  const icon = kept.icon ?? said.icon
  if (said.url === kept.url && (said.icon === icon || holdsPicture(said.icon))) return

  const held = waiting.get(kept.path)
  const write = () => {
    waiting.delete(kept.path)
    writing(writeFile(kept, home, icon))
  }
  if (held) {
    held.write = write
    held.later()
    return
  }

  const one = { later: afterQuiet(() => one.write(), SAVE_DELAY, SAVE_AT_MOST), write }
  waiting.set(kept.path, one)
  one.later()
}

/** Whether the file already holds the site's mark as a picture, which a page reporting
 *  its mark again is no reason to write over.
 *
 *  Two devices draw the same favicon into two different `data:` addresses - a size,
 *  an encoder - and each wrote its own over the other's every time the page opened.
 *  The file synced back and forth on a change nobody can see, and two devices writing
 *  one web note between two passes is what used to leave a copy of it beside itself.
 *  A mark still held as an address, from before marks were kept as pictures, is
 *  replaced; so is any mark once the reading moves, which writes the file anyway. */
function holdsPicture(icon: string | null): boolean {
  return icon?.startsWith('data:') === true
}

/** What is waiting for this note, written now: the window is going, or the tab. */
export function keepNow(path: string) {
  const held = waiting.get(path)
  if (!held) return
  held.later.cancel()
  held.write()
}

async function writeFile(kept: Kept, home: string | null, icon: string | null): Promise<void> {
  const said = readWebFile(kept.path, kept.text)
  const title = said?.title ?? ''
  const added = said?.added
  const when = added ? new Date(added) : new Date()

  const content = writeShortcut(
    kept.url,
    title,
    Number.isNaN(when.getTime()) ? new Date() : when,
    home,
    icon,
  )
  if (content === kept.text) return

  kept.wrote(content)
  // The index is told what the file now says, exactly as the workspace's own saves
  // tell it: the row in the file list draws the site's own mark out of this file, and
  // nothing rescans a space while it is open - so without this the row wore the plain
  // globe until the next launch, however long ago the page said what its icon was.
  links.noteSaved(kept.path, content)
  await invoke('write_note', { path: kept.path, content }).catch(() => undefined)
}
