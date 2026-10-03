/** A message edited and sent again keeps what followed it the first time (docs/ai-sidebar.md
 *  4.5, claude.ai's way): the old tail of the thread is kept beside the new one, and
 *  the arrows under the message walk between them.
 *
 *  Kept on the thread itself, as `branches`, so it is written down with it: by the turn
 *  before the message (`''` for the first message), every tail there has been, and which
 *  one the thread shows. The one it shows lives in `turns`; its slot is filled when the
 *  reader moves to another. Switching is the conversation only: the notes stay as they
 *  are, as a rewind's "conversation only" leaves them. Pure. */

import type { Thread, Turn } from '../chat/types'

/** Every tail a message has had, and the one shown. */
export interface Fork {
  tails: Turn[][]
  at: number
}

/** A thread with its branches. Any thread is one; the field is optional and is kept as
 *  written by the thread store (chat/threads.ts keeps a field it does not read). */
export type Branched = Thread & { branches?: Record<string, Fork> }

/** Where a message's branches are kept: the turn before it. */
function keyAt(turns: readonly Turn[], index: number): string {
  return turns[index - 1]?.id ?? ''
}

/** The branches at the reader's message `turn`: how many, and which is shown. Null
 *  where it was never edited. */
export function forkAt(thread: Branched, turn: string): { count: number; at: number } | null {
  const index = thread.turns.findIndex((one) => one.id === turn)
  if (index < 0) return null
  const fork = thread.branches?.[keyAt(thread.turns, index)]
  return fork && fork.tails.length > 1 ? { count: fork.tails.length, at: fork.at } : null
}

/** Cuts the thread before its message `turn`, keeping what is cut as a branch, and
 *  makes room for the tail the edited message is about to start. Answers what was
 *  cut, or null for a turn the thread does not have. */
export function cutForEdit(thread: Branched, turn: string): Turn[] | null {
  const index = thread.turns.findIndex((one) => one.id === turn)
  if (index < 0) return null
  const key = keyAt(thread.turns, index)
  const tail = thread.turns.splice(index)
  const branches = (thread.branches ??= {})
  const fork = branches[key]
  if (fork) {
    fork.tails[fork.at] = tail
    fork.tails.push([])
    fork.at = fork.tails.length - 1
  } else {
    branches[key] = { tails: [tail, []], at: 1 }
  }
  return tail
}

/** Shows another branch at the message `turn`: `step` is -1 or 1. Answers whether it
 *  moved. */
export function switchBranch(thread: Branched, turn: string, step: number): boolean {
  const index = thread.turns.findIndex((one) => one.id === turn)
  if (index < 0) return false
  const fork = thread.branches?.[keyAt(thread.turns, index)]
  const to = (fork?.at ?? 0) + step
  const next = fork?.tails[to]
  if (!fork || !next) return false

  fork.tails[fork.at] = thread.turns.splice(index)
  thread.turns.push(...next)
  fork.at = to
  return true
}
