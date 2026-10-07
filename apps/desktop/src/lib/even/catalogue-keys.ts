import type { Dictionary } from '../i18n.svelte'

/** The English every catalogue in the plugin is filed under, written once.
 *
 *  A catalogue is a table keyed by its English, and the plugin ships 24 of them: the
 *  same 1,250 keys twenty-four times over, 579 KB of the package, for words that are
 *  already the keys of every other one. So the plugin's build writes the keys here,
 *  once, and each catalogue as a column of its words in the same order; see `inColumn`
 *  in even-catalogues.ts and vite.even.config.ts, which wraps every shipped catalogue
 *  in `rowsOf`. A reader still loads one catalogue, and the table it gets is the one
 *  that was written, row for row.
 *
 *  Only the plugin's build imports this; the app reads its catalogues as written. */

/** Filled in by the build once it knows which rows the package keeps. */
const KEYS: readonly string[] = ['nib-even-catalogue-keys']

/** The marker the build looks for, said once so the two cannot drift. */
export const KEYS_MARK = 'nib-even-catalogue-keys'

/** A catalogue's column back as its table. A table is passed through, so a catalogue
 *  the build did not turn into a column is still a catalogue. */
export function rowsOf(
  column: Dictionary | readonly (Dictionary[string] | undefined)[],
): Dictionary {
  if (!Array.isArray(column)) return column as Dictionary

  const rows: Dictionary = {}
  column.forEach((row: Dictionary[string] | undefined, at) => {
    const english = KEYS[at]
    if (english !== undefined && row !== undefined) rows[english] = row
  })

  return rows
}
