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

export interface Carry {
  noteId: string
  note: NoteDoc
  carrying: Carrying
  /** The room let the document go: a new epoch, or the note gone from the account. */
  gone: () => void
}

/** An open note's document, carried through its room from now on. */
export async function carry(key: string, carried: Carry): Promise<void> {
  const token = account.token
  if (!token || rooms.carried.has(key)) return
  const { CarriedRoom } = await import('../rooms/carried')
  if (rooms.carried.has(key) || account.token !== token) return

  const room = new CarriedRoom({
    noteId: carried.noteId,
    token,
    who: { name: deviceName(t('Browser')), accent: deviceAccent(), person: personName() },
    scheme: theme.current,
    onPeers: (count) => {
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
    note: carried.note.live,
    carrying: carried.carrying,
  })
  rooms.carried.set(key, { live: carried.note.live, room })
}

/** Lets a carried document's room go; the document stays the engine's. */
export function uncarry(key: string): void {
  const carried = rooms.carried.get(key)
  if (!carried) return
  carried.room.leave()
  rooms.carried.delete(key)
  rooms.present = without(rooms.present, key)
}
