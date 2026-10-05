/** The change a write would make, shown with the question it asked (docs/ai-sidebar.md
 *  4.4): in Approve every write answers `needs_approval` instead of landing, and the
 *  reader is asked about a diff rather than about a sentence.
 *
 *  Worked out the way the write itself would work it out - the same anchors, the same
 *  smallest edit - against the note as it stands, so what is shown is what Approve
 *  does. Calls it cannot work out (a property, a task, a call that names a tab) show
 *  no diff and keep the question's own line. */

import { oneEdit } from '@nib/markdown/edits'
import { plan, readEdits, type Replacement } from '../../agents/docs/edits'
import { type Row, lineDiff, trimmed } from '../../diff'
import { applied } from '../../search/replace'
import { insideSpace, nameOf } from '../../space-paths'
import { verbOf } from './files'

/** A note's words as they stand, by its path on this disk; null for none. */
export type Words = (path: string) => Promise<string | null>

/** What a call would do: the note, and its lines before and after. */
export interface Preview {
  path: string
  rows: Row[]
}

interface Space {
  id: string
  name: string
  root: string
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
}

function said(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

/** The words a call writes, under either name the two servers use. */
function sent(args: Record<string, unknown>): string | null {
  return said(args.content) ?? said(args.text)
}

/** The edits a call makes to `words`, or null for one this cannot work out. */
function editsOf(verb: string, args: Record<string, unknown>, words: string): Replacement[] | null {
  try {
    if (verb === 'edit_note') return plan(readEdits(args.edits), words, null).edits
    if (verb === 'append_note') {
      const content = sent(args)
      if (content === null) return null
      const under = said(args.under)
      const at = under ? { heading: under } : { end: true }
      return plan(readEdits([{ at, insert_after: content }]), words, null).edits
    }
    if (verb === 'write_note' || verb === 'create_note') {
      const content = sent(args)
      if (content === null) return null
      const edit = oneEdit(words, content.replace(/\r\n?/g, '\n'))
      return edit ? [edit] : []
    }
  } catch {
    // An anchor that is not there: the write would be refused, and so is the preview.
  }
  return null
}

/** What a tool call that asked would change, or null. */
export async function previewOf(
  name: string,
  args: unknown,
  spaces: readonly Space[],
  open: string | undefined,
  words: Words,
): Promise<Preview | null> {
  const verb = verbOf(name)
  const given = record(args)
  const path = said(given.path)
  if (!path || said(given.tab)) return null

  const named = said(given.space)
  const space =
    spaces.find((one) => one.id === named || one.name === named) ??
    spaces.find((one) => one.id === open)
  if (!space) return null

  const relative = nameOf(path).includes('.') ? path : `${path}.md`
  const at = insideSpace(space.root, relative)
  const before = verb === 'create_note' ? '' : ((await words(at)) ?? '').replace(/\r\n?/g, '\n')
  const edits = editsOf(verb, given, before)
  if (!edits) return null
  return { path: relative, rows: trimmed(lineDiff(before, applied(before, edits))) }
}
