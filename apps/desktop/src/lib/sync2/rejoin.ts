/** The moment this device's offline edits meet the account's: a push answered `moved`,
 *  or a room's socket opening while pending edits are held (docs/sync-v2.md 5.4).
 *
 *  Three texts and a merge. B is the confirmed document, the ancestor both sides started
 *  from; L is this device's, confirmed plus pending; R is the account's, confirmed plus
 *  what it sent; M is the CRDT's merge of both, made in a scratch document. `diverge`
 *  decides: `clean` and `minor` go ahead - R applied, then whatever turns M into the
 *  resolution (the second copy of an identical edit taken out, each small overlap as
 *  its newer side wrote it) made as this device's own edits, and every side that lost a
 *  span kept as a version; `diverged` holds the note, applying nothing and sending
 *  nothing, for the modal.
 *
 *  Only the device whose edits arrive second ever gets here, so only one device asks. */

import type { Core, Holding } from './core'
import { type Doc, MINE } from './docs'
import { fileOfUpdates, judge, turn } from './kinds'
import { againstBytes } from './records'
import type { SpaceState } from './places'
import type { Change } from './store'

/** Classifies what the account sent against this device's pending edits, and either
 *  settles it into the document or holds the note. Answers the changes to write, and
 *  whether the note was held. `by` is the device the account says last wrote it. */
export function rejoin(
  core: Core,
  space: SpaceState,
  doc: Doc,
  update: Uint8Array,
  seq: number,
  at: number,
  by: string | null,
): { changes: Change[]; held: boolean } {
  const base = doc.confirmedText()
  const local = doc.text()
  const remote = fileOfUpdates(doc.shape, doc.row().confirmed, update)
  const merged = fileOfUpdates(doc.shape, doc.whole(), update)
  const times = { local: doc.pendingAt, remote: at }
  const judged = judge(doc.shape, base, local, remote, times, merged)
  const held = judged.resolution === null

  if (doc.shape !== 'link') {
    core.classified.push({ id: doc.id, base, local, remote, times, merged, held })
  }

  if (judged.resolution === null) {
    const holding: Holding = {
      row: {
        id: doc.id,
        remote: againstBytes({ t: 'moved', update, seq, at }),
        remote_sv: new Uint8Array(),
        device: by,
        at: core.world.now(),
      },
      against: { t: 'moved', update, seq, at },
    }
    return { changes: core.holdChanges(holding), held: true }
  }

  const changes: Change[] = []
  doc.took(update, seq)
  const resolution = judged.resolution
  doc.write((live) => turn(doc.shape, live, merged, resolution, MINE))
  doc.flush()
  changes.push(...keepLosers(core, space, doc.id, judged.lost, local, remote))
  changes.push(...core.docChanges(doc))
  return { changes, held: false }
}

/** The losing side of every small overlap, on its way to the account as a version: the
 *  words are in the history, never gone. */
export function keepLosers(
  core: Core,
  space: SpaceState,
  id: string,
  lost: { local: boolean; remote: boolean },
  local: string,
  remote: string,
): Change[] {
  const changes: Change[] = []
  const texts = [...(lost.local ? [local] : []), ...(lost.remote ? [remote] : [])]
  for (const text of texts) {
    const { one, change } = core.outgoing(
      space,
      { t: 'keep', keep: { id, text, device: core.device } },
      space.row.cursor,
    )
    space.outbox.push(one)
    changes.push(change, core.counterRow())
  }
  return changes
}
