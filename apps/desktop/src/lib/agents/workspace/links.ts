/** The link index of a space, whichever space it is.
 *
 *  The window keeps one index, of the space it shows, built when the space opens and
 *  kept up to date by every save. An agent asking about another space gets a second
 *  one, built the same way (`scan_links`, one pass in the crate) and never shown to
 *  anything but the agent's verbs: the reader's index, `[[` and the Links panel stay
 *  the open space's (docs/agent-native.md 8.6).
 *
 *  Kept for a minute after it was last asked and then let go, because an index is the
 *  whole space in memory and an agent that asked once about a space may not ask again.
 *  A verb here that writes into that space tells it, or forgets it. */

import { links, spaceLinks } from '../../link-index.svelte'
import { workspace } from '../../workspace.svelte'
import type { Place } from './spaces'

/** How long another space's index is kept after it was last asked for. */
const KEPT = 60_000

type Links = typeof links

interface Held {
  index: Links
  built: Promise<void>
  /** When it is let go, unless asked again first. */
  going: ReturnType<typeof setTimeout> | undefined
  /** Stops it following the file operations; see workspace/file-ops.ts. */
  stop: () => void
}

const held = new Map<string, Held>()

/** The index of a place, built when it is not the open space's and not held already. */
export async function indexOf(place: Place): Promise<Links> {
  if (place.open) {
    await links.scanned()
    return links
  }

  const root = place.space.root
  let found = held.get(root)
  if (!found) {
    const index = spaceLinks()
    index.archivedIn = (of) => workspace.archive.keysOf(of)
    // A file of that space moving or going is said once, like any other, and this
    // index hears it the way the window's does; one of another space is not its own.
    const stop = workspace.fileOps.follow((op) => index.follow(op))
    found = { index, built: index.build(root), going: undefined, stop }
    held.set(root, found)
  }

  clearTimeout(found.going)
  found.going = setTimeout(() => letGo(root), KEPT)
  await found.built
  return found.index
}

function letGo(root: string) {
  held.get(root)?.stop()
  held.delete(root)
}

/** The index of another space, only when one is already held: what a write there
 *  tells, so the next question is answered as the space now is. */
export function heldIndex(place: Place): Links | null {
  return place.open ? links : (held.get(place.space.root)?.index ?? null)
}

/** Every index of another space let go: what the tests start from. */
export function forgetIndexes(): void {
  for (const [root, one] of held) {
    clearTimeout(one.going)
    letGo(root)
  }
}
