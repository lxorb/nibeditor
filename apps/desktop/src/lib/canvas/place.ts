/** Where a canvas was left on this device: the pan and the zoom.
 *
 *  A canvas is a plane somebody moves around, and coming back to one - switching to
 *  another tab and back, or opening it again tomorrow, or after the app is started
 *  again - should land where the reading was rather than fit the whole plane afresh.
 *  Where the view was is about this screen at this size, so it is this device's to keep
 *  and never the file's: a camera written into a `.canvas` would be a key Obsidian
 *  never wrote and would move the plane under everyone the file syncs to. So it lives
 *  here, beside the web tab's own place - see web-tab/place.ts, which keeps a web note's
 *  scroll offset the same way and for the same reason. The rule in one line is the same
 *  one: the file is the document, and the place is the device's.
 *
 *  Keyed by the file's path, because the plane is the thing opened again and a tab is
 *  one visit to it: closing the canvas and opening it tomorrow lands back where the
 *  reading was. Bounded, like everything kept per device: the last few hundred planes
 *  somebody looked at, oldest first out. */

import type { Camera } from '../camera'
import { isRecord, keep, stored } from '../stored'

const STORAGE_KEY = 'nib:canvas-views'

/** How many planes' views are kept. Longer than anybody's list of open canvases and
 *  small enough to be one string in storage. */
const KEEPS = 300

/** The pan and zoom out of one stored value, or null for anything that is not one. */
function readView(value: unknown): Camera | null {
  if (!isRecord(value)) return null

  const { x, y, scale } = value
  if (typeof x !== 'number' || typeof y !== 'number' || typeof scale !== 'number') return null

  return { x, y, scale }
}

/** Every view this device remembers, read once. */
function all(): Record<string, Camera> {
  const read = stored(STORAGE_KEY)
  if (!isRecord(read)) return {}

  const out: Record<string, Camera> = {}
  for (const [path, value] of Object.entries(read)) {
    const view = readView(value)
    if (view) out[path] = view
  }
  return out
}

/** Where this canvas was left, or null for one this device has not held open. */
export function viewOf(path: string | null): Camera | null {
  if (!path) return null
  return all()[path] ?? null
}

/** Writes down where a canvas is now. The newest is last, which is what makes the
 *  oldest the one that goes when the list is full. */
export function viewKept(path: string | null, view: Camera) {
  if (!path) return

  // Built rather than edited, so the newest is last however many times this plane has
  // been written down before: the order of the keys is what makes the oldest the one
  // that goes when the list is full.
  const held = all()
  const others = Object.entries(held).filter(([one]) => one !== path)
  const kept = [...others.slice(Math.max(0, others.length + 1 - KEEPS)), [path, view] as const]

  // A device that cannot keep this opens the plane fitted to everything on it, which is
  // what a canvas with no place does.
  keep(STORAGE_KEY, JSON.stringify(Object.fromEntries(kept)))
}
