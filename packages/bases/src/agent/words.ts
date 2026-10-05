/** A line of words read the way quick add reads it (docs/tasks.md 5.6), for the ways in
 *  that are not quick add's own field: an agent's `add_task` on both servers. The
 *  Tasks plugin's marks written in the words are read first and win; quick add's
 *  grammar reads the rest (`tomorrow 4pm`, `p1`, `every sunday`, `>Note /Heading`). */

import { readTask, type TaskFields } from '@nib/markdown/task-line'
import { parseQuickAdd } from '../language/parse'
import { taskOf } from './entry'
import type { ReadWords } from './tasks'

/** The fields a mark wrote, where the words wrote one. */
const MARKED = [
  'due',
  'scheduled',
  'start',
  'created',
  'time',
  'zone',
  'duration',
  'deadline',
  'recurrence',
  'onCompletion',
  'assignee',
  'id',
  'block',
] as const

/** Every language quick add's grammar reads, after the ones asked for: an agent writes
 *  in whatever language its conversation is in, which need not be the app's, so a German
 *  `morgen um 15 Uhr` from an agent is a date in an English app too, as the account's
 *  connector has always read it. */
const SPOKEN = ['en', 'de']

/** A reader of words in these languages (the reader's first, then every other the
 *  grammar has), as of `now`, knowing the space's note names for `>`. */
export function quickWords(
  langs: readonly string[],
  now: Date,
  notes: readonly string[] = [],
): ReadWords {
  return (said) => {
    const written = readTask(`- [ ] ${said}`)
    const words = written?.text ?? said.trim()
    const quick = parseQuickAdd(words, [...langs, ...SPOKEN], now, { notes })
    const fields: TaskFields = taskOf({ text: quick.text, fields: quick.fields })
    if (written) {
      for (const key of MARKED) {
        if (written[key] !== undefined) Object.assign(fields, { [key]: written[key] })
      }
      if (written.priority !== fields.priority && written.priority !== 4)
        fields.priority = written.priority
      fields.tags = [...new Set([...fields.tags, ...written.tags])]
      if (written.remind.length) fields.remind = [...fields.remind, ...written.remind]
      fields.dependsOn = written.dependsOn
      fields.fields = written.fields
    }
    return {
      fields,
      ...(quick.note === undefined ? {} : { note: quick.note }),
      ...(quick.heading === undefined ? {} : { heading: quick.heading }),
    }
  }
}
