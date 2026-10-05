/** What this device does to a space's tree, told to the account as operations on ids
 *  (docs/sync-v2.md sections 5.9 and 5.13).
 *
 *  Every one arrives after the disk has it - the workspace made, renamed, moved or
 *  deleted the file and says so once (`workspace/file-ops.ts`), and the simulator's
 *  person does the same - so the entry takes its new place here, the op waits in the
 *  outbox, and what is shown is the tree with the op applied, exactly as the account
 *  will apply it.
 *
 *  **A new note is a document from its first character.** A tab with no file has no id
 *  and nothing to sync (lane `unsaved-tabs`: its words are this device's session and
 *  nothing else); the moment it is given a place it is a file, and that moment makes its
 *  id here, a document holding its words as this device's pending edits, and a queued
 *  `create`. Nobody waits for the account to hand out an id. A name that follows the
 *  first line while it is typed is a run of renames the outbox folds into one, or into
 *  the create itself if that has not gone yet (`coalesce`).
 *
 *  **A day's note is made if it is not there yet.** The append action makes it with
 *  `mergeable` and the text it started from, and when two devices made it apart the
 *  account answers `merged` and the pass folds this device's words into the one that
 *  was there, three ways against that text (section 5.9). */

import { fileMade } from './files'
import { kindOfName } from '@nib/sync-core/tree'
import type { EntryKind, Op } from '@nib/sync-core/wire'
import type { Core } from './core'
import { MINE } from './docs'
import { shapeOf, turn } from './kinds'
import { folderOf, nameOf, SEP, type SpaceState } from './places'
import { wrote } from './project'
import { put, type Change, type EntryRow } from './store'

/** What an entry is, read off its name: sync-core's rule, which the account reads by too. */
export { kindOfName }

/** An id no other device will ever make: 128 random bits. */
function freshId(core: Core): string {
  let out = ''
  for (let part = 0; part < 4; part += 1) {
    out += Math.floor(core.world.random() * 0x100000000)
      .toString(16)
      .padStart(8, '0')
  }
  return out
}

function queue(core: Core, space: SpaceState, op: Op): Change[] {
  const { one, change } = core.outgoing(space, { t: 'op', op }, op.seen)
  space.queue(one)
  return [change, core.counterRow()]
}

/** The folder at a local path, made here first (with every folder above it) when the
 *  tree does not have it: a folder another program made and filled in one go. */
function folderFor(core: Core, space: SpaceState, path: string, changes: Change[]): string | null {
  const known = space.folderAt(path)
  if (known !== undefined) return known
  const parent = folderFor(core, space, folderOf(path), changes)
  const id = freshId(core)
  const name = nameOf(path)
  space.entries.set(id, entryRow(space, id, 'folder', parent, name, path))
  changes.push(put('entries', entryRow(space, id, 'folder', parent, name, path)))
  changes.push(
    ...queue(core, space, {
      op: core.nextId('o'),
      t: 'mkdir',
      id,
      parent,
      name,
      seen: space.row.cursor,
    }),
  )
  return id
}

function entryRow(
  space: SpaceState,
  id: string,
  kind: EntryKind,
  parent: string | null,
  name: string,
  path: string,
): EntryRow {
  return {
    id,
    space_id: space.id,
    kind,
    parent,
    name,
    local_path: path,
    file_key: null,
    written_hash: null,
    mtime: null,
    size: null,
    seq: null,
    deleted: false,
  }
}

export interface Made {
  /** Where the file is, relative to the space's root. */
  path: string
  folder: boolean
  /** The words it was made with. */
  text?: string
  /** For a day's note made by the append action: the text it started from. */
  mergeable?: string
}

