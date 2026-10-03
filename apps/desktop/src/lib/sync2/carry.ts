/** Sync v2's rooms: an open note's document the engine keeps, carried live through its
 *  room (rooms/carried.ts), by document key. Kept here rather than in rooms.svelte.ts,
 *  which is in front of the first paint: that file only reaches these with the caret,
 *  the scheme and the name, as it reaches its own (`rooms.carried`). */

import { account } from '../account.svelte'
import { busy } from '../busy.svelte'
import { t } from '../i18n.svelte'
import { without } from '../records'
import { rooms } from '../rooms.svelte'
import type { Carrying } from '../rooms/door'
import { deviceAccent, deviceName, personName } from '../rooms/who'
import { theme } from '../theme.svelte'
import type { NoteDoc } from '../workspace/documents.svelte'
import type { InkStroke } from '../canvas/format'
import type { Point } from '../canvas/geometry'
import type { PlaneSurface } from '../canvas/shared'

export interface Carry {
  noteId: string
  /** A note's views, or a canvas's surface: who else is there is drawn on it. */
  on: { note: NoteDoc } | { surface: PlaneSurface }
  carrying: Carrying
  /** The room let the document go: a new epoch, or the note gone from the account. */
  gone: () => void
}

/** An open note's document, carried through its room from now on. Answers the room, for
 *  a canvas to hand its pointer to. */
export async function carry(
  key: string,
  carried: Carry,
): Promise<{ hand?: (at: Point | null, drawing: InkStroke | null) => void } | null> {
  const token = account.token
  if (!token || rooms.carried.has(key)) return null
  const { CarriedRoom, CarriedPlaneRoom } = await import('../rooms/carried')
  if (rooms.carried.has(key) || account.token !== token) return null

  const entering = {
    noteId: carried.noteId,
    token,
    who: { name: deviceName(t('Browser')), accent: deviceAccent(), person: personName() },
    scheme: theme.current,
    onPeers: (count: number) => {
      rooms.present = count ? { ...rooms.present, [key]: count } : without(rooms.present, key)
    },
    gone: () => {
      uncarry(key)
      carried.gone()
    },
    refused: () => {
      uncarry(key)
      busy.failed(t('This note is as large as a note in a room may get.'))
    },
    holds: () => true,
    carrying: carried.carrying,
  }
  if ('surface' in carried.on) {
    const room = new CarriedPlaneRoom({ ...entering, surface: carried.on.surface })
    rooms.carried.set(key, { live: carried.on.surface, room })
    return room
  }
  const room = new CarriedRoom({ ...entering, note: carried.on.note.live })
  rooms.carried.set(key, { live: carried.on.note.live, room })
  return {}
}

/** Lets a carried document's room go; the document stays the engine's. */
export function uncarry(key: string): void {
  const carried = rooms.carried.get(key)
  if (!carried) return
  carried.room.leave()
  rooms.carried.delete(key)
  rooms.present = without(rooms.present, key)
}
