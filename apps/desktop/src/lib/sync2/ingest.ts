/** Files changed by something other than nib: another editor, a `git checkout`, a sync
 *  tool of somebody else's (docs/sync-v2.md section 5.5).
 *
 *  Every write nib makes is recorded (project.ts), so a file whose words are not nib's
 *  last write was changed by something else. Its new text is folded in three ways:
 *  against the words nib last wrote, with the document as it reads now (which may have
 *  moved on since, from the account) as the other side. The usual case is that the
 *  document has not moved - nib was closed, or nobody else wrote - and then the change
 *  is simply this device's own edit, as the few operations the texts differ by. When
 *  both moved, `diverge` decides exactly as it does for two devices: settled quietly,
 *  or the note held for the modal.
 *
 *  Creates, deletes and moves are read the same way (section 5.5): a file nobody made is
 *  a create, a file gone is a delete, and a file with a known identity at a new path is
 *  a move - see `news` in the engine, which reads the watcher's messages a hundred at a
 *  time and hands each here or to create.ts. */

import type { Core, Holding } from './core'
import { MINE } from './docs'
import { judge, turn, unixLines } from './kinds'
import { project, wrote } from './project'
import { againstBytes } from './records'
import { keepLosers } from './rejoin'
import type { SpaceState } from './places'
import { get, type Change, type EntryRow } from './store'

/** The words nib last wrote to an entry's file. */
export async function writtenOf(core: Core, id: string): Promise<string | null> {
  const [row] = await core.store.read([get('written', id)])
  return row?.text ?? null
}

/** Folds another program's change to an entry's file into its document. Answers the
 *  changes to write; nothing when the file says what nib wrote. */
export async function foldIn(core: Core, space: SpaceState, entry: EntryRow): Promise<Change[]> {
  if (!entry.local_path || core.isHeld(entry.id)) return []
  const full = core.world.join(space.row.root, entry.local_path)
  const read = await core.world.disk.read(full)
  if (read === null) return []
  const file = unixLines(read)

  const doc = await core.doc(entry.id)
  if (!doc) return []
  const ours = doc.text()
  const ancestor = (await writtenOf(core, entry.id)) ?? ours
  if (file === ancestor) return []
  if (file === ours) return await wrote(core, entry, file)

  if (ours === ancestor) {
    doc.write((live) => turn(doc.shape, live, ours, file, MINE))
    doc.flush()
    return [...core.docChanges(doc), ...(await wrote(core, entry, file))]
  }

  const times = { local: core.world.now(), remote: doc.pendingAt }
  const judged = judge(doc.shape, ancestor, file, ours, times)
  const held = judged.resolution === null
  if (process.env.SIMDEBUG) console.log('foldIn', entry.id, judged.verdict, JSON.stringify({ ancestor, file, ours, times, resolution: judged.resolution }))
  if (doc.shape !== 'link') {
    core.classified.push({ id: entry.id, base: ancestor, local: file, remote: ours, times, held, ...(judged.merged === undefined ? {} : { merged: judged.merged }) })
  }

  if (judged.resolution === null) {
    const against = { t: 'file', base: ancestor, local: file } as const
    const holding: Holding = {
      row: {
        id: entry.id,
        remote: againstBytes(against),
        remote_sv: new Uint8Array(),
        device: null,
        at: core.world.now(),
      },
      against,
    }
    return core.holdChanges(holding)
  }

  const resolution = judged.resolution
  const changes = keepLosers(core, space, entry.id, judged.lost, file, ours)
  doc.write((live) => turn(doc.shape, live, ours, resolution, MINE))
  doc.flush()
  changes.push(...core.docChanges(doc))
  changes.push(...(await project(core, space, entry, doc)))
  return changes
}
