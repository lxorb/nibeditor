/** A file change of a thread's taken back, or done again for Redo (files.ts says what
 *  the changes are). A move is moved back the way the agent moved it, links and all; a
 *  deleted note comes back out of Recently deleted, or from the snapshot taken as it
 *  went, the way the tree's own Undo puts it back (workspace/undoing.ts), and that undo
 *  step is dropped so it cannot write the note a second time. Both are fetched with the
 *  first Undo: the move's machinery carries the app's menus with it. */

import { insideSpace, samePath } from '../../space-paths'
import { workspace } from '../../workspace.svelte'
import type { FileAction } from '../../workspace/undo.svelte'
import type { Thread } from '../chat/types'
import type { FileChange } from './files'

/** A file moved the way an agent's move moves it. */
async function moved(root: string, from: string, to: string): Promise<void> {
  const { movedIn } = await import('../../automation/acts')
  await movedIn(root, from, to)
}

/** The folder of the space a change was made in: the one the call named, else the
 *  thread's. */
function rootOf(change: FileChange, thread: Pick<Thread, 'space'>): string | null {
  const named = change.space
  const space =
    (named ? workspace.spaces.find((one) => one.id === named || one.name === named) : undefined) ??
    workspace.spaces.find((one) => one.id === thread.space)
  return space?.root ?? null
}

/** The step that deleted `path`, newest first, if it is still on the stack. */
function deletion(path: string): Extract<FileAction, { kind: 'delete' }> | null {
  for (const action of [...workspace.undone.stack].reverse())
    if (action.kind === 'delete' && samePath(action.path, path)) return action
  return null
}

/** Takes one change back. Answers whether it was. */
export async function undoFile(
  change: FileChange,
  thread: Pick<Thread, 'space'>,
): Promise<boolean> {
  const root = rootOf(change, thread)
  if (!root) return false
  try {
    if (change.kind === 'moved') {
      await moved(root, change.path, change.from)
      return true
    }
    const step = deletion(insideSpace(root, change.path))
    if (!step) return false
    const { putBack } = await import('../../workspace/undoing')
    const back = await putBack(step)
    workspace.undone.without(step)
    await workspace.fileCame(back, 'file')
    await workspace.loadTree()
    return true
  } catch {
    // Something has since taken the name, or the copy is gone: left as it is, and the
    // row stays for the reader to see.
    return false
  }
}

/** Does a change taken back again: the move made again, the note deleted again. */
export async function redoFile(change: FileChange, thread: Pick<Thread, 'space'>): Promise<void> {
  const root = rootOf(change, thread)
  if (!root) return
  if (change.kind === 'moved') await moved(root, change.from, change.path).catch(() => undefined)
  else await workspace.remove(insideSpace(root, change.path), false).catch(() => undefined)
}
