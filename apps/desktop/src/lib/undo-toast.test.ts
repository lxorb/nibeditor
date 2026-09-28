import { afterEach, describe, expect, test, vi } from 'vitest'
import { UNDO_LINGER } from './backoff'
import { nextBatch, undoToast } from './undo-toast.svelte'
import type { FileAction } from './workspace/undo.svelte'

/** When the toast is up, what it offers, and what its one press takes back. */

const deleted = (path: string): FileAction => ({ kind: 'delete', path, content: '' })
const moved = (from: string): FileAction => ({ kind: 'move', from, to: `Archive/${from}` })
const renamed = (from: string): FileAction => ({ kind: 'rename', from, to: `${from}!` })

describe('what the toast offers', () => {
  test('a delete is offered, and so is a move', () => {
    const one = deleted('A.md')
    expect(nextBatch([], [one], [one])).toEqual([one])

    const two = moved('B.md')
    expect(nextBatch([], [two], [one, two])).toEqual([two])
  })

  /** A rename is made in the field it was typed in, and a replacement from the find
   *  bar: neither is a surprise to take back from a toast. */
  test('nothing else is', () => {
    const one = renamed('A.md')
    expect(nextBatch([], [one], [one])).toEqual([])
  })

  /** Deleting three selected notes records three deletes, one after another. */
  test('the same kind while it is up joins it', () => {
    const [a, b, c] = [deleted('A.md'), deleted('B.md'), deleted('C.md')]
    let batch = nextBatch([], [a], [a])
    batch = nextBatch(batch, [b], [a, b])
    batch = nextBatch(batch, [c], [a, b, c])
    expect(batch).toEqual([a, b, c])

    // Or all at once, when they landed between two looks.
    expect(nextBatch([], [a, b, c], [a, b, c])).toEqual([a, b, c])
  })

  test('another kind starts again, and anything else ends it', () => {
    const [a, b] = [deleted('A.md'), moved('B.md')]
    expect(nextBatch([a], [b], [a, b])).toEqual([b])

    const c = renamed('C.md')
    expect(nextBatch([a], [c], [a, c])).toEqual([])
  })

  /** The Undo row in a menu took the newest back: the toast has one fewer to offer,
   *  and none once they are all back. */
  test('an undo from elsewhere takes the action off it', () => {
    const [a, b] = [deleted('A.md'), deleted('B.md')]
    expect(nextBatch([a, b], [], [a])).toEqual([a])
    expect(nextBatch([a], [], [])).toEqual([])
  })
})

describe('the toast', () => {
  afterEach(() => {
    undoToast.dismiss()
    vi.useRealTimers()
  })

  test('what was on the stack before is not news', () => {
    const old = deleted('Old.md')
    undoToast.know([old])
    undoToast.heard([old])
    expect(undoToast.kind).toBeNull()

    const fresh = moved('New.md')
    undoToast.heard([old, fresh])
    expect(undoToast.kind).toBe('move')
  })

  /** And an older action coming back to the top after an undo is not one either. */
  test('an action back on top after an undo does not bring it back', () => {
    const [a, b] = [deleted('A.md'), renamed('B.md')]
    undoToast.heard([a])
    undoToast.heard([a, b])
    expect(undoToast.kind).toBeNull()

    undoToast.heard([a])
    expect(undoToast.kind).toBeNull()
  })

  test('goes after a few seconds, unless the pointer is on it', () => {
    vi.useFakeTimers()
    const a = deleted('A.md')
    undoToast.heard([a])
    expect(undoToast.kind).toBe('delete')

    undoToast.hold()
    vi.advanceTimersByTime(UNDO_LINGER * 2)
    expect(undoToast.kind).toBe('delete')

    undoToast.linger()
    vi.advanceTimersByTime(UNDO_LINGER)
    expect(undoToast.kind).toBeNull()
  })

  test('Undo takes the whole batch back, newest first, and goes', async () => {
    const [a, b] = [deleted('A.md'), deleted('B.md')]
    const stack = [renamed('Z.md'), a, b]
    const undone: FileAction[] = []
    const store = {
      undone: {
        get stack() {
          return stack
        },
        get last() {
          return stack.at(-1)
        },
      },
      undoFileAction: () => {
        const top = stack.pop()
        if (top) undone.push(top)
        return Promise.resolve()
      },
    }

    undoToast.heard(stack.slice(0, 1))
    undoToast.heard([...stack])
    await undoToast.undo(store)

    expect(undone).toEqual([b, a])
    // The rename underneath was not the toast's.
    expect(stack).toHaveLength(1)
    expect(undoToast.kind).toBeNull()
  })

  /** An undo that could not happen leaves the action on top; the older ones under it
   *  are not reached past it. */
  test('stops at an action that would not go back', async () => {
    const [a, b] = [deleted('A.md'), deleted('B.md')]
    const stack = [a, b]
    let asked = 0
    const store = {
      undone: {
        stack,
        get last() {
          return stack.at(-1)
        },
      },
      undoFileAction: () => {
        asked += 1
        return Promise.resolve()
      },
    }

    undoToast.heard([...stack])
    await undoToast.undo(store)
    expect(asked).toBe(1)
  })
})
