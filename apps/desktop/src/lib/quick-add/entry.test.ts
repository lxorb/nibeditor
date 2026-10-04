import { describe, expect, test } from 'vitest'
import { type Entry, linesOf, placeIn } from './entry'

/** What quick add writes and where a note takes it: one more item of the list a note
 *  ends in, a list of its own after a paragraph, the end of a heading's section, and a
 *  heading made where the note has none by that name (docs/tasks.md 5.6). */

const entry = (fields: Partial<Entry['fields']> = {}, more: Partial<Entry> = {}): Entry => ({
  text: 'Call mum',
  fields: { tags: [], remind: [], ...fields },
  ...more,
})

describe('the line', () => {
  test("in nib's order, the Tasks plugin's fields last", () => {
    expect(
      linesOf(
        entry({
          due: '2026-10-08',
          time: '16:00',
          priority: 1,
          tags: ['family'],
          recurrence: 'every week on Sunday',
          remind: [{ before: 30 }],
        }),
      ),
    ).toEqual([
      '- [ ] Call mum [time:: 16:00] [remind:: 30m] #family 🔺 🔁 every week on Sunday 📅 2026-10-08',
    ])
  })

  test('with its description indented under it', () => {
    expect(linesOf(entry({}, { description: 'The number is\non the card\n' }))).toEqual([
      '- [ ] Call mum',
      '  The number is',
      '  on the card',
    ])
  })
})

/** The note with the lines put where `placeIn` says. */
function placed(note: string, lines: string[], heading?: string) {
  const at = placeIn(note, lines, heading)
  const after = note.slice(0, at.at) + at.insert + note.slice(at.at)
  return { after, line: after.split(/\r?\n/)[at.line] }
}

describe('where it goes', () => {
  const TASK = ['- [ ] Call mum']

  test('an empty note, the inbox the first time', () => {
    expect(placed('', TASK)).toEqual({ after: '- [ ] Call mum\n', line: '- [ ] Call mum' })
  })

  test('one more item of the list the note ends in', () => {
    expect(placed('# Inbox\n\n- [ ] Pay rent\n', TASK).after).toBe(
      '# Inbox\n\n- [ ] Pay rent\n- [ ] Call mum\n',
    )
  })

  test('after a task with a description under it, still the same list', () => {
    expect(placed('- [ ] Pay rent\n  by Friday\n', TASK).after).toBe(
      '- [ ] Pay rent\n  by Friday\n- [ ] Call mum\n',
    )
  })

  test('a list of its own after a paragraph', () => {
    expect(placed('Some words.\n', TASK)).toEqual({
      after: 'Some words.\n\n- [ ] Call mum\n',
      line: '- [ ] Call mum',
    })
  })

  test("at the end of a heading's section, the next heading left alone", () => {
    const note = '# Errands\n- [ ] Pay rent\n\n## Calls\n- [ ] Bank\n\n## Later\nwords\n'
    expect(placed(note, TASK, 'calls')).toEqual({
      after:
        '# Errands\n- [ ] Pay rent\n\n## Calls\n- [ ] Bank\n- [ ] Call mum\n\n## Later\nwords\n',
      line: '- [ ] Call mum',
    })
  })

  test('under a heading with nothing under it yet', () => {
    expect(placed('## Calls\n## Later\n', TASK, 'Calls').after).toBe(
      '## Calls\n- [ ] Call mum\n## Later\n',
    )
  })

  test('a heading the note does not have, made at its end', () => {
    expect(placed('# Errands\n- [ ] Pay rent\n', TASK, 'Calls')).toEqual({
      after: '# Errands\n- [ ] Pay rent\n\n## Calls\n- [ ] Call mum\n',
      line: '- [ ] Call mum',
    })
    expect(placed('', TASK, 'Calls').after).toBe('## Calls\n- [ ] Call mum\n')
  })

  test('the line endings a Windows file has', () => {
    expect(placed('- [ ] Pay rent\r\n', TASK).after).toBe('- [ ] Pay rent\r\n- [ ] Call mum\r\n')
  })
})
