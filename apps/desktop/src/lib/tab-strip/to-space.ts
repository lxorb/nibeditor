/** Move to space, as the tab's menu, a pick of tabs and the palette offer it: which spaces,
 *  the row with them a chevron away, and the question that names one. The move itself is
 *  workspace/moving-space.ts, fetched with the first. The scratchpad, which is no tab,
 *  asks the same way; see scratchpad/menu.ts. */

import { t } from '../i18n.svelte'
import type { MenuEntry } from '../menu-item'
import { canWriteAt } from '../sharing.svelte'
import { type Space, type Tab, workspace } from '../workspace.svelte'
import { movingOf, spacesFor } from '../workspace/space-move'

const tabsOf = (ids: readonly string[]) => workspace.tabs.filter((one) => ids.includes(one.id))

/** The spaces these tabs can be moved to. */
export function spacesOf(tabs: readonly Tab[]): Space[] {
  return spacesFor(tabs.map(movingOf), workspace, canWriteAt)
}

/** The tabs moved to a space; see moving-space.ts. */
export async function toSpace(ids: readonly string[], space: string): Promise<void> {
  const { moveToSpace } = await import('../workspace/moving-space')
  await moveToSpace(ids, space)
}

/** One of these spaces, found by typing, each wearing the switcher's mark. */
export async function whichSpace(spaces: readonly Space[]): Promise<string | null> {
  const { prompt } = await import('../prompt.svelte')
  return prompt.find({
    title: t('Move to space'),
    options: spaces.map((one) => ({
      id: one.id,
      label: one.name,
      space: { id: one.id, name: one.name },
    })),
  })
}

/** The tabs' spaces, asked. */
export async function askSpace(ids: readonly string[]): Promise<void> {
  const space = await whichSpace(spacesOf(tabsOf(ids)))
  if (space) await toSpace(ids, space)
}

/** The row: pressed, it asks which space; its chevron lists them. Left out with nowhere
 *  to go. */
export function spaceRow(spaces: readonly Space[], move: (space: string) => void): MenuEntry[] {
  if (!spaces.length) return []
  return [
    {
      label: t('Move to space'),
      asks: true,
      run: () => void whichSpace(spaces).then((space) => space && move(space)),
      more: () =>
        Promise.resolve(spaces.map((one) => ({ label: one.name, run: () => move(one.id) }))),
    },
  ]
}

/** The row for these tabs. */
export function spaceEntry(tabs: readonly Tab[]): MenuEntry[] {
  const ids = tabs.map((one) => one.id)
  return spaceRow(spacesOf(tabs), (space) => void toSpace(ids, space))
}
