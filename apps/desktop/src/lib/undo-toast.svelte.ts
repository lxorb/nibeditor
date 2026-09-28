/** The short "Undo" that follows a file somebody deleted or moved.
 *
 *  The way Gmail and Notion do it: the thing is gone at once, and for a few seconds
 *  one press brings it back. Until now the only way back was the Undo row at the foot
 *  of a row's menu, which nobody looks for straight after a delete they did not mean.
 *
 *  Nothing is kept here that the undo stack does not already keep. The toast offers
 *  the actions at the top of `workspace.undone`, and taking them back is the same
 *  `undoFileAction` the menu row runs - so the toast and the row can never disagree,
 *  and an undo from the row takes the toast's action off it too.
 *
 *  One press for one gesture. Deleting or moving a selection records one action per
 *  file, one after another, so actions of the same kind arriving while the toast is up
 *  join it, and Undo takes all of them back. A different kind of action is a
 *  different gesture and starts again. */

import { UNDO_LINGER } from './backoff'
import type { FileAction } from './workspace/undo.svelte'

/** What the toast is about: a delete, or a move. Everything else on the stack is
 *  taken back from the menus. */
type Offered = FileAction & { kind: 'delete' | 'move' }

function offered(action: FileAction): action is Offered {
  return action.kind === 'delete' || action.kind === 'move'
}

/** What the toast offers once the stack reads `stack`, having offered `batch`, where
 *  `fresh` are the actions that arrived since it last looked, oldest first.
 *
 *  Pure, so the rule can be read and tested apart from any timer. An action somebody
 *  took back some other way has gone from the stack and goes from the batch; an
 *  action of another kind on top of the stack means Undo would no longer reach the
 *  batch, so there is nothing to offer. */
export function nextBatch(
  batch: readonly FileAction[],
  fresh: readonly FileAction[],
  stack: readonly FileAction[],
): Offered[] {
  let next = batch.filter((action): action is Offered => offered(action) && stack.includes(action))

  for (const action of fresh) {
    if (!offered(action)) next = []
    else if (next[0]?.kind === action.kind) next = [...next, action]
    else next = [action]
  }

  const top = stack.at(-1)
  return top !== undefined && next.at(-1) === top ? next : []
}

/** What the undo stack has to give the toast. */
interface Undoable {
  readonly undone: { readonly stack: readonly FileAction[]; readonly last: FileAction | undefined }
  undoFileAction(): Promise<void>
}

class UndoToast {
  batch = $state<Offered[]>([])

  /** Every action the toast has looked at, so an older one coming back to the top
   *  of the stack - after an undo - is not taken for a new one. */
  private seen = new WeakSet<FileAction>()
  private timer: ReturnType<typeof setTimeout> | undefined

  /** Which kind the toast is about, or null when it is not up. */
  get kind(): Offered['kind'] | null {
    return this.batch[0]?.kind ?? null
  }

  /** What was on the stack before anybody did anything: none of it is news. */
  know(stack: readonly FileAction[]) {
    for (const action of stack) this.seen.add(action)
  }

  /** The stack has changed. */
  heard(stack: readonly FileAction[]) {
    const fresh = stack.filter((action) => !this.seen.has(action))
    this.know(fresh)

    this.batch = nextBatch(this.batch, fresh, stack)
    if (fresh.length && this.batch.length) this.linger()
    else if (!this.batch.length) this.stop()
  }

  /** Takes the whole batch back, newest first, for as long as the newest is still
   *  the one on top: something else done in between is not the toast's to undo. */
  async undo(from: Undoable) {
    const batch = this.batch
    this.dismiss()

    for (const action of [...batch].reverse()) {
      if (from.undone.last !== action) return
      await from.undoFileAction()
    }
  }

  dismiss() {
    this.batch = []
    this.stop()
  }

  /** Held while the pointer is on it, so a hand on its way to Undo is not beaten to
   *  it by the clock. */
  hold() {
    this.stop()
  }

  linger() {
    this.stop()
    this.timer = setTimeout(() => this.dismiss(), UNDO_LINGER)
  }

  private stop() {
    clearTimeout(this.timer)
    this.timer = undefined
  }
}

export const undoToast = new UndoToast()
