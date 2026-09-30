/** Every file operation, said once, by the operation that did it.
 *
 *  A good deal of the app keeps something by a file's path: where each note was
 *  being read, the notes opened lately, the bookmarks, a folder's icon and the order
 *  its rows were arranged in, what a space leaves out and what it put away, the link
 *  index, the papers' words, the open documents and the tabs' trails, and the
 *  account's id for each note. Every one of them has to hear when a path changes or
 *  goes, and each operation used to tell each of them by hand - so a store was
 *  missed wherever somebody forgot it: undo was missing the arranged order until a
 *  test caught it, the bookmarks were missing everywhere, and a folder that moved
 *  took none of the documents open inside it along.
 *
 *  So an operation says what it did, once, and whatever keeps files by path follows
 *  what is said; nothing an operation does names a store. VS Code's working copies
 *  and Obsidian's vault events are the same shape. See `follow` in
 *  workspace.svelte.ts for who follows, and docs/sync-v2.md for the account's part. */

import { log } from '../log'

/** What moved or went: a file, a folder with everything in it, or a whole space. */
export type Kind = 'file' | 'folder' | 'space'

/** One file operation. `root` is the space the path was in, which an agent's move
 *  in a space the reader is not looking at shows is not always the open one; null
 *  for a path in no space. A space moving is itself: its old root and its new. */
export type FileOp =
  | { op: 'created'; path: string; kind: Exclude<Kind, 'space'>; root: string | null }
  | { op: 'moved'; from: string; to: string; kind: Kind; root: string | null }
  | { op: 'removed'; path: string; kind: Kind; root: string | null }

/** Whatever keeps files by path. What it has left to do - telling the account - it
 *  answers as a promise, which the operation waits for before it goes on, so two
 *  operations in a row reach the account in the order they were done. */
export type Follower = (op: FileOp) => unknown

export class FileOps {
  private readonly followers = new Set<Follower>()

  /** Follows every operation from now on. Answers the way to stop. */
  follow(follower: Follower): () => void {
    this.followers.add(follower)
    return () => this.followers.delete(follower)
  }

  /** Says one operation to everything following, all of it in the same moment: a
   *  path that changes is changed everywhere before anything on the page can read
   *  one store's answer beside another's (a room asking the account's id of a path
   *  the documents already have and the account's table not yet). A follower that
   *  fails is written down and the rest still hear. */
  async tell(op: FileOp): Promise<void> {
    const waiting: Promise<unknown>[] = []

    for (const follower of this.followers) {
      try {
        const left = follower(op)
        if (left instanceof Promise) waiting.push(left.catch((error: unknown) => failed(op, error)))
      } catch (error) {
        failed(op, error)
      }
    }

    await Promise.all(waiting)
  }
}

function failed(op: FileOp, error: unknown) {
  log(
    'error',
    `a store did not follow ${op.op} ${op.op === 'moved' ? op.from : op.path}: ${String(error)}`,
  )
}

/** A store that keeps things by a path inside a space, under each space's root: the
 *  four sentences it takes, and the one place those are read off an operation. */
export interface KeptByPath {
  moved?(from: string, to: string, root: string | null): void
  gone?(path: string, root: string | null): void
  spaceMoved?(from: string, to: string): void
  forget?(root: string): void
}

/** A store that keeps things by path, following every operation. */
export function keeping(store: KeptByPath): Follower {
  return (op) => {
    if (op.op === 'removed') {
      if (op.kind === 'space') store.forget?.(op.path)
      else store.gone?.(op.path, op.root)
    } else if (op.op === 'moved') {
      if (op.kind === 'space') store.spaceMoved?.(op.from, op.to)
      else store.moved?.(op.from, op.to, op.root)
    }
  }
}
