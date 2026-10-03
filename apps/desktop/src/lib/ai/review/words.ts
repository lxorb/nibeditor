/** The few words the review shows of a change: the note's name, and the first of
 *  the words the agent wrote, or of those it took out where it wrote none. */

import { workspace } from '../../workspace.svelte'
import { nameOf } from '../../space-paths'
import type { Edit } from './changes'

/** How much of a change's words a row shows. */
const SHOWN = 60

/** A note's name as the tree says it: without `.md`; a draft's tab title. */
export function titleOf(path: string): string {
  if (path.startsWith('unsaved:')) {
    const key = path.slice('unsaved:'.length)
    return workspace.documents.find((one) => one.key === key)?.name ?? ''
  }
  return nameOf(path).replace(/\.md$/i, '')
}

/** The first line with words in it, cut to a row. */
function firstLine(words: string): string {
  const line = words
    .split('\n')
    .map((one) => one.trim())
    .find(Boolean)
  if (!line) return ''
  return line.length > SHOWN ? `${line.slice(0, SHOWN)}…` : line
}

/** What a change's row says. */
export function snippetOf(change: Pick<Edit, 'spots'>): string {
  for (const spot of change.spots) {
    const said = firstLine(spot.inserted)
    if (said) return said
  }
  for (const spot of change.spots) {
    const said = firstLine(spot.removed)
    if (said) return said
  }
  return '¶'
}
