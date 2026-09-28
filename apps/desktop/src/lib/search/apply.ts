/** What a replacement across the space would do, worked out before anything is
 *  written.
 *
 *  Each note that still has a ticked hit is read once and searched again, so
 *  what is replaced is what the note says now rather than what it said when
 *  the list was drawn. The result is a plain list of changes; writing them,
 *  taking the snapshots and remembering how to undo the lot is the workspace's
 *  job, which is the one that owns files. */

import { relativeTo } from '../space-paths'
import { type Hit, Matcher } from './match'
import type { Query } from './query'
import { changeOf, type Edit, replaceIn } from './replace'

export interface Change {
  path: string
  /** What the note said, so the snapshot and the undo have it. */
  before: string
  after: string
  /** The words that changed, for the panes showing the note. */
  edits: Edit[]
  /** The same the other way round, for undoing it later. */
  back: Edit[]
}

/** The lines that were ticked, gathered per note. */
function linesPerNote(hits: readonly Hit[]): Map<string, Set<number>> {
  const out = new Map<string, Set<number>>()

  for (const hit of hits) {
    const held = out.get(hit.path)
    if (held) held.add(hit.line)
    else out.set(hit.path, new Set([hit.line]))
  }

  return out
}

export async function changesFor(
  query: Query,
  hits: readonly Hit[],
  replacement: string,
  root: string,
  textOf: (path: string) => Promise<string | null>,
): Promise<Change[]> {
  const matcher = new Matcher(query)
  const out: Change[] = []

  for (const [path, lines] of linesPerNote(hits)) {
    const before = await textOf(path)
    if (before === null) continue

    const relative = relativeTo(root, path)
    const name = relative.split('/').pop() ?? relative
    const spans = matcher.spans({ path, relative, name, body: before })
    if (!spans) continue

    const edits = replaceIn(before, spans, lines, replacement)
    if (edits) out.push(changeOf(path, before, edits))
  }

  return out
}
