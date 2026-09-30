/** A whole text written into a shared one as the few operations it differs by.
 *
 *  Three writers hand nib a whole text rather than keystrokes: another program that
 *  saved the file (section 5.5), a modal answer that keeps this device's words over
 *  the merge (5.4), and the account's `ingest` for a v1 push, the connector and a
 *  rollback (5.10). Replacing the shared text wholesale would be correct and
 *  ruinous: every character would be new, every caret on every device would jump,
 *  and two such writes would be two copies of the note. So the text is diffed against
 *  what the shared text reads, and only the difference goes in, as ordinary edits made
 *  now.
 *
 *  The diff is the one in diff.ts, tidied for operations rather than for reading: every
 *  character left alone is a character whose identity, and every concurrent edit
 *  anchored to it, survives. See docs/sync-v2.md. */

import type * as Y from 'yjs'
import { edits } from './diff'

/** Turns `text`, which reads `from`, into `to`, in one transaction, and answers how
 *  many operations that took: a delete and an insert for each changed stretch, so a
 *  word retyped in a hundred kilobytes is two.
 *
 *  `from` is the caller's copy of what `text` reads, which it has already (it is what
 *  it compared against), so nothing here reads the whole shared text back. A caller
 *  whose copy is wrong would edit the wrong characters; the length is checked,
 *  because that costs nothing and catches the usual mistake of a stale copy. */
export function textops(text: Y.Text, from: string, to: string, origin?: unknown): number {
  if (text.length !== from.length) {
    throw new Error(`textops: the shared text is ${text.length} long, not ${from.length}`)
  }

  const changes = edits(from, to, 'operations')
  if (!changes.length) return 0

  let count = 0
  const apply = () => {
    // Last first, so every earlier edit's offsets still hold when its turn comes.
    for (let at = changes.length - 1; at >= 0; at--) {
      const change = changes[at]
      if (!change) continue

      if (change.to > change.from) {
        text.delete(change.from, change.to - change.from)
        count++
      }
      if (change.insert) {
        text.insert(change.from, change.insert)
        count++
      }
    }
  }

  if (text.doc) text.doc.transact(apply, origin)
  else apply()

  return count
}
