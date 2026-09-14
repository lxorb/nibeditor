import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { toast } from './toasting.svelte'
import { said } from './said.svelte'

/** What a quiet gesture just did, and the one thing left to do about it.
 *
 *  The Undo is the reason this exists: archiving takes a row out of every list and closes
 *  its tab, so the row is gone before the reader has let go of the mouse. What matters here
 *  is that the button runs what it was given, that pressing it takes the notice away rather
 *  than leaving it sitting there already acted on, and that a second notice replaces the
 *  first instead of stacking. */

beforeEach(() => {
  vi.useFakeTimers()
  toast.hide()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('a notice', () => {
  test('says what happened, and offers one thing to do', () => {
    toast.show('Archived', 'Undo', () => undefined)

    expect(toast.showing?.words).toBe('Archived')
    expect(toast.showing?.action).toBe('Undo')
  })

  test('is said out loud as well, because a card in a corner is a colour to a listener', () => {
    // A phrase of its own, because `said` makes the same words twice a repeat: it empties the
    // region and puts them back a beat later, which is the only way a live region says the
    // same sentence twice. That is its business, and tested where it lives.
    toast.show('Put away', 'Undo', () => undefined)

    expect(said.words).toBe('Put away')
  })

  test('goes by itself after a few seconds', () => {
    toast.show('Archived', 'Undo', () => undefined)
    vi.advanceTimersByTime(4000)

    expect(toast.showing).toBeNull()
  })

  test('and may have nothing to take back', () => {
    toast.show('Saved')

    expect(toast.showing?.action).toBeNull()
  })
})

describe('the button', () => {
  test('runs what the notice was given', () => {
    let undone = false
    toast.show('Archived', 'Undo', () => (undone = true))
    toast.take()

    expect(undone).toBe(true)
  })

  test('and takes the notice away, so it cannot be pressed twice', () => {
    let times = 0
    toast.show('Archived', 'Undo', () => (times += 1))
    toast.take()
    toast.take()

    expect(times).toBe(1)
    expect(toast.showing).toBeNull()
  })

  test('pressed on nothing does nothing', () => {
    expect(() => toast.take()).not.toThrow()
  })
})

describe('a second notice', () => {
  test('replaces the first rather than stacking', () => {
    // Two cards in a corner are two things to read at once, and the newer one is the one the
    // reader just caused. The same reason `said` holds one live region.
    toast.show('Archived', 'Undo', () => undefined)
    toast.show('Unarchived', 'Undo', () => undefined)

    expect(toast.showing?.words).toBe('Unarchived')
  })

  test('is a new notice rather than the first one’s words swapped', () => {
    toast.show('Archived')
    const first = toast.showing?.id
    toast.show('Unarchived')

    expect(toast.showing?.id).not.toBe(first)
  })

  test('and gets the whole wait of its own', () => {
    toast.show('Archived')
    vi.advanceTimersByTime(3000)
    toast.show('Unarchived')
    vi.advanceTimersByTime(3000)

    expect(toast.showing?.words).toBe('Unarchived')

    vi.advanceTimersByTime(1000)
    expect(toast.showing).toBeNull()
  })
})
