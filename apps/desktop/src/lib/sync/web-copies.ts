/** The copies of web notes sync already made, folded back into the notes.
 *
 *  A web note is never kept twice any more (web-tab/settle.ts), but a space that
 *  synced before that rule holds the copies it made: `Docs (from another device
 *  2026-10-01).url` beside `Docs.url`, sometimes a dozen of them. Emil, 2026-10-03:
 *  *"Still getting a lot of name-clash files for web notes."*
 *
 *  So each pass looks for them before it offers the folder. A copy that is the same
 *  note as the one it sits beside - it points where that one points - is settled
 *  into it the way two copies are settled now, the newer file standing with the
 *  fields only the other said, and goes to this device's trash with a version kept
 *  first. The push that follows finds it gone and deletes it on the account, so
 *  every other device loses it on its next pass. A copy that points somewhere else
 *  is a note of its own and stays exactly where it is; so does one whose note has
 *  gone, since it is the only copy there is. Nothing differing is ever taken away.
 *
 *  Fetched with the pass. Read only by name first, so a space with no copies in it
 *  reads no file at all. */

import { log } from '../log'
import { invoke } from '../tauri'
import { sameWebNote, settleShortcuts } from '../web-tab/settle'
import type { Entry } from '../workspace.svelte'
import { writeDown } from './write-down'

/** The stamp a copy's name carries, possibly more than once - a copy of a copy - and
 *  the number a second copy on the same day stepped aside with. */
const STAMP = / \(from another device \d{4}-\d{2}-\d{2}\)(?: \d+)?/gu

/** The note a web note's copy was made of, or null for a name that is not a copy. */
export function copiedFrom(path: string): string | null {
  const ending = /\.(url|webloc)$/iu.exec(path)
  if (!ending) return null

  const stem = path.slice(0, ending.index)
  const plain = stem.replace(STAMP, '')
  return plain === stem ? null : plain + ending[0]
}

/** One copy folded: the note it went into, and where the copy was. */
export interface Folded {
  kept: string
  gone: string
}

/** Every copy in `files` that is the same note as the one beside it, settled into
 *  that note and moved to the trash. Answers what was folded, oldest copy first. */
export async function foldWebCopies(files: readonly Entry[]): Promise<Folded[]> {
  const byPath = new Map(files.map((one) => [one.path, one]))
  const copies = files.filter((one) => copiedFrom(one.path) !== null)
  if (copies.length === 0) return []

  const folded: Folded[] = []
  for (const copy of [...copies].sort((a, b) => a.modified - b.modified)) {
    const note = byPath.get(copiedFrom(copy.path) ?? '')
    if (!note) continue

    try {
      if (await foldInto(note, copy)) folded.push({ kept: note.path, gone: copy.path })
    } catch (error) {
      log('warn', `sync: ${copy.path} not folded into ${note.path} - ${String(error)}`)
    }
  }

  return folded
}

async function foldInto(note: Entry, copy: Entry): Promise<boolean> {
  const [ours, theirs] = await Promise.all([
    invoke<string>('read_note', { path: note.path }),
    invoke<string>('read_note', { path: copy.path }),
  ])
  if (!sameWebNote(note.path, ours, theirs)) return false

  const one = settleShortcuts(note.path, ours, theirs, copy.modified > note.modified)
  if (one !== ours) await writeDown(note.path, one, ours)

  await invoke('snapshot_note', { path: copy.path, content: theirs }).catch(() => undefined)
  await invoke('trash_item', { path: copy.path, kind: 'note' })
  // What the note now says is the newer of the two, which a later copy is compared
  // against: the entry's own time moves with it.
  note.modified = Math.max(note.modified, copy.modified)
  return true
}
