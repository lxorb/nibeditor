/** The file keeps up with the page: a web note says where the reading has got to.
 *
 *  This is the whole of what makes a web note a browser tab rather than a bookmark.
 *  Emil, 2026-09-13: *"I believe currently it resets the page every time you reopen
 *  it. That is extremely annoying and should not be. It should basically reopen the
 *  exact same page you had open last time when you open that page."*
 *
 *  So `URL` is where the tab is, written a couple of seconds after the reading
 *  settles, and `Nib-Home` keeps the address the note points at - what somebody typed
 *  into the bar or made the note with - for the one row that offers it back. The file
 *  is what syncs, so this is the half of a tab's state that reaches another machine;
 *  the place on the page and the trail behind it are this device's and live beside it.
 *  See place.ts and docs/web-tabs.md.
 *
 *  Written from here rather than from the workspace because it is about the shortcut
 *  and not about the session: the workspace still owns what a tab is, and it is the
 *  one that writes a file the first time a page says what it is called - see
 *  `keepWeb`. A write is only ever made for a note that already has a file.
 *
 *  Quiet about a write that fails. A shortcut that could not be written is a note that
 *  opens where it opened yesterday, which is what it did before any of this. */

import { invoke } from '../tauri'
import { isWebAddress } from './address'
import { readWebFile, writeShortcut } from './shortcut'

/** How long the reading has to settle before the file is written.
 *
 *  Two seconds. A page that redirects twice on the way in is one write rather than
 *  three, and a reader clicking through a set of links leaves one file behind rather
 *  than a version of it per click. */
const SETTLES = 2000

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

/** The write each note is waiting on, so a page that moves twice in a second writes
 *  once. Keyed by path: two tabs on the same file are one file. */
const waiting = new Map<string, ReturnType<typeof setTimeout>>()

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
  if (said.url === kept.url && (said.icon ?? null) === icon) return

  const held = waiting.get(kept.path)
  if (held) clearTimeout(held)

  waiting.set(
    kept.path,
    setTimeout(() => {
      waiting.delete(kept.path)
      void write(kept, home, icon)
    }, SETTLES),
  )
}

/** Everything waiting, written now: the app is closing a tab, or the note is about to
 *  be left. A settled write nobody is waiting for is a page the reader has already
 *  moved on from. */
export function keepNow(path: string) {
  const held = waiting.get(path)
  if (!held) return
  clearTimeout(held)
  waiting.delete(path)
}

async function write(kept: Kept, home: string | null, icon: string | null): Promise<void> {
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
  await invoke('write_note', { path: kept.path, content }).catch(() => undefined)
}
