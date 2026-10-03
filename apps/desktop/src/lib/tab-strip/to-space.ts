/** Move to space, as the tab's menu, a pick of tabs and the palette offer it: which spaces,
 *  the row with them a chevron away, and the question that names one. The move itself is
 *  workspace/moving-space.ts, fetched with the first.
 *
 *  The scratchpad alone is the exception: it is in no space and travels as no tab, it
 *  becomes a note in the space it is moved to - the current one too - and empties for
 *  the next thing; see scratchpad/pad.ts. */

import { t } from '../i18n.svelte'
import type { MenuEntry } from '../menu-item'
import { isScratchpad } from '../scratchpad/is'
import { canWriteAt } from '../sharing.svelte'
import { type Space, type Tab, workspace } from '../workspace.svelte'
import { movingOf, spacesFor } from '../workspace/space-move'

/** Whether these are the scratchpad's tab and nothing else. */
function onlyScratchpad(tabs: readonly Tab[]): boolean {
  return tabs.length === 1 && isScratchpad(tabs[0]?.path)
}

const tabsOf = (ids: readonly string[]) => workspace.tabs.filter((one) => ids.includes(one.id))

/** The spaces these tabs can be moved to. */
export function spacesOf(tabs: readonly Tab[]): Space[] {
  // Any space that may be written in, the one on screen too.
  if (onlyScratchpad(tabs)) return workspace.spaces.filter((one) => canWriteAt(one.root))
  return spacesFor(tabs.map(movingOf), workspace, canWriteAt)
}

/** The tabs moved to a space; see moving-space.ts. */
export async function toSpace(ids: readonly string[], space: string): Promise<void> {
  if (!__EVEN_PLUGIN__ && onlyScratchpad(tabsOf(ids))) {
    const { scratchpad } = await import('../scratchpad/pad')
    await scratchpad.moveTo(space)
    return
  }
  const { moveToSpace } = await import('../workspace/moving-space')
  await moveToSpace(ids, space)
}

/** The spaces to choose from, found by typing, each wearing the switcher's mark. */
export async function askSpace(ids: readonly string[]): Promise<void> {
  const tabs = tabsOf(ids)
  const { prompt } = await import('../prompt.svelte')
  const space = await prompt.find({
    title: t('Move to space'),
    options: spacesOf(tabs).map((one) => ({
      id: one.id,
      label: one.name,
      space: { id: one.id, name: one.name },
    })),
  })
  if (space) await toSpace(ids, space)
}

/** The row: pressed, it asks which space; its chevron lists them. Left out with nowhere
 *  to go. */
export function spaceEntry(tabs: readonly Tab[]): MenuEntry[] {
  const spaces = spacesOf(tabs)
  if (!spaces.length) return []

  const ids = tabs.map((one) => one.id)
  return [
    {
      label: t('Move to space'),
      asks: true,
      run: () => void askSpace(ids),
      more: () =>
        Promise.resolve(
          spaces.map((one) => ({ label: one.name, run: () => void toSpace(ids, one.id) })),
        ),
    },
  ]
}
