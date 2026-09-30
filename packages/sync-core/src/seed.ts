/** A document's first content, made the same way on every device.
 *
 *  A note that existed before it had a document, or that something without a
 *  document wrote as text (a v1 app, the connector, a rollback), gets one by being
 *  seeded: an empty Yjs document into which the text goes as one insert. Two devices
 *  that each seed the same note from the same text must end up holding one text, not
 *  two - and two inserts of equal words by two clients are two runs of characters
 *  that Yjs keeps side by side, which is exactly the doubled note Obsidian is known
 *  for. So the insert is made under a client id that is a function of the note and
 *  its epoch rather than of the device: the same text then encodes to the same bytes
 *  everywhere, and Yjs, meeting operations it already has, keeps them once. See
 *  docs/sync-v2.md section 5.3.
 *
 *  The id is used for the seed and never again. Everything typed afterwards is typed
 *  under the device's own id, or under the room's, which is `hash32(noteId,
 *  'account')`.
 *
 *  Nothing here knows about a disk or a socket; a caller persists or sends the bytes. */

import type { Canvas } from '@nib/markdown/canvas'
import { seedPlane as planted } from '@nib/rooms/plane'
import { TEXT } from '@nib/rooms'
import * as Y from 'yjs'

/** FNV-1a's 32-bit offset basis and prime. Fixed by definition rather than by any
 *  runtime's own string hasher, so the Worker, a browser and a test hash alike, this
 *  year and in ten. */
const OFFSET = 0x811c9dc5
const PRIME = 0x01000193

/** The parts as one run of bytes, each tagged with what it was, so `('a', 1)` and
 *  `('a', '1')` are two different ids and no choice of text can make one part read
 *  as two. */
function spelled(parts: readonly (string | number)[]): Uint8Array {
  const words = parts.map((part) =>
    typeof part === 'number' ? `n${String(part)}` : `s${String(part.length)}:${part}`,
  )
  return new TextEncoder().encode(words.join('\u0000'))
}

/** FNV-1a over the parts, as an unsigned 32-bit number: a Yjs client id that every
 *  device computes alike. */
export function hash32(...parts: readonly (string | number)[]): number {
  let hash = OFFSET
  for (const byte of spelled(parts)) {
    hash ^= byte
    hash = Math.imul(hash, PRIME)
  }

  return hash >>> 0
}

/** Line endings as the editor holds them. A file keeps its own on disk; a text is
 *  seeded, hashed and compared with `\n`, or a note written on Windows would seed a
 *  different document from the same words written on a Mac. */
function unixLines(text: string): string {
  return text.replace(/\r\n?/g, '\n')
}

/** A throwaway document under the seed's client id. Garbage collection stays on, as
 *  it is everywhere else nib makes a document, so the bytes are the ones any other
 *  device makes. */
function seedDoc(noteId: string, epoch: number): Y.Doc {
  const doc = new Y.Doc()
  doc.clientID = hash32(noteId, epoch)
  return doc
}

/** The seed of a note: one insert of `text` under `hash32(noteId, epoch)`, encoded.
 *  An empty text seeds an empty update, which every device also agrees on. */
export function seedUpdate(noteId: string, epoch: number, text: string): Uint8Array {
  const doc = seedDoc(noteId, epoch)
  const words = unixLines(text)
  if (words) doc.getText(TEXT).insert(0, words)

  const update = Y.encodeStateAsUpdateV2(doc)
  doc.destroy()
  return update
}

/** One object with its fields in one order, whatever order they were made in.
 *
 *  `seedPlane` in packages/rooms writes an object's fields in the order the object
 *  lists them, and each write is an operation with a number. Two devices seeding one
 *  canvas under one client id must write the same operations under the same numbers:
 *  a canvas read from a file and the same canvas built in memory list their fields
 *  differently, and two different operations under one id are a document Yjs cannot
 *  read. Sorting the keys makes the order a property of the content alone. */
function sortedFields<T extends object>(thing: T): T {
  const entries = Object.entries(thing).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  // The same keys and the same values, only listed in another order.
  return Object.fromEntries(entries) as T
}

/** The canvas in the one order every device agrees on: the things in the file's own
 *  order, which is their stacking order and so part of what the canvas says, their
 *  fields sorted, and the tombstones by id. */
function canonical(canvas: Canvas): Canvas {
  const byId = (a: [string, number], b: [string, number]) => (a[0] < b[0] ? -1 : 1)
  return {
    ...canvas,
    nodes: canvas.nodes.map(sortedFields),
    edges: canvas.edges.map(sortedFields),
    ink: canvas.ink.map(sortedFields),
    gone: Object.fromEntries(Object.entries(canvas.gone).sort(byId)),
  }
}

/** The seed of a canvas or a page note: the plane's maps set in the file's own
 *  order, which is what `seedPlane` in packages/rooms does for a room, under the
 *  seed's client id. The same canvas therefore seeds the same bytes on every device,
 *  and a file read back from disk is the canvas it was written from. */
export function seedPlane(noteId: string, epoch: number, canvas: Canvas): Uint8Array {
  const doc = seedDoc(noteId, epoch)
  const content = canonical(canvas)
  doc.transact(() => {
    planted(doc, content)
  })

  const update = Y.encodeStateAsUpdateV2(doc)
  doc.destroy()
  return update
}
