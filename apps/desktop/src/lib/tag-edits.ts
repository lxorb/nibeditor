/** Renaming a tag, or taking one away, across a whole space.
 *
 *  A tag is text, so this is a replacement like any other and goes out through
 *  the same door: a list of changes the workspace writes, snapshots and records
 *  as one thing to undo. Which is what makes renaming a tag feel the way renaming
 *  a note does - every note that mentioned it is rewritten, nothing is asked, and
 *  one undo puts all of it back.
 *
 *  A node's whole subtree moves with it. Renaming `work/nib` to `work/core`
 *  rewrites `#work/nib` and `#work/nib/canvas` alike, because only the part of
 *  the tag that is the node's own path is replaced and whatever hung off it is
 *  left where it was. See tagSpans in search/tags.ts. */

import type { Change } from './search/apply'
import { changeOf, type Edit } from './search/replace'
import { tagCuts, tagSpans } from './search/tags'

/** What one note becomes, or null when the tag is not in it.
 *
 *  `to` is the path the node is becoming, or null to take it away. The edits are
 *  the size of the words that changed rather than of the note, so a pane showing
 *  the note takes them without moving anybody's caret. */
export function tagChange(
  path: string,
  before: string,
  from: string,
  to: string | null,
): Change | null {
  const spans = to === null ? tagCuts(before, from) : tagSpans(before, from)
  if (!spans.length) return null

  const edits: Edit[] = []
  let reached = 0

  for (const span of spans) {
    // Two uses cannot overlap, but a cut widened onto the space in front of it
    // can reach back into the one before; the later of the two gives way.
    if (span.from < reached) continue

    edits.push({ from: span.from, to: span.to, insert: to ?? '' })
    reached = span.to
  }

  if (!edits.length) return null

  const change = changeOf(path, before, edits)
  return change.after === before ? null : change
}

/** What every note in the space becomes. Notes that never mentioned the tag are
 *  not in the answer, so nothing is written to them and nothing is snapshotted.
 *
 *  `textOf` reads a note the way a replacement does - through the workspace, so
 *  the words are the ones on screen rather than the ones last written to disk. */
export async function tagChanges(
  paths: readonly string[],
  from: string,
  to: string | null,
  textOf: (path: string) => Promise<string | null>,
): Promise<Change[]> {
  const out: Change[] = []

  for (const path of paths) {
    const before = await textOf(path)
    if (before === null) continue

    const change = tagChange(path, before, from, to)
    if (change) out.push(change)
  }

  return out
}
