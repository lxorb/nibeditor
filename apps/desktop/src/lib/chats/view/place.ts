/** Where a small layer goes beside what was pressed: under it with their start edges
 *  lined up, above it where there is no room below, and always inside the window. The
 *  profile card's rule (people/ProfileCard.svelte), said once for every layer a chat
 *  puts up: the emoji picker, the pins, the members, who reacted. Pure. */

export interface Box {
  left: number
  top: number
  right: number
  bottom: number
}

const GAP = 6
const ROOM = 8

export function placeNear(
  at: Box,
  size: { width: number; height: number },
  window: { width: number; height: number },
  end = false,
): { left: number; top: number } {
  const wanted = end ? at.right - size.width : at.left
  const left = Math.min(Math.max(ROOM, wanted), window.width - size.width - ROOM)
  const below = at.bottom + GAP
  const top =
    below + size.height + ROOM > window.height ? Math.max(ROOM, at.top - GAP - size.height) : below
  return { left: Math.max(ROOM, left), top }
}
