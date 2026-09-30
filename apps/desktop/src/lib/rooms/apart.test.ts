/** The three answers to "this device and the room both wrote while they were
 *  apart", and what each of them does to the files.
 *
 *  Which is the rule the reader chose, applied to a room rather than to a pass; see
 *  apart.ts, and sync/conflicts.ts for the rule itself. What this file holds it to is
 *  that none of the three ever leaves the other side's words nowhere. */

import { beforeEach, describe, expect, test, vi } from 'vitest'

import { conflictPath } from '@nib/markdown/paths'
import { apart } from './apart'
import { record } from '../sync/record.svelte'

/** What the platform was asked to do, in order. A room's answer is two things - a
 *  file written and a row waiting - and which of the two happened is the test. */
const wrote: { command: string; path: string; content: string }[] = []

/** What an invoke was given, when it is the kind of value it should be: `args` is a
 *  bag of unknowns. */
const text = (value: unknown) => (typeof value === 'string' ? value : '')

vi.mock('../tauri', () => ({
  invoke: (command: string, args: Record<string, unknown>) => {
    wrote.push({ command, path: text(args.path), content: text(args.content) })
    // Nothing is at the conflict name yet, which is the ordinary case: no version
    // is kept and the copy is simply written.
    if (command === 'read_note') return Promise.reject(new Error('no such file'))
    return Promise.resolve(undefined)
  },
  joinPath: (...parts: string[]) => parts.join('/'),
  isDesktop: false,
  isNative: false,
}))

const NOTE = { path: '/Two hands/Plan.md', id: 'n1', version: 7 }
const THEIRS = '# Plan\n\nwhat the room holds\n'

describe('a device and the room that each wrote while apart', () => {
  beforeEach(() => {
    wrote.length = 0
    record.forgetEverything()
  })

  test("keeps the room's copy beside the note and then offers its own", async () => {
    // The default. The note stays this device's words, as it does for a pass, and
    // the room's copy lands beside it under the name every copy takes - so offering
    // this device's words into the room is no longer a loss.
    expect(await apart('both', NOTE, THEIRS)).toBe('offer')

    expect(wrote.filter((one) => one.command === 'write_note')).toEqual([
      { command: 'write_note', path: conflictPath(NOTE.path), content: THEIRS },
    ])
    expect(record.clashes).toEqual([])
  })

  test('lets the later copy stand for the rule that says so', async () => {
    // The room's words are the ones every other device in the note is looking at
    // and the ones the account holds, so they are the later copy. Nothing is written
    // here: taking them is an edit to the note, which keeps a version on its way
    // past like any other save.
    expect(await apart('newest', NOTE, THEIRS)).toBe('take')

    expect(wrote).toEqual([])
    expect(record.clashes).toEqual([])
  })

  test('writes nothing at all and says so in the pane for the rule that asks', async () => {
    expect(await apart('ask', NOTE, THEIRS)).toBe('wait')

    expect(wrote).toEqual([])
    expect(record.clashes).toEqual([
      expect.objectContaining({ path: NOTE.path, id: 'n1', version: 7, theirs: THEIRS }),
    ])
  })

  test('keeps the note out of a push while its clash waits', async () => {
    await apart('ask', NOTE, THEIRS)

    // Which is what stops the one write that would put this device's words over the
    // copy nobody has read yet; see `held` in sync/pass.ts.
    expect(record.held.has(NOTE.path)).toBe(true)
  })

  test('takes the room&apos;s words for a file that has none here', async () => {
    // One note somebody shared on its own: there is no file on this machine, so
    // there is nothing for a second copy to sit beside and nothing of this device's
    // to lose. Whatever the rule says.
    for (const rule of ['both', 'newest', 'ask'] as const) {
      expect(await apart(rule, { ...NOTE, path: '' }, THEIRS)).toBe('take')
    }

    expect(wrote).toEqual([])
    expect(record.clashes).toEqual([])
  })
})
