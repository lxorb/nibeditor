/** Tree operations: a device's, applied in the order they arrive, and a v1 app's writes
 *  said as the same operations.
 *
 *  A v2 device sends `mkdir`, `create`, `rename`, `move`, `delete` and `restore` by id
 *  (docs/sync-v2.md sections 5.9 and 7), and each is answered with where the entry
 *  ended up or why it was refused. A v1 app names paths, and in a space whose tree is
 *  rows its path writes become the same operations here - a create with a server id, a
 *  rename or a move, a delete that asks nothing (a v1 delete names no version to judge
 *  an edit against, so it goes to Recently deleted exactly as it always has) - so the
 *  rows, the paths and every v2 device's feed stay one story whichever app wrote. */

import type { CreateOp, Op, OpContext, OpResult } from '@nib/sync-core'
import { newId } from '../crypto'
import type { Env } from '../types'
import type { Reached } from '../spaces/space'
import { type Changed, changeTree, type Content, kindOfName, type Tree } from './tree'

/** A v1 op judges nothing against what its device had seen. */
const SAW_EVERYTHING = Number.MAX_SAFE_INTEGER

/** The size of each blob a batch of file creates names, by hash: a file's entry is
 *  only made for bytes the account is keeping. */
async function blobSizes(env: Env, ops: readonly Op[]): Promise<Map<string, number>> {
  const hashes = new Set<string>()
  for (const op of ops) {
    if (op.t === 'create' && op.kind === 'file' && op.hash) hashes.add(op.hash.toLowerCase())
  }
  if (!hashes.size) return new Map()

  const { results } = await env.DB.prepare(
    `select hash, max(size) as size from blobs
      where hash in (select value from json_each(?)) group by hash`,
  )
    .bind(JSON.stringify([...hashes]))
    .all<{ hash: string; size: number }>()
  return new Map(results.map((row) => [row.hash, row.size]))
}

/** A device's batch of ops, applied by the rules, answering each. */
export async function applyOps(
  env: Env,
  space: Reached,
  device: string,
  ops: readonly Op[],
): Promise<Changed<OpResult[]>> {
  const sizes = await blobSizes(env, ops)
  const context: OpContext = { role: space.role, device }

  return await changeTree(
    env,
    space.id,
    device,
    (tree) => ops.map((op) => applied(tree, op, context, sizes)),
    ops.map((op) => op.op),
  )
}

function applied(
  tree: Tree,
  op: Op,
  context: OpContext,
  sizes: ReadonlyMap<string, number>,
): OpResult {
  if (op.t !== 'create' || op.kind !== 'file' || context.role === 'read') {
    return tree.apply(op, context)
  }

  // A file is its bytes, so an entry for bytes nobody uploaded is not made. Not written
  // down as the op's answer either: the device uploads and sends the same op again.
  const hash = op.hash?.toLowerCase()
  const size = hash === undefined ? undefined : sizes.get(hash)
  if (hash === undefined || size === undefined) return { op: op.op, refused: 'gone' }

  const result = tree.apply(op, context)
  tree.content.set(op.id, { hash, size, front: null, epoch: 0, epochBase: null })
  return result
}

/* ── A v1 app's writes, as ops ─────────────────────────────────────────── */

/** The folders a path names, each found or made, answering the folder the last one is:
 *  what a v1 app's path means in a tree of ids. A folder is found among the live ones,
 *  the way the file list would find it. */
function foldersFor(tree: Tree, folders: readonly string[], context: OpContext): string | null {
  let parent: string | null = null
  for (const name of folders) {
    const found = tree.child(parent, name)
    if (found?.kind === 'folder') {
      parent = found.id
      continue
    }

    const id = newId()
    const made = tree.apply(
      { op: newId(), t: 'mkdir', id, parent, name, seen: SAW_EVERYTHING },
      context,
    )
    if (!('id' in made)) throw new Error(`a folder could not be made for ${name}`)
    parent = id
  }
  return parent
}

function split(path: string): { folders: string[]; name: string } {
  const folders = path.split('/')
  const name = folders.pop() ?? path
  return { folders, name }
}

/** The live note a v1 app's path already names, if there is one: a create at that
 *  path is the 409 it always was, and a Linux device's other spelling of the same
 *  name answers the same way. */
function noteAtPath(tree: Tree, path: string): string | null {
  const { folders, name } = split(path)
  let parent: string | null = null
  for (const folder of folders) {
    const found = tree.child(parent, folder)
    if (found?.kind !== 'folder') return null
    parent = found.id
  }
  const found = tree.child(parent, name)
  return found && found.kind !== 'folder' ? found.id : null
}

/** A note a v1 app made, with its words: a create with a server id, in the folders
 *  its path names. Answers the id, or the note already at that path. */
export async function createByPath(
  env: Env,
  spaceId: string,
  device: string | undefined,
  path: string,
  content: Content,
): Promise<{ made: string } | { taken: string }> {
  const context: OpContext = { role: 'write', ...(device === undefined ? {} : { device }) }
  const { value } = await changeTree(env, spaceId, device, (tree) => {
    const taken = noteAtPath(tree, path)
    if (taken) return { taken }

    const { folders, name } = split(path)
    const parent = foldersFor(tree, folders, context)
    const id = newId()
    const create: CreateOp = {
      op: newId(),
      t: 'create',
      id,
      kind: kindOfName(name),
      parent,
      name,
      seen: SAW_EVERYTHING,
    }
    tree.apply(create, context)
    tree.content.set(id, content)

    // Made with words, which is a content change as well as a place.
    const entry = tree.entry(id)
    if (entry) {
      entry.docSeq = entry.seq
      if (device === undefined) delete entry.docBy
      else entry.docBy = device
    }
    return { made: id }
  })
  return value
}

/** A v1 app's rename or move: the note placed at the path it names, its folders found
 *  or made. Answers the path it ended up at, numbered where the name was taken. */
export async function moveByPath(
  env: Env,
  spaceId: string,
  device: string | undefined,
  id: string,
  path: string,
): Promise<string | null> {
  const context: OpContext = { role: 'write', ...(device === undefined ? {} : { device }) }
  const { value } = await changeTree(env, spaceId, device, (tree) => {
    const { folders, name } = split(path)
    const parent = foldersFor(tree, folders, context)
    const result = tree.apply(
      { op: newId(), t: 'move', id, parent, name, seen: SAW_EVERYTHING },
      context,
    )
    return 'id' in result ? tree.pathOf(id) : null
  })
  return value
}

/** A v1 app's delete, or a restore out of Recently deleted, as the tree says them. */
export async function deleteById(
  env: Env,
  spaceId: string,
  device: string | undefined,
  id: string,
  restore = false,
): Promise<OpResult> {
  const context: OpContext = { role: 'write', ...(device === undefined ? {} : { device }) }
  const { value } = await changeTree(env, spaceId, device, (tree) =>
    tree.apply(
      { op: newId(), t: restore ? 'restore' : 'delete', id, seen: SAW_EVERYTHING },
      context,
    ),
  )
  return value
}

/** A document's words changed while it was deleted: it comes back, with its folders
 *  (an edit beats a delete). What a room's settle asks before it writes the words of a
 *  note somebody deleted meanwhile. */
export async function revive(
  env: Env,
  spaceId: string,
  device: string | undefined,
  id: string,
): Promise<void> {
  await changeTree(env, spaceId, device, (tree) => {
    if (tree.entry(id)?.deleted) tree.touch(id, device)
  })
}
