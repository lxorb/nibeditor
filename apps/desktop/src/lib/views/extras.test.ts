/** Lane 7's logic in the app: what a base does when its rows change (automate.ts), a
 *  property's choices (options.ts), a column's format (format.ts), and an automation's
 *  write folded into the undo of the edit that fired it (workspace/undo-join.ts). */

import { readBase, type Row } from '@nib/bases'
import { describe, expect, test } from 'vitest'
import type { FileAction } from '../workspace/undo.svelte'
import { joinedAction } from '../workspace/undo-join'
import { planned } from './automate'
import { contextFor } from './context'
import { noteRow } from './fixture'
import { formatted } from './format'
import { optionsFor, renamedIn, reprefixed, valuesOf } from './options'

const TODAY = '2026-10-05'
const filling = { today: TODAY, time: '09:30' }
const day = (iso: string) => new Date(`${iso}T09:00:00`).getTime()

const base = readBase(`filters:
  and:
    - file.inFolder("Bugs")
nib:
  id: { property: id, prefix: BUG }
  automations:
    - when: { property: status, is: Done }
      set: { finished: "{{date}}" }
    - when: added
      set: { status: To do }
`)
const held = [{ name: 'Bugs', space: 'Notes', base }]

function plan(removed: Row[], added: Row[], all: Row[]) {
  const context = contextFor({ rows: all, today: TODAY, now: `${TODAY}T09:30:00` })
  return planned(held, removed, added, all, context, filling)
}

describe('a base at work on a change', () => {
  const older = noteRow('Bugs/Crash.md', 'id: BUG-1\nstatus: Doing', { ctime: day('2026-01-01') })

  test('a row going Done gets its date, as one change to that row', () => {
    const done = noteRow('Bugs/Crash.md', 'id: BUG-1\nstatus: Done', { ctime: day('2026-01-01') })
    const out = plan([older], [done], [done])
    expect(out.writes).toEqual([
      { row: done, change: { note: { finished: { kind: 'date', iso: TODAY } } } },
    ])
  })

  test('the same row looked at again fires nothing: once per change', () => {
    const done = noteRow('Bugs/Crash.md', 'id: BUG-1\nstatus: Done', { ctime: day('2026-01-01') })
    expect(plan([done], [done], [done]).writes).toEqual([])
  })

  test('a row made without an id gets the next, with what an added row is set to', () => {
    const made = noteRow('Bugs/New.md', '', { ctime: day('2026-02-01') })
    const out = plan([], [made], [older, made])
    expect(out.writes).toEqual([{ row: made, change: { note: { status: 'To do', id: 'BUG-2' } } }])
  })

  test('two rows two devices both numbered 2: the younger is renumbered', () => {
    const first = noteRow('Bugs/A.md', 'id: BUG-2', { ctime: day('2026-03-01') })
    const second = noteRow('Bugs/B.md', 'id: BUG-2', { ctime: day('2026-03-02') })
    const out = plan([], [second], [older, first, second])
    expect(out.writes.map((one) => [one.row.path, one.change.note?.id])).toEqual([
      ['Bugs/B.md', 'BUG-3'],
    ])
  })

  test('a note outside the base is none of its business', () => {
    const film = noteRow('Films/Heat.md', 'status: Done')
    expect(plan([noteRow('Films/Heat.md', 'status: Doing')], [film], [film]).writes).toEqual([])
  })
})

describe("a property's choices", () => {
  const doing = noteRow('A.md', 'status: Doing\ntags: [a, b]')
  const done = noteRow('B.md', 'status: Done\ntags: [b, c]')
  const rows = [doing, done, noteRow('C.md', 'status: Doing')]

  test('start from the values the notes hold, each in the next tone', () => {
    expect(valuesOf(rows, 'note.status')).toEqual(['Doing', 'Done'])
    expect(valuesOf(rows, 'tags')).toEqual(['a', 'b', 'c'])
    expect(optionsFor(['Doing', 'Done'])).toEqual([
      { value: 'Doing', tone: '1' },
      { value: 'Done', tone: '2' },
    ])
  })

  test('renamed, in every note holding one, a list member by member', () => {
    expect(renamedIn(doing, 'status', 'Doing', 'Busy')).toEqual({
      note: { status: 'Busy' },
    })
    expect(renamedIn(done, 'tags', 'b', 'bee')).toEqual({
      note: { tags: ['bee', 'c'] },
    })
    expect(renamedIn(done, 'status', 'Doing', 'Busy')).toBeNull()
  })

  test("a base's ids written again under a new prefix", () => {
    const ids = [noteRow('A.md', 'id: BUG-4'), noteRow('B.md', 'id: 7')]
    expect(reprefixed(ids, 'id', 'BUG', 'ISSUE').map((one) => one.change)).toEqual([
      { note: { id: 'ISSUE-4' } },
    ])
  })
})

describe("a column's format", () => {
  test('a share as a percentage and a bar, money, and words that open', () => {
    expect(formatted(0.25, 'percent')?.text).toMatch(/25\s?%/)
    expect(formatted(40, 'progress')?.share).toBe(0.4)
    expect(formatted(12.5, 'currency:EUR')?.text).toContain('12.50')
    expect(formatted('example.com', 'url')?.href).toBe('https://example.com')
    expect(formatted('a@b.c', 'email')?.href).toBe('mailto:a@b.c')
    expect(formatted('+41 44 123 45 67', 'phone')?.href).toBe('tel:+41441234567')
    expect(formatted('words', 'percent')).toBeNull()
    expect(formatted(3, undefined)).toBeNull()
  })
})

describe("an automation's write", () => {
  const last: FileAction = {
    kind: 'replace',
    notes: [{ path: 'C:/s/Bug.md', content: 'status: Doing', after: 'status: Done', edits: [] }],
  }

  test('is folded into the edit that fired it, and undoing that puts the first words back', () => {
    const joined = joinedAction(last, [
      {
        path: 'C:/s/Bug.md',
        content: 'status: Done',
        after: 'status: Done\nfinished: x',
        edits: [],
      },
    ])
    expect(joined).toMatchObject({
      kind: 'replace',
      notes: [{ content: 'status: Doing', after: 'status: Done\nfinished: x' }],
    })
    const note = joined?.kind === 'replace' ? joined.notes[0] : undefined
    const edits = note?.edits ?? []
    let words = note?.after ?? ''
    for (const edit of [...edits].reverse())
      words = words.slice(0, edit.from) + edit.insert + words.slice(edit.to)
    expect(words).toBe('status: Doing')
  })

  test('stands alone where something else was written in between', () => {
    expect(
      joinedAction(last, [
        { path: 'C:/s/Bug.md', content: 'status: Done!', after: 'x', edits: [] },
      ]),
    ).toBeNull()
    expect(
      joinedAction(last, [{ path: 'C:/s/Other.md', content: 'a', after: 'b', edits: [] }]),
    ).toBeNull()
    expect(joinedAction(undefined, [])).toBeNull()
  })
})
