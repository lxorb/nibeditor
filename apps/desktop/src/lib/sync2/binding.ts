/** An open note and its document, kept as one (docs/sync-v2.md section 9.3).
 *
 *  A note opens with its file's words at once - the file is read as it always was - and
 *  the document is read from the store a moment later and joined to it through the
 *  binding a room uses (rooms/bind.ts): a keystroke goes into the document as the
 *  operation it is, and what arrives in the document - a pull, a room, the engine's
 *  own merge - comes back into the note as the edit it is, so no caret moves.
 *
 *  The moment of joining is the one to get right, because the two may not agree:
 *
 *  - the note was typed in during the moment the document took to arrive, or the file
 *    was written by another program while nib was closed: the note is ahead, and what
 *    it says goes into the document as this device's edits;
 *  - the document has words the file had not been written with yet (another device's,
 *    pulled while this note was closed and its file not yet written): the document is
 *    ahead, and its words go into the note;
 *  - both moved: the three-way rule another program's edit gets, against the words nib
 *    last wrote (ingest.ts).
 *
 *  Only notes: a canvas is written by autosave and its file folded into its document
 *  as it lands (`saved` in engine.ts), which is the same three ways. */

import type { SharedDoc } from '@nib/editor'
import { TEXT } from '@nib/rooms'
import { fold } from '@nib/rooms/fold'
import type * as Y from 'yjs'
import { bind } from '../rooms/bind'
import { MINE, type Doc } from './docs'
import type { Engine } from './engine'
import { writtenOf } from './ingest'
import { judge, mergedOf, turn } from './kinds'

/** The words of a note as its views hold them now. */
export interface Held {
  readonly live: SharedDoc
  readonly latest: string
}

/** Puts `to` into a note that reads `from`, as one edit, keeping every caret. */
function arrive(note: Held, from: string, to: string) {
  const change = fold(from, to)
  if (change) note.live.arrived([change])
}

/** Brings a note and its document to one text, as above. */
async function agree(engine: Engine, id: string, note: Held, doc: Doc): Promise<void> {
  const mine = note.latest
  const theirs = doc.text()
  if (mine === theirs) return

  const base = (await writtenOf(engine.core, id)) ?? theirs
  if (theirs === base) {
    doc.write((live) => turn('words', live, theirs, mine, MINE))
    return
  }
  if (mine === base) {
    arrive(note, mine, theirs)
    return
  }

  const merged = mergedOf(base, mine, theirs)
  const judged = judge('words', base, mine, theirs, { local: Date.now(), remote: doc.pendingAt }, merged)
  if (judged.resolution === null) {
    // Held like another program's edit: the note keeps what it says here, and the
    // question comes up over it.
    await engine.holdFile(id, base, mine)
    return
  }
  const resolution = judged.resolution
  doc.write((live) => turn('words', live, theirs, resolution, MINE))
  arrive(note, mine, resolution)
}

/** Joins a note to its document. Answers how to part them again. `holds` is whether the
 *  note's view is still on this file (see rooms/bind.ts). */
export async function attach(
  engine: Engine,
  id: string,
  note: Held,
  holds: () => boolean,
): Promise<(() => void) | null> {
  const doc = await engine.hold(id)
  if (!doc?.live || !holds()) {
    if (doc) await engine.letGo(id)
    return null
  }
  await agree(engine, id, note, doc)

  let text: Y.Text = doc.live.getText(TEXT)
  let unbind = bind(note.live, text, holds)
  // The account's words taken over this device's, or a new epoch: the same note, a new
  // document under it.
  doc.replaced = (fresh) => {
    unbind()
    const was = note.latest
    text = fresh.getText(TEXT)
    arrive(note, was, text.toJSON())
    unbind = bind(note.live, text, holds)
  }

  return () => {
    unbind()
    doc.replaced = null
    void engine.letGo(id)
  }
}
