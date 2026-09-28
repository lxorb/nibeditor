/** Doing an undone file operation again: the same operation asked for again, so a
 *  move moves, a rename renames, a deletion deletes and a copy copies to where it
 *  landed the first time. Each records itself as it always does, so it is one undo
 *  away again. Which operations can is `doesAgain` in undo.svelte.ts.
 *
 *  Fetched with the first redo, which most windows never ask for. */

import { folderOf, nameOf } from '../space-paths'
import { copyAgain, type Copies } from './copying'

/** What doing an undone operation again needs of the store: the operations
 *  themselves, which record themselves as they always do. */
export interface DoesAgain extends Copies {
  move(from: string, intoFolder: string): Promise<void>
  rename(path: string, name: string): Promise<void>
  remove(path: string, isFolder: boolean): Promise<void>
  loadTree(): Promise<void>
  persist(): void
}

/** Does the last undone file operation again. What was ahead of it stays ahead. */
export async function redoLastFileAction(ws: DoesAgain): Promise<void> {
  const action = ws.undone.next
  if (!action) return
  const rest = ws.undone.ahead.slice(0, -1)

  try {
    switch (action.kind) {
      case 'move':
        await ws.move(action.from, folderOf(action.to))
        break
      case 'rename':
        await ws.rename(action.from, nameOf(action.to))
        break
      case 'delete':
        await ws.remove(action.path, false)
        break
      case 'copy':
        await copyAgain(ws, action.made)
        break
      // Never ahead: they kept only the way back; see `doesAgain`.
      case 'merge':
      case 'split':
      case 'extract':
      case 'replace':
      case 'import':
        return
    }
  } catch {
    // Something has taken the place since; the redo stays where it was, to be
    // asked for again.
    return
  }

  ws.undone.redone(rest)
  await ws.loadTree()
  ws.persist()
}
