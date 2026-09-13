/** Where a web note was left: the place on the page, and the trail behind it.
 *
 *  A web note is a browser tab, so reopening one opens the page that was open at the
 *  place it was open at. Which half of that is kept where is the one rule worth
 *  saying out loud, and docs/web-tabs.md says it:
 *
 *  * **The address is the document.** It is written into the `.url` file, so it syncs
 *    with the note and reopening on another machine opens the page that was open.
 *    See shortcut.ts.
 *  * **The place and the trail are this device's.** A scroll offset is about this
 *    screen at this width, and a trail is a session's own walk; neither belongs in a
 *    file two other programs read. So they live here, in this device's storage,
 *    beside the other things a device decides for itself.
 *
 *  Keyed by the file's path rather than by the tab, because a tab is one visit and the
 *  note is the thing that is opened again: closing the tab and opening the note
 *  tomorrow lands back where the reading was.
 *
 *  Bounded, like everything kept per device: the last two hundred web notes somebody
 *  looked at, oldest first out. */

import { isRecord, keep, stored } from '../stored'

const STORAGE_KEY = 'nib:web-places'

/** How many notes' places are kept. Two hundred is longer than anybody's list of
 *  open sites and small enough to be one string in storage. */
const KEEPS = 200

/** Where one web note was left. */
export interface Place {
  /** The page that was open, which is what the file says too - kept here as well so
   *  that a place is never handed to the wrong page after a sync brought a different
   *  address down. */
  url: string
  /** How far down the page, in the page's own pixels. */
  y: number
  /** And across, for the pages that scroll sideways. */
  x: number
  /** Where the tab had been, oldest first, and where along it the tab was. The
   *  arrows over a page that has just been opened again are right from the first
   *  frame because of this. */
  trail?: string[]
  at?: number
}

function readPlace(value: unknown): Place | null {
  if (!isRecord(value)) return null

  const { url, x, y, trail, at } = value
  if (typeof url !== 'string' || typeof x !== 'number' || typeof y !== 'number') return null

  const walked = Array.isArray(trail)
    ? trail.filter((one): one is string => typeof one === 'string')
    : []

  return {
    url,
    x,
    y,
    ...(walked.length ? { trail: walked } : {}),
    ...(typeof at === 'number' ? { at } : {}),
  }
}

/** Every place this device remembers, read once. */
function all(): Record<string, Place> {
  const read = stored(STORAGE_KEY)
  if (!isRecord(read)) return {}

  const out: Record<string, Place> = {}
  for (const [path, value] of Object.entries(read)) {
    const said = readPlace(value)
    if (said) out[path] = said
  }
  return out
}

/** Where this note was left, or null for one this device has not held open. */
export function placeOf(path: string | null): Place | null {
  if (!path) return null
  return all()[path] ?? null
}

/** Writes down where a note is now. The newest is last, which is what makes the
 *  oldest the one that goes when the list is full. */
export function placeKept(path: string | null, place: Place) {
  if (!path) return

  // Built rather than edited, so that the newest is last however many times this note
  // has been written down before: the order of the keys is what makes the oldest the
  // one that goes when the list is full.
  const held = all()
  const others = Object.entries(held).filter(([one]) => one !== path)
  const kept = [...others.slice(Math.max(0, others.length + 1 - KEEPS)), [path, place] as const]

  // A device that cannot keep this opens the page at the top, which is what a
  // browser with no session does.
  keep(STORAGE_KEY, JSON.stringify(Object.fromEntries(kept)))
}
