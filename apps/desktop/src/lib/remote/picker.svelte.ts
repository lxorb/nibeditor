/** Whether Remote's host picker is up, and what choosing in it does.
 *
 *  Emil, 2026-10-03: Remote is a card of its own beside Terminal, and opens a picker in
 *  the middle of the window built like the space switcher - typed into with no field,
 *  numbered, the pinned and recent hosts first, the groups after. A host chosen is a
 *  terminal tab on it; an address typed that no host has is one made and kept; with
 *  no hosts at all, the one row is the way to Settings, Remote. See HostPicker.svelte.
 *
 *  Light, and the dialog fetched with the first press: nothing of it is in front of the
 *  first paint. */

import { settings } from '../settings.svelte'
import { hostPickerDialog } from '../surfaces.svelte'
import { workspace } from '../workspace.svelte'
import type { Destination, Host } from './hosts'
import { remote } from './hosts.svelte'
import { connectTo, openRemote } from './open'

class HostPicker {
  open = $state(false)

  /** The pane the terminal is for: whichever asked, else whichever had the keyboard. */
  private paneId: string | undefined

  /** Up, with the hosts read again: the config may have been edited since. */
  show(paneId?: string): void {
    void hostPickerDialog.ask()
    void remote.refresh()
    this.paneId = paneId
    this.open = true
  }

  /** Up, or away again: the palette's row pressed twice. */
  toggle(): void {
    if (this.open) this.dismiss()
    else this.show()
  }

  /** Away, and a terminal on that host. */
  choose(host: Host): void {
    this.away()
    void openRemote(host.id)
  }

  /** Away, and a terminal on an address nobody has kept yet. */
  connect(wanted: Destination): void {
    this.away()
    void connectTo(wanted)
  }

  /** Away, to Settings, Remote, where hosts are made. */
  manage(): void {
    this.dismiss()
    settings.show('remote')
  }

  dismiss(): void {
    this.open = false
  }

  private away() {
    this.dismiss()
    if (this.paneId !== undefined) workspace.focusPane(this.paneId)
  }
}

export const hostPicker = new HostPicker()
