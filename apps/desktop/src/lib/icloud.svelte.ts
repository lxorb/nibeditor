/** Which files iCloud is bringing back to this Mac this moment.
 *
 *  A note iCloud has taken off the Mac is listed under its own name with a cloud
 *  beside it, and opening it asks for it back; see notes/icloud.rs in the crate,
 *  which tells the window when a file sets off and when it has arrived. While it is
 *  on its way the cloud on its row pulses, which is how Finder says the same thing,
 *  and once it is here the file list is read again, so the row is an ordinary row.
 *
 *  Listening starts with the first cloud drawn, so a space with nothing in iCloud,
 *  and every platform but a Mac, never listens at all. */

import { SvelteSet } from 'svelte/reactivity'
import { isDesktop } from './tauri'

/** What the crate says about one file, as its event carries it. */
export interface Fetching {
  path: string
  done: boolean
}

const EVENT = 'nib://icloud'

class ICloud {
  /** The files on their way, by path. */
  readonly coming = new SvelteSet<string>()
  private listening = false

  /** Starts hearing the crate, once. */
  listen() {
    if (this.listening || !isDesktop) return
    this.listening = true

    void import('@tauri-apps/api/event').then(({ listen }) =>
      listen<Fetching>(EVENT, (event) => this.heard(event.payload)),
    )
  }

  /** One word from the crate. An arrival reads the file list again: the
   *  placeholder is gone and the note is there, and a row still wearing a cloud
   *  would say otherwise. */
  heard(one: Fetching) {
    if (!one.done) {
      this.coming.add(one.path)
      return
    }

    this.coming.delete(one.path)
    void import('./workspace.svelte').then(({ workspace }) => workspace.loadTree())
  }
}

export const icloud = new ICloud()
