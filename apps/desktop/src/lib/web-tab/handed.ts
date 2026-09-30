/** Web pages another program handed nib, because nib is the browser.
 *
 *  A link clicked in a mail, a chat, a PDF or a terminal reaches the crate as a launch
 *  or a second launch (see src-tauri/src/web_handed.rs), and the crate hands it to one
 *  window: the one in front, else the first. This is that window's half: each page a
 *  tab of its own, beside the tab being read and in front of it, in the space that is
 *  open - so in that space's store of site data - which is what a browser does with a
 *  link from elsewhere. Several at once land in the order they came, the last in front.
 *
 *  Fetched with the rest of the roads in, after the space has restored, rather than
 *  carried in the first paint: the crate holds a link that arrives before this is
 *  listening, and a launch for a link still draws its window first. */

import { log } from '../log'
import { invoke } from '../tauri'
import { workspace } from '../workspace.svelte'
import { isWebAddress } from './address'

/** Listens for pages, takes the ones the app was started for, and answers how to stop.
 *  On this window alone, and listening before asking, because asking is what tells the
 *  crate this window hears them; see `take_startup_pages` in launch.rs. */
export async function hearPages(): Promise<() => void> {
  const { getCurrentWindow } = await import('@tauri-apps/api/window')
  const stop = await getCurrentWindow().listen<unknown>('nib://open-pages', (event) => {
    showPages(event.payload)
  })

  showPages(await invoke<unknown>('take_startup_pages').catch(() => []))
  return stop
}

/** Each page a tab. What crossed from the crate is read as unknown and judged again,
 *  by the rule the address field is held to: the web, and never the app. */
export function showPages(said: unknown) {
  if (!Array.isArray(said)) return

  for (const url of said) {
    if (typeof url === 'string' && isWebAddress(url)) workspace.openPage(url, 'front')
    else log('warn', `web: a page handed over was not one: ${String(url)}`)
  }
}
