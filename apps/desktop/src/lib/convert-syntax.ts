/** Convert syntax: another app's spellings, rewritten in notes that are already
 *  here.
 *
 *  A note that arrived some other way than through the import sheet - a folder
 *  copied across, a space synced out of Bear, a note pasted from a friend - can
 *  hold a tag or a link nib does not read the way the app it came from did. This
 *  is the same two rewrites the import does, run on demand; see import/convert.ts
 *  for which two and why those two.
 *
 *  It asks twice, because it writes to files without opening them: once for where,
 *  and once with the count, which is what says whether it is about to do what the
 *  reader thinks. Then it is one thing to undo, however many notes it touched -
 *  the same road a replacement across the space takes. */

import { oneEdit } from '@nib/markdown/edits'

import { plural, t } from './i18n.svelte'
import { converted } from './import/convert'
import type { Change } from './search/apply'
import { changeOf } from './search/replace'
import { workspace } from './workspace.svelte'

/** Every change the conversion would make. Pure, so the count the reader is shown
 *  is worked out by the same code that writes it. */
export function syntaxChanges(
  notes: readonly { path: string; text: string }[],
  names: readonly string[],
): { changes: Change[]; rewrites: number } {
  const changes: Change[] = []
  let rewrites = 0

  for (const note of notes) {
    const said = converted(note.text, names)
    if (!said.changes) continue

    const edit = oneEdit(note.text, said.text)
    if (!edit) continue

    changes.push(changeOf(note.path, note.text, [edit]))
    rewrites += said.changes
  }

  return { changes, rewrites }
}

export async function convertSyntax() {
  const { prompt } = await import('./prompt.svelte')
  const open = workspace.active
  const names = workspace.notes.map((one) => one.name)

  const where =
    open?.path === null || open?.path === undefined
      ? 'space'
      : await prompt.choose({
          title: t('Convert syntax'),
          options: [
            { id: 'note', label: t('In this note'), primary: true },
            { id: 'space', label: t('In the whole space') },
          ],
        })

  if (!where) return

  const notes =
    where === 'note' && open?.path
      ? [{ path: open.path, text: (workspace.flush(), open.doc) }]
      : await everyNote()

  const { changes, rewrites } = syntaxChanges(notes, names)

  if (!rewrites) {
    await prompt.confirm({
      title: t('Nothing here needs converting.'),
      confirmLabel: t('Close'),
    })
    return
  }

  const sure = await prompt.confirm({
    title: plural(rewrites, { one: 'Rewrite {count} thing?', other: 'Rewrite {count} things?' }),
    detail: plural(changes.length, { one: 'In {count} note.', other: 'In {count} notes.' }),
    confirmLabel: t('Rewrite'),
  })

  if (sure) await workspace.replaceInNotes(changes)
}

/** Every note of the space with its words, the open ones as they stand rather
 *  than as they were last saved. */
async function everyNote(): Promise<{ path: string; text: string }[]> {
  workspace.flush()
  const found: { path: string; text: string }[] = []

  for (const entry of workspace.notes) {
    const text = await workspace.noteText(entry.path)
    if (text !== null) found.push({ path: entry.path, text })
  }

  return found
}
