/** A tab carried onto the bookmarks: let go of over the tiles, the file it holds is
 *  bookmarked where it was let go of - Arc's and Zen's tab dragged up into the
 *  Favorites, the Essentials. The tab itself stays where it was: a bookmark is a way
 *  back to a file, not a place the tab moves to.
 *
 *  The panel only says which element takes a tab (`data-bookmark-drop`) and which
 *  bookmark each tile is (`data-at`), and draws the line `landing` says;
 *  everything else is here, fetched with the drag. See Bookmarks.svelte and
 *  carrying.ts. */

import { landing, place } from '../essentials.svelte'
import type { Bookmark } from '../workspace/bookmarks.svelte'
import { workspace } from '../workspace.svelte'

const ATTRIBUTE = 'data-bookmark-drop'

/** The bookmark the tab would be: the file it holds, in this space. Null for a tab with
 *  no file yet, and for one of another space's files, which this list cannot keep. */
function markOf(tabId: string): Bookmark | null {
  const path = workspace.tabs.find((one) => one.id === tabId)?.path
  return path ? workspace.bookmarks.forEntry({ path, is_dir: false }) : null
}

/** The tab is at `point`, or over nothing of the bookmarks' where that is null. */
export function overBookmarks(tabId: string, point: { x: number; y: number } | null): void {
  const under = point ? document.elementFromPoint(point.x, point.y) : null
  const zone = under?.closest<HTMLElement>(`[${ATTRIBUTE}]`)
  if (!point || !zone || !markOf(tabId)) {
    landing.clear()
    return
  }

  // Beside the bookmark nearest, or at the end of a grid that holds none yet.
  if (!landing.near(zone, point.x, point.y)) landing.over(workspace.bookmarks.list.length, false)
}

/** Let go of: bookmarked where the line was. Answers whether it was. */
export function droppedOnBookmarks(tabId: string): boolean {
  const at = landing.at
  const after = landing.after
  landing.clear()

  const mark = markOf(tabId)
  if (at === null || !mark) return false

  place([mark], after ? at + 1 : at)
  return true
}
