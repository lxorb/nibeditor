/** A note's document as sync v2 keeps it: seeded the same way on every device, and
 *  written into by whole-text writers without a device of their own.
 *
 *  Two things a room does that no socket does. It seeds an epoch: the note's words put
 *  into an empty document under `hash32(noteId, epoch)`, byte for byte what a device
 *  seeding the same words makes, so the two merge into one text (docs/sync-v2.md
 *  section 5.3). And it ingests: a v1 push, the connector, a rollback hand it a whole
 *  text, and what goes in is the few operations that text differs by, made under the
 *  room's own id, `hash32(noteId, 'account')`.
 *
 *  The room's own operations are made in a scratch copy and applied to the room's
 *  document as though they had arrived, never by giving the room's document that id.
 *  Yjs gives a document a new client id when an update arriving carries its own, and
 *  the room's document meets its own operations again every time it is read back out
 *  of storage - so a room that held the account's id would soon hold a random one, and
 *  every ingest after that would be a new entry in every state vector for good. */

import { readCanvas } from '@nib/markdown/canvas'
import { TEXT } from '@nib/rooms'
import { pushPlane } from '@nib/rooms/plane'
import { hash32, seedPlane, seedUpdate, textops } from '@nib/sync-core'
import * as Y from 'yjs'
import type { RoomKind } from './kind'

/** Where the R2 snapshot of a note's document lives: written at every settle, read by
 *  every pull, so a pull never wakes a room. */
export function snapshotKey(noteId: string): string {
  return `crdt/${noteId}`
}

/** The seed of an epoch, from the words it was seeded from. */
export function seedOf(kind: RoomKind, noteId: string, epoch: number, text: string): Uint8Array {
  return kind === 'plane'
    ? seedPlane(noteId, epoch, readCanvas(text))
    : seedUpdate(noteId, epoch, text)
}

/** The id the room writes under, which no device ever uses. */
export function accountClient(noteId: string): number {
  return hash32(noteId, 'account')
}

/** The update that turns `doc`, which reads `from`, into `to`, made under the room's
 *  own id; null when there is nothing to change. */
export function ingested(
  kind: RoomKind,
  doc: Y.Doc,
  noteId: string,
  from: string,
  to: string,
): Uint8Array | null {
  if (from === to) return null

  const scratch = new Y.Doc()
  // Read in first and named after, so reading in its own operations cannot move it
  // off the account's id; see the header.
  Y.applyUpdateV2(scratch, Y.encodeStateAsUpdateV2(doc))
  scratch.clientID = accountClient(noteId)
  const before = Y.encodeStateVector(scratch)

  if (kind === 'plane') {
    scratch.transact(() => {
      pushPlane(scratch, readCanvas(from), readCanvas(to))
    })
  } else {
    textops(scratch.getText(TEXT), from, to)
  }

  const update = Y.encodeStateAsUpdateV2(scratch, before)
  scratch.destroy()
  return update
}

/** Whether a seed put anything in at all: a note with no words seeds nothing, and a
 *  document that holds nothing is at version 0 rather than 1. */
export function seedsAnything(update: Uint8Array): boolean {
  const doc = new Y.Doc()
  Y.applyUpdateV2(doc, update)
  const held = doc.store.clients.size > 0
  doc.destroy()
  return held
}
