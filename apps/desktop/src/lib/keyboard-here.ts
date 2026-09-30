import { invoke } from './tauri'

/** The keyboard back to this window's own page, from a web tab's page that holds it.
 *
 *  A page out of sight keeps the keyboard, so a site's question under a web tab's bar,
 *  a pairing request and a row of a Mac's menu bar each take it back first. A window in
 *  the background is not brought forward by that; it only knows where the keys go once
 *  somebody comes back to it.
 *
 *  Asked of the crate rather than of the Tauri API, because the crate says no in a run
 *  whose windows were sent off the screen: there a page taking the keyboard activates a
 *  window nobody can see, and on 2026-09-30 such a window was in front of somebody
 *  working. See `keyboard_to` in src-tauri/src/placement.rs. */
export async function keyboardHere(): Promise<void> {
  await invoke('take_keyboard').catch(() => undefined)
}
