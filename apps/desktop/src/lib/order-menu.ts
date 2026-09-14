/** What each of the seven orders the file list can be read in is called, and the menu
 *  that offers them.
 *
 *  Fetched by the press that opens it. The words are seven rows a window does not need
 *  before it draws one, and the order in force is on screen without the menu being
 *  built at all - it is what the rows are in. So this arrives with the press, the way
 *  lib/ai/ask.ts fetches what answers a question; see tree-order.ts for the orders
 *  themselves, and docs/tree.md.
 *
 *  One builder, because the glyph at the end of the panel's header and a right click on
 *  the Files tab ask the same question: the button is where a reader finds it, and the
 *  tab menu is where the list's sorting has always been. */

import { t } from './i18n.svelte'
import { DIVIDER, type MenuEntry } from './menu.svelte'
import { SORT_MODES, type SortMode } from './tree-order'
import { workspace } from './workspace.svelte'

/** Spelled out rather than built from a key and a direction, because that is what a
 *  reader reads: `Modified, newest first` says which way round it is, where a direction
 *  arrow beside `Sort by modified` left them to work out whether the arrow meant the
 *  newest or the oldest. Seven rows is also the whole answer in one glance, which a
 *  control that flips when you press it twice never is. */
const WORDS: Record<SortMode, () => string> = {
  name: () => t('Name, A to Z'),
  'name-desc': () => t('Name, Z to A'),
  'modified-desc': () => t('Modified, newest first'),
  'modified-asc': () => t('Modified, oldest first'),
  'created-desc': () => t('Created, newest first'),
  'created-asc': () => t('Created, oldest first'),
  manual: () => t('Manual'),
}

/** What the button at the end of the header says about itself, and the title the
 *  sheet a phone shows carries. Here rather than at the two call sites, so the words
 *  and the rows they open are in one file. */
export function orderTitle(): string {
  return t('Order of the files')
}

export function orderMenu(): MenuEntry[] {
  const here = workspace.sortMode
  const row = (mode: SortMode) => ({
    label: WORDS[mode](),
    checked: here === mode,
    run: () => workspace.setSort(mode),
  })

  // A rule between the rules and the one order that is nobody's rule: what the first
  // six read off the notes, and what the reader arranged themselves.
  const [byName, backwards, ...rest] = SORT_MODES
  const arranged = rest.pop()

  return [
    ...(byName ? [row(byName)] : []),
    ...(backwards ? [row(backwards)] : []),
    DIVIDER,
    ...rest.map(row),
    DIVIDER,
    ...(arranged ? [row(arranged)] : []),
  ]
}
