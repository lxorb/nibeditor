/** Where the commands meet the panel (docs/ai-sidebar.md 6.5).
 *
 *  The commands (lane 5): `lib/ai/commands/index.ts`, `commands(panel)`, asked each time
 *  the `/` menu opens, since commands written as notes are found in the background and
 *  arrive in the next menu.
 *
 *  The review (lane 3) is drawn by the panel's own components, straight from
 *  `lib/ai/review` (6.6). */

import type { Panel, PanelCommand } from '../commands/types'

/** The rows of the `/` menu, as they are now. */
export async function commandsFor(panel: Panel): Promise<readonly PanelCommand[]> {
  return (await import('../commands/index')).commands(panel)
}

const bare = (word: string) => word.toLowerCase().replace(/-/g, '')

/** The rows a few typed letters after `/` mean: a name or a synonym that starts with
 *  them, hyphens ignored either side (`/adddir` finds `/add-dir`, `/reset` finds `/new`),
 *  then a row whose description has a word that does; names first, then synonyms, then
 *  descriptions, the registry's order within each. */
export function matching(rows: readonly PanelCommand[], typed: string): PanelCommand[] {
  const want = bare(typed.trim())
  const byName = rows.filter((one) => bare(one.name).startsWith(want))
  const bySynonym = rows.filter(
    (one) => !byName.includes(one) && one.synonyms.some((word) => bare(word).startsWith(want)),
  )
  const byWords = want
    ? rows.filter(
        (one) =>
          !byName.includes(one) &&
          !bySynonym.includes(one) &&
          (one.description ?? '').split(/\s+/).some((word) => bare(word).startsWith(want)),
      )
    : []
  return [...byName, ...bySynonym, ...byWords]
}

/** A command typed whole, `/name args`, split; null for text that is not one. */
export function commandIn(text: string): { name: string; args: string } | null {
  const found = /^\/([\w-]+)(?:\s+([\s\S]*))?$/.exec(text.trim())
  return found ? { name: found[1] ?? '', args: (found[2] ?? '').trim() } : null
}

/** The row a typed name runs, by name or by synonym, and the name it was typed by where
 *  that was a synonym (`/approve` is a synonym that does something of its own). */
export function rowNamed(
  rows: readonly PanelCommand[],
  name: string,
): { row: PanelCommand; typed?: string } | null {
  const want = name.toLowerCase()
  const own = rows.find((one) => one.name === want)
  if (own) return { row: own }
  const other = rows.find((one) => one.synonyms.includes(want))
  return other ? { row: other, typed: want } : null
}
