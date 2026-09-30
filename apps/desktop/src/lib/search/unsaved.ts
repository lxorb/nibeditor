/** The notes of a space that have no file yet, searched where their words are: in the
 *  tabs holding them. A search of the space reads the disk, and an unsaved note is on
 *  no disk, but it is the space's all the same - it was opened there and is saved there
 *  - so a word typed into one is found beside the words of every other note. Its rows
 *  open its tab rather than a path; see `tab` on a hit. Only notes: a plane's and a
 *  deck's words are JSON, which the disk search does not read either. Fetched with
 *  the first search. See workspace/drafts.ts. */

import { workspace } from '../workspace.svelte'
import type { NoteDoc } from '../workspace/documents.svelte'
import { isDraft } from '../workspace/drafts'
import { type Hit, Matcher } from './match'
import type { Query } from './query'

export function unsavedHits(query: Query, space: string | null, most: number): Hit[] {
  const matcher = new Matcher(query)
  const seen = new Set<NoteDoc>()
  const out: Hit[] = []

  for (const tab of workspace.tabs) {
    const note = tab.note
    if (seen.has(note) || note.kind !== 'note' || !isDraft(note)) continue
    if (workspace.spaceOf(note) !== space) continue
    seen.add(note)

    const found = matcher.hits(
      { path: `unsaved:${note.key}`, relative: note.shown, name: note.shown, body: note.latest },
      most - out.length,
    )
    out.push(...found.map((hit) => ({ ...hit, tab: tab.id })))
  }

  return out
}
