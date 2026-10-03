/** A tab carried onto a space in the switcher: held over the switcher's button it opens
 *  the list, as macOS opens a folder under a file held over it, and let go of on a space's
 *  row it moves there - Arc's tab dropped on a space's icon. The row lights as the file
 *  list's does under a drop. Leaving the list closes what the hold opened.
 *
 *  The switcher itself only says which element is which (`data-space-drop`) and how a lit
 *  one looks; everything else is here, fetched with the drag, so nothing of it is in front
 *  of the first paint. See SpaceSwitcher.svelte and carrying.ts. */

import { workspace } from '../workspace.svelte'
import { spacesOf, toSpace } from './to-space'

const ATTRIBUTE = 'data-space-drop'
/** What the switcher's own button says, where a row says its space's id. */
const SWITCHER = 'switcher'
/** The class a lit button or row wears. */
const LIT = 'is-drop'
/** How long a tab is held over the button before the list opens: about what macOS waits
 *  before it opens a folder under a held file. */
const SPRING = 450

/** What the tab is over now, lit. */
let over: HTMLElement | null = null
/** The button whose list the hold opened, to close again. */
let sprung: HTMLElement | null = null
let opening: ReturnType<typeof setTimeout> | undefined

/** The tab is at `point`, or over nothing of the switcher's where that is null. */
export function overSpaces(tabId: string, point: { x: number; y: number } | null): void {
  const under = point ? document.elementFromPoint(point.x, point.y) : null
  const found = under?.closest<HTMLElement>(`[${ATTRIBUTE}]`) ?? null
  const said = found?.getAttribute(ATTRIBUTE)
  const tab = workspace.tabs.find((one) => one.id === tabId)
  const lands =
    said === SWITCHER || (tab !== undefined && spacesOf([tab]).some((one) => one.id === said))
  light(found && lands ? found : null)

  // Out of the list the hold opened, and off its button: it closes again.
  if (sprung && under?.closest('[role="menu"]') == null && found !== sprung) close()
}

/** Let go of: moved to the space whose row is lit. Answers whether it was. */
export function droppedOnSpace(tabId: string): boolean {
  const space = over?.getAttribute(ATTRIBUTE) ?? null
  light(null)
  close()
  if (space === null || space === SWITCHER) return false

  void toSpace([tabId], space)
  return true
}

function light(element: HTMLElement | null) {
  if (element === over) return
  over?.classList.remove(LIT)
  element?.classList.add(LIT)
  over = element

  clearTimeout(opening)
  const button = element?.getAttribute(ATTRIBUTE) === SWITCHER ? element : null
  if (button && button.getAttribute('aria-expanded') !== 'true') {
    opening = setTimeout(() => {
      sprung = button
      button.click()
    }, SPRING)
  }
}

/** The list the hold opened, closed by the button that opened it. */
function close() {
  clearTimeout(opening)
  const button = sprung
  sprung = null
  if (button?.getAttribute('aria-expanded') === 'true') button.click()
}
