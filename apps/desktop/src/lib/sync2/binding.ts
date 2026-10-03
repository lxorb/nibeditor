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
 *  A canvas or a page note is joined through the binding a canvas's room uses
 *  (rooms/plane-bind.ts), whose join is the merge two canvas files get: every object
 *  has an id and a time, so both sides are kept whichever is ahead, and what the plane
 *  had that the document did not goes in as this device's. */

import type { SharedDoc } from '@nib/editor'
import { TEXT } from '@nib/rooms'
import { fold } from '@nib/rooms/fold'
import type * as Y from 'yjs'
import type { InkStroke } from '../canvas/format'
import type { Point } from '../canvas/geometry'
import type { PlaneSurface } from '../canvas/shared'
import { bind } from '../rooms/bind'
import { PlaneBinding } from '../rooms/plane-bind'
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
  const judged = judge(
    'words',
    base,
    mine,
    theirs,
    { local: Date.now(), remote: doc.pendingAt },
    merged,
  )
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
  /** Told when the document under the note was made again, once it is joined anew. */
  again?: () => void,
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
    again?.()
  }

  return () => {
    unbind()
    doc.replaced = null
    void engine.letGo(id)
  }
}

/** A plane joined to its document: how to part them, and where its pointer goes while a
 *  room carries the document. */
export interface PlaneJoin {
  part: () => void
  hand: ((at: Point | null, drawing: InkStroke | null) => void) | null
}

/** Joins a canvas or a page note to its document, as above. The surface pushes its
 *  edits into the document from here on, with the document's undo, room or no room. */
export async function attachPlane(
  engine: Engine,
  id: string,
  surface: PlaneSurface,
  holds: () => boolean,
  again?: () => void,
): Promise<PlaneJoin | null> {
  const doc = await engine.hold(id)
  if (!doc?.live || !holds()) {
    if (doc) await engine.letGo(id)
    return null
  }

  const join: PlaneJoin = { part: () => undefined, hand: null }
  const joined = (live: Y.Doc) => {
    const binding = new PlaneBinding(live, surface, holds, MINE)
    binding.together()
    surface.shared = {
      push: (before, after) => binding.push(before, after),
      undo: () => binding.undo(),
      redo: () => binding.redo(),
      hand: (at, drawing) => join.hand?.(at, drawing),
    }
    return binding
  }
  let binding = joined(doc.live)
  doc.replaced = (fresh) => {
    binding.part()
    binding = joined(fresh)
    again?.()
  }
  join.part = () => {
    binding.part()
    doc.replaced = null
    surface.shared = null
    surface.handsAre([])
    void engine.letGo(id)
  }
  return join
}
