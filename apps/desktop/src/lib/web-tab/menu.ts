/** The rows behind the dots on a web tab's bar: Chrome's menu, with what nib has.
 *
 *  Emil, 2026-09-13: *"Our browser related menu structure should be very similar to
 *  that of chrome. And in general we don't want to reinvent how a browser works."* So
 *  these are Chrome's rows, in Chrome's order, in Chrome's words, bent onto the thing
 *  nib already has wherever the two differ:
 *
 *  | Chrome | here |
 *  | --- | --- |
 *  | New tab | a web tab with nowhere to go yet, which is what the address field is for |
 *  | Bookmarks | the space's own web notes, which is what a bookmark is here |
 *  | Zoom | the engine's own zoom, on Chrome's own ladder of steps |
 *  | Save page | the clipper: the page, written into the space as a note |
 *  | Share | nib's share sheet |
 *  | Settings | the app's settings |
 *
 *  **What is not here is what the page's own menu already has.** Back, forward, reload,
 *  save as, print, view page source, inspect; open a link in a new tab, copy a link
 *  address; open an image in a new tab, copy an image; copy a selection, search the web
 *  for it. Those are the engine's own context menus - Chromium's on Windows, `WebKit`'s
 *  elsewhere - in the reader's own language, with the engine's own behaviour behind every
 *  row. A second copy of them written here would be worse at every one of them, and
 *  writing one is exactly the reinventing Emil asked us not to do. See docs/web-tabs.md,
 *  which lists what a browser has that this menu still does not.
 *
 *  Nothing here decides anything: every row is handed back up to the tab. */

import { copyText } from '../clipboard'
import { t } from '../i18n.svelte'
import { DIVIDER, type MenuEntry } from '../menu.svelte'
import { openExternal } from '../tauri'
import type { Page } from './pages.svelte'

/** The sizes a page can be drawn at, as multipliers.
 *
 *  Chrome's own ladder, so that `-` and `+` step where a reader expects them to and
 *  100% is one of the rungs rather than a number somebody has to land on. */
export const ZOOMS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3]

/** The next rung up or down from wherever the page is now, and the same rung at either
 *  end of the ladder. */
export function zoomed(from: number, up: boolean): number {
  const steps = up ? ZOOMS : [...ZOOMS].reverse()
  return steps.find((one) => (up ? one > from + 0.001 : one < from - 0.001)) ?? from
}

/** Everything the dots can ask the tab for. One object rather than nine arguments,
 *  because the bar hands the whole of it over and a row that grows an argument should
 *  not be a change at every call site. */
export interface WebActions {
  /** A web tab with nowhere to go yet. */
  newTab: () => void
  /** The space's web notes, which is what a bookmark is here. */
  bookmarks: () => void
  zoom: (factor: number) => void
  fullScreen: () => void
  print: () => void
  /** The clipper: the page, written into the space as a note. */
  save: () => void
  share: () => void
  settings: () => void
}

/** Chrome's menu for the page in this tab. `zoom` is how large it is being drawn now,
 *  because the middle of the three zoom rows says so. */
export function webRows(page: Page, zoom: number, actions: WebActions): MenuEntry[] {
  const url = page.url
  const has = url !== null

  return [
    { label: t('New tab'), run: actions.newTab },
    DIVIDER,
    { label: t('Bookmarks'), run: actions.bookmarks },
    DIVIDER,
    // Chrome's zoom is three controls on one line and the menu stays up while they are
    // used. A menu here is rows, so it is three rows that keep the menu open - and the
    // middle one says the size and resets it, which is what Chrome's middle control
    // does when it is pressed.
    {
      label: t('Zoom out'),
      disabled: !has || zoom <= ZOOMS[0]!,
      keep: true,
      run: () => actions.zoom(zoomed(zoom, false)),
    },
    {
      label: `${Math.round(zoom * 100)}%`,
      disabled: !has,
      keep: true,
      run: () => actions.zoom(1),
    },
    {
      label: t('Zoom in'),
      disabled: !has || zoom >= ZOOMS[ZOOMS.length - 1]!,
      keep: true,
      run: () => actions.zoom(zoomed(zoom, true)),
    },
    { label: t('Full screen'), run: actions.fullScreen },
    DIVIDER,
    { label: t('Print…'), disabled: !has, run: actions.print },
    DIVIDER,
    { label: t('Save page'), disabled: !has, run: actions.save },
    { label: t('Share…'), disabled: !has, run: actions.share },
    {
      label: t('Copy link'),
      disabled: !has,
      run: () => {
        if (url !== null) void copyText(url)
      },
    },
    { label: t('Open in the browser'), disabled: !has, run: () => void openExternal(url ?? '') },
    DIVIDER,
    { label: t('Settings'), run: actions.settings },
  ]
}
