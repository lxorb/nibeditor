/** Save, asked: the layer that gives a tab with no file its place, hung from the tab
 *  it is for. One at a time; asking again for the tab it is already up for leaves it
 *  where it is, and asking for another tab moves it there.
 *
 *  Mounted here rather than by App.svelte, because nothing else says when it is on the
 *  page and nothing of it is worth a byte before somebody presses a dot or Ctrl+S; see
 *  door.ts, which is the one way in. */

import { mount, unmount } from 'svelte'
import { workspace } from '../workspace.svelte'
import { isUnsaved } from '../workspace/drafts'
import SavePlace from './SavePlace.svelte'

let open: { tab: string; close: () => void } | null = null

/** Asks where the tab goes and under what name: the tab named, else the one in
 *  front. A tab that has a file already has nothing to ask. */
export function askPlace(tabId: string | null): void {
  const tab = workspace.tabs.find((one) => one.id === (tabId ?? workspace.activeTabId))
  if (!tab || !isUnsaved(tab.note) || open?.tab === tab.id) return
  open?.close()

  let shown: ReturnType<typeof mount> | null = null
  const close = () => {
    if (!shown) return
    const going = shown
    shown = null
    if (open?.tab === tab.id) open = null
    void unmount(going, { outro: true })
  }

  shown = mount(SavePlace, {
    target: document.body,
    props: { tab, anchor: anchorOf(tab.id), onclose: close },
  })
  open = { tab: tab.id, close }
}

/** What the layer hangs from: the tab in its strip, or on a phone and a tablet the
 *  name in the bar over the note, which is that strip on a screen that holds one
 *  document. Null where neither is on screen. */
function anchorOf(id: string): DOMRect | null {
  const node =
    [...document.querySelectorAll<HTMLElement>('[data-tab]')].find(
      (one) => one.dataset.tab === id,
    ) ?? document.querySelector('[data-save-anchor]')
  const box = node?.getBoundingClientRect()
  return box && box.width > 0 ? box : null
}
