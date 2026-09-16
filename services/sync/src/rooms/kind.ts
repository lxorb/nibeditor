/** What a room's shared document holds, and how it becomes a file again.
 *
 *  A room is one Durable Object per file, and the two kinds of file that are
 *  written in together want different shapes. A note is prose, so its document is
 *  one `Y.Text` and two people typing in a paragraph get their letters
 *  interleaved. A canvas is not prose: everything on it has an id, and two people
 *  drawing want both drawings whole, so its document is a map of objects by id;
 *  see plane.ts in @nib/rooms.
 *
 *  The file's name is what decides the shape of a room that holds nothing yet, so
 *  the door can say it in one header. After that the shape belongs to the document:
 *  a room woken from a sleep reads it back out of its own storage, and a file
 *  renamed across the two kinds does not make the plane in the room into prose. What
 *  happens then is `crossed` in room.ts. Everything else about a room - the sockets,
 *  the snapshot, the log, the settle on an alarm - is the same either way, which is
 *  why there is one object class rather than two.
 *
 *  This file is that difference and nothing more: what fills an empty document, what
 *  the settle writes, and the two questions a settle asks before it writes at all. */

import { readCanvas, writeCanvas } from '@nib/markdown/canvas'
import { isCanvasTarget, isPagesTarget } from '@nib/markdown/links'
import { TEXT } from '@nib/rooms'
import { fold } from '@nib/rooms/fold'
import { planeIsEmpty, pushPlane, readPlane, seedPlane } from '@nib/rooms/plane'
import type * as Y from 'yjs'

/** The two shapes a room's document comes in. */
export type RoomKind = 'words' | 'plane'

const KINDS: readonly RoomKind[] = ['words', 'plane']

/** Which shape the room for a file has.
 *
 *  A page note - `.pages` - is a plane too, and the same one. Its file is JSON
 *  Canvas with pages among the nodes, read and written by the very functions below,
 *  so the document a room holds and the bytes a settle writes are the same either
 *  way. Which means a file renamed between the two extensions is not a crossing at
 *  all: the room keeps its plane, the settle keeps writing it, and nothing is lost
 *  in either direction. See `crossed` in room.ts for what a real crossing costs,
 *  and rooms/kind.ts in the app, which states this same rule for the other end. */
export function roomKind(path: string): RoomKind {
  return isCanvasTarget(path) || isPagesTarget(path) ? 'plane' : 'words'
}

/** What a website is doing in neither list: nothing, because no client asks for a
 *  room for one. A `.url` file holds an address and no words, so there is no document
 *  in it for two people to be in at once - the app refuses it at both ends, in
 *  `holdsWords` and in its own rooms/kind.ts, and a file the door is never asked
 *  about needs no shape here. It syncs like every other note; see notes.ts. */

/** A kind that came off a header or out of storage, which is to say a kind that
 *  has not been checked yet. Anything unrecognised is words: that is what a room
 *  about a file this build has never heard of can always be read as. */
export function kindOf(value: unknown): RoomKind {
  return KINDS.find((kind) => kind === value) ?? 'words'
}

/** Whether the door said this socket may write, off the header it said it on.
 *
 *  Only the word yes is yes. It is the one flag between a reader and the words,
 *  and the door is the only thing that can set it, so anything else - a header
 *  left out, an empty one, a spelling this build does not know - is a socket that
 *  reads. Here beside `kindOf` because it is the same job: a header value is not
 *  to be trusted until something has looked at it. */
export function writesOf(value: unknown): boolean {
  return value === 'yes'
}

/** The room's first content, out of the file as the store holds it. */
export function fill(kind: RoomKind, doc: Y.Doc, stored: string) {
  if (kind === 'plane') {
    seedPlane(doc, readCanvas(stored))
    return
  }

  if (stored) doc.getText(TEXT).insert(0, stored)
}

/** The file as the store now holds it, taken into a room's document as the edit it
 *  is.
 *
 *  For a room that wakes to find the note has moved while it was away and holds
 *  nothing of its own to weigh against it; see `caughtUp` in room.ts. An edit rather
 *  than a second seed, for two reasons: seeding a document that already holds a plane
 *  would put every card on it twice, and an edit is a thing every device in the room
 *  hears - so a note nobody has typed in since simply becomes what the file says, on
 *  every screen showing it.
 *
 *  `held` is what the document says now, which the caller has read already. */
export function takeInto(kind: RoomKind, doc: Y.Doc, held: string, file: string) {
  if (kind === 'plane') {
    pushPlane(doc, readCanvas(held), readCanvas(file))
    return
  }

  // One replacement, the shared front and back left alone, so a caret in either
  // stays where its words are; see fold.ts.
  const change = fold(held, file)
  if (!change) return

  const text = doc.getText(TEXT)
  doc.transact(() => {
    text.delete(change.from, change.to - change.from)
    text.insert(change.from, change.insert)
  })
}

/** Whether reading this document as `kind` would leave a drawing behind.
 *
 *  Read as words, a document is the prose in it and nothing else. So a plane with
 *  anything at all on it is a drawing the file is not about to be given: the empty
 *  string where the prose is empty too, which is how a canvas came to be written
 *  over with nothing, and a drawing quietly dropped where it is not.
 *
 *  Only that way round. A `Y.Text` inside a plane's document is what a client that
 *  joined the wrong kind of room leaves behind when it offers the file it was
 *  holding - a copy of something the file already has - and refusing the settle
 *  over that would stop a canvas that is working from ever saving again. */
export function leavesAPlane(kind: RoomKind, doc: Y.Doc): boolean {
  return kind === 'words' && !planeIsEmpty(doc)
}

/** Whether this document has never held anything at all: not a keystroke, not a
 *  card, not even one that was taken away again.
 *
 *  What tells a file somebody emptied from a document that never arrived. Both read
 *  as nothing and only one of them should be written down: deleting every word of a
 *  note means an empty file, and that is what the file should become. A document
 *  that was read back and came out with no history at all was not read back - a
 *  snapshot whose bytes were not bytes leaves exactly that - and writing its
 *  nothing into a file that has something is the file gone.
 *
 *  Yjs keeps an entry for every client that ever wrote into a document, so an
 *  emptied note has one and a document nothing ever reached has none. */
export function neverHeld(doc: Y.Doc): boolean {
  return doc.store.clients.size === 0
}

/** The room's content as the file it settles into. Byte for byte the file the app
 *  would have written from the same content, so everything downstream of a
 *  settle - the file sync, publishing, the connector, exports, Obsidian - reads it
 *  as an ordinary edit made somewhere else. */
export function fileOf(kind: RoomKind, doc: Y.Doc): string {
  return kind === 'plane' ? writeCanvas(readPlane(doc)) : doc.getText(TEXT).toJSON()
}