/** A file or a folder that came to be here. Answers its id, and the changes to write. */
export async function made(
  core: Core,
  space: SpaceState,
  what: Made,
): Promise<{ id: string; changes: Change[] }> {
  const changes: Change[] = []
  const parent = folderFor(core, space, folderOf(what.path), changes)
  const name = nameOf(what.path)
  const kind: EntryKind = what.folder ? 'folder' : kindOfName(name)
  const id = freshId(core)
  const entry = entryRow(space, id, kind, parent, name, what.path)
  // A file that is not a document travels as its bytes, where this world carries them,
  // and stays on this device where it does not, or where it is too large to.
  const bytes = kind === 'file' ? await fileMade(core, space, entry) : null
  if (kind === 'file' && !bytes) return { id, changes }
  space.entries.set(id, entry)

  const seen = space.row.cursor
  const op: Op = what.folder
    ? { op: core.nextId('o'), t: 'mkdir', id, parent, name, seen }
    : {
        op: `${id}.c`,
        t: 'create',
        id,
        kind: kind as Exclude<EntryKind, 'folder'>,
        parent,
        name,
        seen,
      }
  if (op.t === 'create' && what.mergeable !== undefined) op.mergeable = { text: what.mergeable }
  if (op.t === 'create' && bytes) op.hash = bytes.hash
  changes.push(...queue(core, space, op))

  const shape = shapeOf(kind)
  if (shape) {
    const doc = core.made(id, shape, 1)
    const text = what.text ?? ''
    if (text) doc.write((live) => turn(shape, live, '', text, MINE))
    doc.flush()
    changes.push(...core.docChanges(doc))
    changes.push(...(await wrote(core, entry, text)))
  } else {
    changes.push(put('entries', { ...entry }))
  }
  return { id, changes }
}

/** Every entry at or under a local path. */
function atOrUnder(space: SpaceState, path: string): EntryRow[] {
  const key = space.key(path)
  const inside = space.key(`${path}${SEP}`)
  return [...space.entries.values()].filter((entry) => {
    if (!entry.local_path) return false
    const at = space.key(entry.local_path)
    return at === key || at.startsWith(inside)
  })
}

/** A file or folder that moved here, renamed or into another folder. Answers the
 *  changes to write; nothing for a path the tree does not know. */
export function moved(core: Core, space: SpaceState, from: string, to: string): Change[] {
  const entry = space.at(from)
  if (!entry) return []
  const changes: Change[] = []
  const parent = folderFor(core, space, folderOf(to), changes)
  const name = nameOf(to)

  // Everything under it is where it is now, before the op is shown.
  for (const one of atOrUnder(space, from)) {
    one.local_path = `${to}${one.local_path.slice(from.length)}`
    changes.push(put('entries', { ...one }))
  }

  const seen = space.row.cursor
  const shown = space.shown().entries.get(entry.id)
  if (shown?.parent === parent) {
    if (shown.name !== name) {
      changes.push(
        ...queue(core, space, { op: core.nextId('o'), t: 'rename', id: entry.id, name, seen }),
      )
    }
  } else {
    const op: Op = { op: core.nextId('o'), t: 'move', id: entry.id, parent, seen }
    if (shown?.name !== name) op.name = name
    changes.push(...queue(core, space, op))
  }
  space.changed()
  return changes
}

/** A file or folder deleted here. The person threw these words away, so nothing of them
 *  goes up any more; what the account holds of them lands in its Recently deleted,
 *  unless another device wrote in them since this one last looked, when the account
 *  keeps them and they come back (an edit beats a delete). */
export function removed(core: Core, space: SpaceState, path: string): Change[] {
  const entry = space.at(path)
  if (!entry) return []
  const changes: Change[] = []
  const gone = atOrUnder(space, path)

  // What this device has seen of the words it deletes: a note whose newest words it has
  // not pulled yet was not seen, so the account must not take them.
  let seen = space.row.cursor
  const wanted = core.wanted(space.id)
  for (const one of gone) {
    if (!wanted.has(one.id)) continue
    seen = Math.min(seen, core.numbers.get(one.id)?.pulled ?? 0)
  }

  for (const one of gone) {
    one.local_path = ''
    changes.push(put('entries', { ...one }))
    changes.push(...core.letGoChanges(one.id))
    if (one.kind !== 'folder') changes.push(...core.forgetChanges(one.id))
  }
  changes.push(...queue(core, space, { op: core.nextId('o'), t: 'delete', id: entry.id, seen }))
  space.changed()
  return changes
}
