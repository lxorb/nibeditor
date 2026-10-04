/** What the app does for a task line in a note (`tasks` on the editor's note index):
 *  the engine's tick, a chip's choices in the app's menu, and a date typed in words read
 *  by quick add's grammar (docs/tasks.md 5.7). Fetched the first time a note asks, never
 *  in the first paint; see `tasks` in link-index.svelte.ts, which stands in for it until
 *  then. */

import type { TaskHelp } from '@nib/editor'
import { dayWords, todayHere } from '@nib/editor/task-days'
import { tick, todayOf } from '@nib/bases'
import { parseQuickAdd } from '@nib/bases/language'
import { i18n } from '../i18n.svelte'
import { quickAdd } from './asked.svelte'
import { pickField } from './task-pick'

export const TASK_HELP: TaskHelp = {
  tick: (note, line) => Promise.resolve(tick(note, line, todayOf())),

  pick: pickField,

  dayAtEnd(text) {
    if (!quickAdd.smart) return null
    const read = parseQuickAdd(text, [i18n.language], new Date())
    const end = text.trimEnd().length
    const chip = read.chips.find((one) => one.kind === 'when' && one.to === end)
    const { due, time } = read.fields
    if (!chip || due === undefined) return null
    return {
      from: chip.from,
      due,
      ...(time === undefined ? {} : { time }),
      label: dayWords(due, todayHere(), time),
    }
  },
}
