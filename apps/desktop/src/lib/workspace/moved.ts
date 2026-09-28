/** The spaces folder moving out from under what this app wrote down about it.
 *
 *  Everything the app keeps about a note is keyed by where the note is: the tabs a
 *  session reopens, where the caret was, the recent list, the bookmarks, which
 *  folders were open, and the sync's own pairing of a folder with the account's
 *  space and the edits still waiting to go up. Where the note is, is an absolute
 *  path.
 *
 *  An iPhone moves it. The app's container is named by a UUID the system picks
 *  afresh on every install and every update, and the documents folder - with the
 *  spaces in it - is inside that container. The notes come along; every path the
 *  app wrote down still names the container they were in. So after each update the
 *  spaces were listed again as if new, under new ids, the tabs had nothing to open,
 *  and the sync had to pair every space again from scratch.
 *
 *  What is done about it is the plainest thing that is true: the folder has moved,
 *  so every path under the old one is said again under the new one, in everything
 *  the app stored - and the page starts again, since every module has already read
 *  its own storage by the time the move can be noticed. Once per move, which on a
 *  phone is once per update. */

import { forget, keep, stored, storedText } from '../stored'
import { invoke, isMobile } from '../tauri'
import { readSession } from './session'

/** Where the spaces folder was when this storage was last written. */
export const SPACES_ROOT = 'nib:spaces-root'

/** The folder a path is in: everything before its last separator. */
function parentOf(path: string): string {
  const cut = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return cut > 0 ? path.slice(0, cut) : path
}

/** Where the spaces folder was, as far as storage can say: written down outright
 *  by any build that has this module, and otherwise - the first launch after the
 *  update that brought it - the one folder every space was found in. */
export function formerRoot(written: string | null, roots: readonly string[]): string | null {
  if (written) return written
  if (!roots.length) return null

  const parents = new Set(roots.map(parentOf))
  return parents.size === 1 ? ([...parents][0] ?? null) : null
}

/** Whether the spaces folder has moved from `was` to `now`, which is only so when
 *  every space the storage names is still there under the new folder: a listing
 *  that lost a space is a different story, and not one to rewrite paths over. */
export function hasMoved(
  was: string | null,
  now: string,
  roots: readonly string[],
  listed: readonly string[],
): was is string {
  if (!was || was === now || !roots.length) return false

  const there = new Set(listed)
  return roots.every((root) => root.startsWith(was) && there.has(now + root.slice(was.length)))
}

/** `text` with every path under `was` said under `now` instead, spelled both the
 *  way it is written and the way JSON escapes it (a Windows path's backslashes). */
export function rebased(text: string, was: string, now: string): string {
  const escape = (path: string) => JSON.stringify(path).slice(1, -1)
  const under = (from: string, to: string, value: string) =>
    value
      .replaceAll(`${from}/`, `${to}/`)
      .replaceAll(`${from}\\`, `${to}\\`)
      .replaceAll(`"${from}"`, `"${to}"`)

  const plain = under(was, now, text)
  return escape(was) === was ? plain : under(escape(was), escape(now), plain)
}

/** Says every stored path under `was` again under `now`. Answers how many keys it
 *  changed. */
export function restate(was: string, now: string, storage: Storage = localStorage): number {
  let changed = 0
  const keys: string[] = []
  for (let at = 0; at < storage.length; at++) {
    const key = storage.key(at)
    if (key?.startsWith('nib:') && key !== SPACES_ROOT) keys.push(key)
  }

  for (const key of keys) {
    const text = storage.getItem(key)
    if (text === null) continue
    const moved = rebased(text, was, now)
    if (moved === text) continue
    storage.setItem(key, moved)
    changed++
  }

  return changed
}

/** Settles where the spaces folder is: notes it down, and when it has moved since
 *  storage was last written, says every stored path again under the new folder.
 *  Answers true when storage was rewritten, which the caller answers by starting the
 *  page again. */
export function settleRoot(
  now: string,
  roots: readonly string[],
  listed: readonly string[],
): boolean {
  const written = storedText(SPACES_ROOT)
  const was = formerRoot(written, roots)

  if (hasMoved(was, now, roots, listed)) {
    try {
      restate(was, now)
    } catch {
      // Storage that will not be written to is storage nothing was going to be read
      // back out of either; the spaces are listed afresh, as they were before.
      forget(SPACES_ROOT)
      return false
    }
    keep(SPACES_ROOT, now)
    return true
  }

  if (written !== now) keep(SPACES_ROOT, now)
  return false
}

/** Before anything reads its storage: whether the spaces folder has moved since the
 *  session was written, having said every stored path again under the new one if it
 *  has. A phone's alone - a desktop's documents folder does not move under it - and
 *  answers false at once anywhere else. When it answers true the page is to start
 *  again rather than go on with what the modules read before the paths were right;
 *  see main.ts. */
export async function spacesMoved(): Promise<boolean> {
  if (!isMobile) return false

  const roots = readSession(stored('nib:workspace'))?.spaces.map((space) => space.root) ?? []
  try {
    const [now, listed] = await Promise.all([
      invoke<string>('spaces_root'),
      invoke<{ name: string; path: string }[]>('list_spaces'),
    ])
    return settleRoot(
      now,
      roots,
      listed.map((one) => one.path),
    )
  } catch {
    // Nothing to compare against: the spaces are listed afresh, as they always were.
    return false
  }
}
