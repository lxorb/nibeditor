/** What a document holds, by the kind of entry it is, and the four things the engine
 *  does with one: read it as the file it projects to, seed it from a file, turn it from
 *  one file into another as operations, and classify two sets of edits against their
 *  ancestor (docs/sync-v2.md sections 5.3 to 5.7).
 *
 *  Three shapes. A note is words: one `Y.Text`, merged character by character. A canvas
 *  and a page note are a plane: a map of objects by id, merged object by object, whose
 *  file is what `writeCanvas` writes. A web note's `.url` is words the account keeps
 *  last-writer-wins: nobody writes it but the device whose tab follows the page, so two
 *  versions of it never ask anybody anything, and the later arrival stands.
 *
 *  Everything else in the engine speaks files - text in, text out - and asks here. */

import { readCanvas, writeCanvas } from '@nib/markdown/canvas'
import { TEXT } from '@nib/rooms'
import { pushPlane, readPlane } from '@nib/rooms/plane'
import { diverge, type Times, type Verdict } from '@nib/sync-core/diverge'
import { divergePlane } from '@nib/sync-core/plane-diverge'
import { seedPlane, seedUpdate } from '@nib/sync-core/seed'
import { textops } from '@nib/sync-core/textops'
import type { EntryKind } from '@nib/sync-core/wire'
import * as Y from 'yjs'

export type Shape = 'words' | 'plane' | 'link'

/** The shape of an entry's document, or null for an entry that has none: a folder, and
 *  a file that is a blob. */
export function shapeOf(kind: EntryKind | string): Shape | null {
  switch (kind) {
    case 'note':
      return 'words'
    case 'canvas':
    case 'pages':
      return 'plane'
    case 'url':
      return 'link'
    default:
      return null
  }
}

/** Whether an entry of this kind has a document. */
export function holdsDocument(kind: EntryKind | string): boolean {
  return shapeOf(kind) !== null
}

/** Line endings as the editor holds them: what a document is compared and seeded in. A
 *  file keeps its own on disk (`as_written` in src-tauri/src/notes.rs). */
export function unixLines(text: string): string {
  return text.replace(/\r\n?/g, '\n')
}

/** The file a document projects to. */
export function fileOf(shape: Shape, doc: Y.Doc): string {
  return shape === 'plane' ? writeCanvas(readPlane(doc)) : doc.getText(TEXT).toJSON()
}

/** The file an update, or a list of them, projects to: read in a scratch document. */
export function fileOfUpdates(shape: Shape, ...updates: readonly Uint8Array[]): string {
  const doc = new Y.Doc()
  for (const update of updates) Y.applyUpdateV2(doc, update)
  const text = fileOf(shape, doc)
  doc.destroy()
  return text
}

/** The seed of an epoch from a file: the same bytes on every device (section 5.3). */
export function seedOf(shape: Shape, id: string, epoch: number, text: string): Uint8Array {
  return shape === 'plane' ? seedPlane(id, epoch, readCanvas(text)) : seedUpdate(id, epoch, text)
}

/** Turns a document that reads `from` into one that reads `to`, as the few operations the
 *  two differ by, in one transaction under `origin`. */
export function turn(shape: Shape, doc: Y.Doc, from: string, to: string, origin: unknown): void {
  if (from === to) return
  if (shape === 'plane') {
    doc.transact(() => {
      pushPlane(doc, readCanvas(from), readCanvas(to))
    }, origin)
    return
  }
  textops(doc.getText(TEXT), unixLines(from), unixLines(to), origin)
}

/** The CRDT's merge of two texts made from one ancestor, where there is no document
 *  history to merge: each side's edits made as operations on one scratch copy of the
 *  ancestor, then put together. What `diverge` reads a resolution off when there is no
 *  live merge to hand - a file another program wrote, a day's note made twice - because a
 *  text merge alone keeps both copies of a passage one side moved (diff3's old trouble),
 *  and the CRDT never does: a moved passage is a deletion and an insertion, and the
 *  deletion lands on the one copy there is. */
export function mergedOf(base: string, local: string, remote: string): string {
  const seed = new Y.Doc()
  seed.clientID = 1
  seed.getText(TEXT).insert(0, unixLines(base))
  const start = Y.encodeStateAsUpdateV2(seed)
  seed.destroy()

  const side = (client: number, to: string): Uint8Array => {
    const doc = new Y.Doc()
    Y.applyUpdateV2(doc, start)
    doc.clientID = client
    const text = doc.getText(TEXT)
    textops(text, text.toJSON(), unixLines(to))
    const update = Y.encodeStateAsUpdateV2(doc)
    doc.destroy()
    return update
  }
  return fileOfUpdates('words', side(2, local), side(3, remote))
}

/** What two sets of edits come to, as the engine acts on it. */
export interface Judged {
  verdict: Verdict
  /** What the document should read, for `clean` and `minor`; null for `diverged`. */
  resolution: string | null
  /** Which sides lost a span somewhere, and so are kept as a version. */
  lost: { local: boolean; remote: boolean }
  /** The merge the resolution was read off, for words. */
  merged?: string
}

/** Classifies local and remote edits against their ancestor. `merged` is the CRDT's merge
 *  of the two, where the caller has one, which is what the note reads unless an overlap
 *  settles otherwise. */
export function judge(
  shape: Shape,
  base: string,
  local: string,
  remote: string,
  times: Times,
  merged?: string,
): Judged {
  if (shape === 'link') {
    // Last writer by arrival: this device's push arrives second, so it stands, and the
    // account's is a version.
    return {
      verdict: local === remote || remote === base ? 'clean' : 'minor',
      resolution: local,
      lost: { local: false, remote: local !== remote && remote !== base },
    }
  }

  if (shape === 'plane') {
    const planes = divergePlane(readCanvas(base), readCanvas(local), readCanvas(remote), times)
    return {
      verdict: planes.verdict,
      resolution: planes.resolution ? writeCanvas(planes.resolution) : null,
      lost: {
        local: planes.overlaps.some((one) => one.newer === 'remote'),
        remote: planes.overlaps.some((one) => one.newer === 'local'),
      },
    }
  }

  const both = merged ?? mergedOf(base, local, remote)
  const words = diverge(base, local, remote, times, both)
  // Overlaps settled with both sides' edits made lost something on each side.
  const each = words.settled === 'both'
  return {
    merged: both,
    verdict: words.verdict,
    resolution: words.resolution,
    lost: {
      local: each || words.overlaps.some((one) => one.newer === 'remote'),
      remote: each || words.overlaps.some((one) => one.newer === 'local'),
    },
  }
}
