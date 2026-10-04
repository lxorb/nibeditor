/** A task from quick add, written into its note (docs/tasks.md 5.6).
 *
 *  Where it lands: the note `>` named, made where the space has none by that name, the
 *  way a link makes the note it names; else the note the add button belongs to; else
 *  the inbox of the space in front, made the first time. The line goes in through the
 *  one road every write across a space takes (`replaceInNotes`), so a note open in a
 *  pane takes the line as an edit of its own, nothing typed there is lost, and the add
 *  is one thing to undo. Ctrl+Enter opens the note at the line. */

import { insideOnly } from '../automation/inside'
import { changeOf } from '../search/replace'
import { insideSpace, isMarkdownPath, relativeTo, withoutExtension } from '../space-paths'
import { workspace } from '../workspace.svelte'
import { noteText, replaceInNotes } from '../workspace/note-text'
import { writeFile } from '../workspace/write-file'
import { type Entry, linesOf, placeIn } from './entry'

/** The space's notes by name, recent first: what `>` reads and the where control offers. */
export function noteNames(root: string): string[] {
  const recent = new Map(workspace.recent.map((path, index) => [path, index]))
  return workspace.notes
    .filter((one) => isMarkdownPath(one.path))
    .sort((a, b) => (recent.get(a.path) ?? 1e9) - (recent.get(b.path) ?? 1e9))
    .map((one) => withoutExtension(relativeTo(root, one.path)))
}

/** The note a `>` names: one whose path or name is the words, case aside. */
function named(root: string, said: string): string | null {
  const wanted = said.replace(/\.md$/i, '').toLowerCase()
  const found =
    workspace.notes.find(
      (one) => withoutExtension(relativeTo(root, one.path)).toLowerCase() === wanted,
    ) ??
    workspace.notes.find(
      (one) => withoutExtension(one.name).toLowerCase() === wanted.split('/').at(-1),
    )
  return found?.path ?? null
}

/** The path a task goes to, the note made where it is not there yet. Null where the
 *  words name somewhere outside the space, or no space is open. */
async function targetOf(entry: Entry, root: string): Promise<string | null> {
  if (entry.note === undefined) {
    const { inboxNote } = await import('../rows/inbox-note')
    return inboxNote(root)
  }
  const existing = named(root, entry.note)
  if (existing) return existing

  const relative = insideOnly(`${entry.note.replace(/\.md$/i, '')}.md`)
  if (relative === null) return null
  const path = insideSpace(root, relative)
  await writeFile(path, '')
  await workspace.loadTree()
  await workspace.fileCame(path, 'file')
  return path
}

/** Writes the task; answers where it went, or null where it went nowhere. */
export async function addTask(
  entry: Entry,
  options: { open?: boolean; root?: string } = {},
): Promise<{ path: string; line: number } | null> {
  const root = options.root ?? workspace.activeSpace?.root
  if (root === undefined) return null

  const path = await targetOf(entry, root)
  if (path === null) return null

  const before = (await noteText(workspace, path)) ?? ''
  const placed = placeIn(before, linesOf(entry), entry.heading)
  await replaceInNotes(workspace, [
    changeOf(path, before, [{ from: placed.at, to: placed.at, insert: placed.insert }]),
  ])

  if (options.open) {
    await workspace.open(path)
    workspace.goto = { path, line: placed.line }
  }
  return { path, line: placed.line }
}
