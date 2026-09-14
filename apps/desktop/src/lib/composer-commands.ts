/** The three ways to move text between notes, as things the app can be asked to
 *  do: from the palette and from the editor's own menu.
 *
 *  Each needs the caret or the selection, so each is built against the live view;
 *  each is offered only where it could work, because a menu of things that cannot
 *  happen is worse than a short one. The arithmetic is in composer.ts and the
 *  files are workspace's; this is only the asking. */

import type { EditorView } from '@nib/editor'
import type { Command } from './commands'
import { t } from './i18n.svelte'
import type { MenuEntry } from './menu.svelte'
import { shownName } from './note-name'
import { workspace } from './workspace.svelte'

/** The note to merge into, found by typing its name in the prompt sheet - which
 *  is the same sheet every other question uses, and the only shape that works
 *  for a space holding thousands of answers. */
async function askForNote(exclude: string): Promise<string | null> {
  const { prompt } = await import('./prompt.svelte')
  const options = workspace.notes
    .filter((note) => note.path !== exclude)
    .map((note) => ({ id: note.path, label: shownName(note.name) }))

  if (!options.length) return null

  return prompt.find({ title: t('Merge into'), options, placeholder: t('Note') })
}

/** Whether there is a selection to lift out of the note. */
function hasSelection(view?: EditorView): boolean {
  return !!view && !view.state.selection.main.empty && !view.state.readOnly
}

/** Whether there is anything after the caret to make a note of. */
function hasRest(view?: EditorView): boolean {
  if (!view || view.state.readOnly) return false
  const at = view.state.selection.main.head
  return view.state.doc.sliceString(at).trim().length > 0
}

export function composerCommands(view?: EditorView): Command[] {
  const path = workspace.active?.path ?? null

  return [
    {
      id: 'merge-into',
      label: t('Merge into…'),
      disabled: !path || workspace.notes.length < 2,
      run: () => {
        if (path) void merge(path)
      },
    },
    {
      id: 'split-at-caret',
      label: t('Split at caret'),
      disabled: !path || !hasRest(view),
      run: () => {
        if (view) void workspace.splitAtCaret(view.state.selection.main.head)
      },
    },
    {
      id: 'extract-selection',
      label: t('Extract selection'),
      disabled: !path || !hasSelection(view),
      run: () => {
        if (!view) return
        const range = view.state.selection.main
        void workspace.extractSelection(range.from, range.to)
      },
    },
  ]
}

async function merge(path: string) {
  const into = await askForNote(path)
  if (into) await workspace.mergeInto(path, into)
}

/** The same three for the editor's context menu, which takes labels and a `run`
 *  rather than commands with ids. */
export function composerEntries(view?: EditorView): MenuEntry[] {
  return composerCommands(view).map((command) => ({
    label: command.label,
    disabled: command.disabled ?? false,
    run: command.run,
  }))
}
