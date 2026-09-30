/** Where Settings > Agents is offered, and which crate it asks.
 *
 *  A desktop's alone: an agent reaches nib through `nib mcp`, the installed app's own
 *  binary, and a phone or a page in a browser has neither that nor the crate that keeps
 *  the grants. The one exception is a stand-in (`fake.ts`), which a test or a drive puts
 *  in front of the pane so it can be seen and pressed where there is no crate.
 *
 *  Small on purpose: the settings list reads it to decide on a row, and the pane itself
 *  is fetched only when that row is pressed. */

import { isDesktop } from '../../tauri'
import type { AgentsCrate } from './crate'

class Reach {
  standIn = $state.raw<AgentsCrate | null>(null)

  get offered(): boolean {
    return isDesktop || this.standIn !== null
  }
}

export const reach = new Reach()
