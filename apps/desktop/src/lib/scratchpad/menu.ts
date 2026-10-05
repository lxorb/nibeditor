/** The scratchpad glyph's own menu: Move to space, into any space that may be written
 *  in, the one on screen too. Fetched by the right click; see pad.ts. */

import { menu } from '../menu.svelte'
import { canWriteAt } from '../sharing.svelte'
import { spaceRow } from '../tab-strip/to-space'
import { workspace } from '../workspace.svelte'
import { scratchpad } from './pad'

export function padMenu(event: MouseEvent): void {
  const spaces = workspace.spaces.filter((one) => canWriteAt(one.root))
  menu.show(
    event,
    spaceRow(spaces, (space) => void scratchpad.moveTo(space)),
  )
}
