/** A space's tree, and the rules every tree operation is applied by. See
 *  docs/sync-v2.md section 5.9. */

import type { EntryKind, Op, OpResult } from './wire'

export interface TreeEntry {
  id: string
  kind: EntryKind
  parent: string | null
  name: string
  deleted: boolean
  /** The cursor of its latest change in the tree. */
  seq: number
  /** The cursor of its latest content change, 0 for none. */
  docSeq: number
}

export interface TreeState {
  readonly entries: Map<string, TreeEntry>
  /** The space's cursor: every change takes the next number. */
  cursor: number
  /** What each op id was answered with. */
  readonly done: Map<string, OpResult>
}

/** Who is asking, which is all the rules need to know about them. */
export interface OpContext {
  role: 'owner' | 'write' | 'read'
}

export function nameKey(_name: string): string {
  throw new Error('not yet')
}

export function treeState(_entries: Iterable<TreeEntry> = [], _cursor = 0): TreeState {
  throw new Error('not yet')
}

export function applyOp(_state: TreeState, _op: Op, _context: OpContext): OpResult {
  throw new Error('not yet')
}

/** A document's content changed: its `docSeq` takes the next cursor. */
export function contentChanged(_state: TreeState, _id: string): number {
  throw new Error('not yet')
}
