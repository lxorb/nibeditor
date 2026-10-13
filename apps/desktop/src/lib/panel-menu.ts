/** What a press on a panel's own tab offers: the file list's rows about what it shows
 *  and makes, the search's order, and on every tab the side it sits on. Built at the
 *  press and fetched with it, so the first paint carries none of it; see Sidebar.svelte. */

import { t } from './i18n.svelte'
import { DIVIDER, type MenuEntry } from './menu-item'
import { search, type SearchSort } from './search.svelte'
import { type Panel, type PanelSide, workspace } from './workspace.svelte'

/** What the Files tab offers besides the order: which files are shown at all, and
 *  what the list makes. */
function sortMenu(making: MenuEntry[]): MenuEntry[] {
  return [
    {
      label: workspace.treeOptions.showHidden ? t('Hide hidden files') : t('Show hidden files'),
      run: () => workspace.toggleHidden(),
    },
    DIVIDER,
    ...making,
  ]
}

/** The order the results are read in. The same menu the file list's sort is,
 *  in the same place - a press on the tab - because it is the same question
 *  about the same space asked of a different list. */
function resultsMenu(): MenuEntry[] {
  const arrow = (key: SearchSort) =>
    search.ordering.sort === key ? (search.ordering.descending ? '↓' : '↑') : undefined

  return [
    {
      label: t('Sort by relevance'),
      hint: arrow('relevance'),
      run: () => search.setSort('relevance'),
    },
    { label: t('Sort by name'), hint: arrow('name'), run: () => search.setSort('name') },
    {
      label: t('Sort by modified'),
      hint: arrow('modified'),
      run: () => search.setSort('modified'),
    },
    {
      label: t('Sort by created'),
      hint: arrow('created'),
      run: () => search.setSort('created'),
    },
  ]
}

/** The rows of panel `id`'s tab, on the side it is on; `making` is what the file list
 *  makes, see `newFileRows` in row-menu.ts. */
export function panelMenu(
  id: Panel,
  side: PanelSide | undefined,
  making: MenuEntry[] = [],
): MenuEntry[] {
  const own = id === 'tree' ? sortMenu(making) : id === 'search' ? resultsMenu() : []
  const there: PanelSide = side === 'right' ? 'left' : 'right'

  // On every tab, and last: which side a panel sits on is a thing to do to the
  // tab rather than a thing the panel is about, so it goes under whatever the
  // panel's own rows are. A phone has no two sides to speak of - the right one
  // is a drawer of its own there - and the row is offered all the same: the
  // choice travels with the window, and a phone in a dock is a wide screen.
  return [
    ...own,
    ...(own.length ? [DIVIDER] : []),
    {
      label: there === 'right' ? t('Move to the right') : t('Move to the left'),
      run: () => workspace.movePanel(id, there),
    },
  ]
}
