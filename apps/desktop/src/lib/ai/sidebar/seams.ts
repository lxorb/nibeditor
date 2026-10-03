/** Where the lanes after the panel meet it (docs/ai-sidebar.md 6.5 and 6.6).
 *
 *  - **The commands** (lane 5): `lib/ai/commands/index.ts`, `commands(panel)`, asked each
 *    time the `/` menu opens, since commands written as notes are found in the
 *    background and arrive in the next menu.
 *  - **The changes bar** (lane 3): `lib/ai/review/ChangesBar.svelte`, drawn over the field
 *    with the open thread, once it exists. Found by name through `import.meta.glob`,
 *    which is empty for a file that is not there, so the build is whole before that lane
 *    lands and needs no line changed after.
 *
 *  Both are fetched the first time the panel needs them. */

import type { Component } from 'svelte'
import type { Panel, PanelCommand } from '../commands/types'
import type { Thread } from '../chat/types'

const CHANGES = import.meta.glob<{ default: Component<{ thread: Thread }> }>(
  '../review/ChangesBar.svelte',
)

/** The rows of the `/` menu, as they are now. */
export async function commandsFor(panel: Panel): Promise<readonly PanelCommand[]> {
  return (await import('../commands/index')).commands(panel)
}

/** Lane 3's bar, or null where it has not landed. */
export async function changesBar(): Promise<Component<{ thread: Thread }> | null> {
  const load = Object.values(CHANGES)[0]
  return load ? (await load()).default : null
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
