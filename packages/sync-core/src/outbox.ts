/** The tree operations a device has not sent yet, made as few as they can be.
 *
 *  In the autosave-only world a note's name follows its first line while it is being
 *  typed (docs/sync-v2.md section 5.13), so a title typed in ten seconds is thirty
 *  renames, and a note made and thrown away while offline is a create and a delete
 *  the account never needed to hear about. The outbox keeps every op as it was made,
 *  and this folds what has not gone yet before it goes:
 *
 *  - a run of renames of one id, with nothing else happening to that id in between,
 *    is its last rename, at the last one's place in the queue;
 *  - a rename or a move of an id whose create is still waiting is folded into the
 *    create, which then makes it under its final name in its final folder (unless
 *    that folder is itself made later in the queue, when the move has to wait for it);
 *  - a create followed by a delete of the same id cancels both, with every op on that
 *    id in between, and for a folder everything made inside it meanwhile. Something
 *    that already existed and was moved into such a folder is deleted instead, which
 *    is what happened to it on this device.
 *
 *  Only ever handed the ops that have not been sent: an op in flight is the account's
 *  already, and folding it into another would leave its answer with nobody to hear
 *  it. Op ids of what remains are the ops' own, so a retry still reads as one. */

import type { CreateOp, MkdirOp, Op } from './wire'

type Making = CreateOp | MkdirOp

function isMaking(op: Op): op is Making {
  return op.t === 'create' || op.t === 'mkdir'
}

/** Where everything the queue places ends up, up to (not including) `until`: the
 *  folder each id is in after the ops before that point. */
function placesBefore(queue: readonly (Op | null)[], until: number): Map<string, string | null> {
  const places = new Map<string, string | null>()
  for (let at = 0; at < until; at++) {
    const op = queue[at]
    if (op && (isMaking(op) || op.t === 'move')) places.set(op.id, op.parent)
  }
  return places
}

/** The ids the queue placed inside `folder`, however deep, as they stand at `until`. */
function placedInside(queue: readonly (Op | null)[], until: number, folder: string): string[] {
  const places = placesBefore(queue, until)
  const inside = (id: string): boolean => {
    const seen = new Set<string>()
    for (
      let at = places.get(id) ?? null;
      at !== null && !seen.has(at);
      at = places.get(at) ?? null
    ) {
      if (at === folder) return true
      seen.add(at)
    }
    return false
  }
  return [...places.keys()].filter((id) => id !== folder && inside(id))
}

export function coalesce(ops: readonly Op[]): Op[] {
  const queue: (Op | null)[] = ops.map((op) => ({ ...op }))
  /** Where each id's create waits, while it waits. */
  const making = new Map<string, number>()
  /** Where the last rename of each id stands, while nothing else has touched the id. */
  const renaming = new Map<string, number>()
  /** Ids with an op that stayed in the queue after their waiting create. */
  const stuck = new Set<string>()

  for (let at = 0; at < queue.length; at++) {
    const op = queue[at]
    if (!op) continue

    if (isMaking(op)) {
      making.set(op.id, at)
      renaming.delete(op.id)
      continue
    }

    const made = making.get(op.id)
    const create = made === undefined ? undefined : queue[made]
    // Once an op on the id has had to stay behind its create, nothing later folds
    // past it into the create: that would reorder the two.
    const foldable = !stuck.has(op.id)

    if (op.t === 'rename' && foldable && create && isMaking(create)) {
      create.name = op.name
      queue[at] = null
      continue
    }

    if (op.t === 'move' && foldable && create && isMaking(create) && made !== undefined) {
      // Folded only where its folder already exists when the create goes.
      const folder = op.parent === null ? undefined : making.get(op.parent)
      if (folder === undefined || folder < made) {
        create.parent = op.parent
        if (op.name !== undefined) create.name = op.name
        queue[at] = null
        continue
      }
    }

    if (create) stuck.add(op.id)

    if (op.t === 'rename') {
      const earlier = renaming.get(op.id)
      if (earlier !== undefined) queue[earlier] = null
      renaming.set(op.id, at)
      continue
    }

    renaming.delete(op.id)
    if (op.t !== 'delete' || !create) continue

    // Made and thrown away before the account heard of either: neither goes, nor
    // anything done to it in between, nor anything made inside it. What was only
    // moved into it existed before, and goes the way it went here: deleted.
    const inside = create.t === 'mkdir' ? placedInside(queue, at, op.id) : []
    const gone = new Set<string>([op.id, ...inside])
    const existed = inside.filter((id) => making.get(id) === undefined)

    // Something made in it and moved out again still names it as the place it was
    // made; the folder then has to exist for a moment on the account too.
    const named = queue.some(
      (one) =>
        one && 'parent' in one && one.parent !== null && gone.has(one.parent) && !gone.has(one.id),
    )
    if (named) continue

    for (let other = 0; other <= at; other++) {
      const one = queue[other]
      if (one && 'id' in one && gone.has(one.id)) queue[other] = null
    }
    queue.splice(
      at,
      1,
      ...existed.map((id, index): Op => ({
        op: `${op.op}.${String(index)}`,
        t: 'delete',
        id,
        seen: op.seen,
      })),
    )
    at += existed.length - 1

    for (const id of gone) {
      making.delete(id)
      renaming.delete(id)
      stuck.delete(id)
    }
  }

  return queue.filter((op): op is Op => op !== null)
}
