/** The two rows of a space's menu that open into a choice: where the space keeps what
 *  websites store, and whether its tabs are its own. Built alike so they read alike -
 *  the same menu, the word that opened it gone and the choices in its place with the one
 *  in force ticked - and the same words where they mean the same: Global, Space.
 *
 *  Fetched with the press rather than carried, because the space's menu is in front of
 *  the first paint and neither choice is. See web-tab/web-data.ts and workspace/sets.ts. */

import { t } from './i18n.svelte'
import { menu } from './menu.svelte'
import type { WebData } from './web-tab/web-data'
import type { Space } from './workspace.svelte'
import type { TabsMode } from './workspace/sets'

/** The choices in place of the row that asked, the one in force ticked. */
function offer<T extends string>(
  choices: readonly T[],
  said: Record<T, string>,
  now: T,
  choose: (choice: T) => void,
) {
  menu.replace(
    choices.map((choice) => ({
      label: said[choice],
      checked: choice === now,
      run: () => choose(choice),
    })),
  )
}

/** The three places a space may keep its web data. */
export async function showWebData(space: Space) {
  const [{ WEB_DATA }, { webData }] = await Promise.all([
    import('./web-tab/web-data'),
    import('./web-tab/web-data.svelte'),
  ])
  const said: Record<WebData, string> = { global: t('Global'), space: t('Space'), site: t('Site') }
  offer(WEB_DATA, said, webData.of(space.id), (choice) => void chooseWebData(space, choice))
}

/** Keeps the space's web data where it was asked to, and builds its open pages again
 *  in that store, so the choice is on screen at once. Nothing is thrown away: the
 *  store it leaves stays on disk, with its logins in it, for the day it is chosen
 *  again. */
async function chooseWebData(space: Space, choice: WebData) {
  const { webData } = await import('./web-tab/web-data.svelte')
  if (webData.of(space.id) === choice) return

  webData.set(space.id, choice)
  const { pages } = await import('./web-tab/pages.svelte')
  await pages.restore(space.id)
}

/** Whether the space's tabs are the ones every space shares or its own. */
export async function showTabs(space: Space) {
  const [{ TABS_MODES }, { sets }] = await Promise.all([
    import('./workspace/sets'),
    import('./workspace/sets.svelte'),
  ])
  const said: Record<TabsMode, string> = { global: t('Global'), space: t('Space') }
  offer(TABS_MODES, said, sets.modeOf(space.id), (choice) => void sets.choose(space.id, choice))
}
