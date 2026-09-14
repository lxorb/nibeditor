import { describe, expect, test } from 'vitest'
import { archivedAt, archivedIn, archivedNow, ARCHIVED_KEY, isArchived } from './archived'

/** What counts as archived, and what the mark says.
 *
 *  The reading matters more than the writing here, because this app is not the only thing
 *  that writes it: the mark is an ordinary front-matter property, so a reader may tick a
 *  checkbox called `archived` in Obsidian and expect the note to be put away. Everything
 *  except the two words that mean "no" counts, and the two words are the whole of the
 *  subtlety. See docs/archive.md. */

describe('what counts as archived', () => {
  test('a date, which is what this app writes', () => {
    expect(isArchived('2026-09-14T10:00:00.000Z')).toBe(true)
  })

  test('and a word somebody typed, because they meant to put the note away', () => {
    expect(isArchived('true')).toBe(true)
    expect(isArchived('yes')).toBe(true)
    expect(isArchived('soon')).toBe(true)
    // Ticked in Obsidian's property editor, which is the case this rule exists for.
    expect(isArchived('True')).toBe(true)
  })

  test('but not the two words that mean it is not', () => {
    expect(isArchived('false')).toBe(false)
    expect(isArchived('no')).toBe(false)
    // In any case, and with whatever space around them: YAML reads either as false, and a
    // reader who unticked the checkbox left one of them behind.
    expect(isArchived('False')).toBe(false)
    expect(isArchived('  NO  ')).toBe(false)
  })

  test('and not a key that says nothing at all', () => {
    expect(isArchived(null)).toBe(false)
    expect(isArchived(undefined)).toBe(false)
    expect(isArchived('')).toBe(false)
    expect(isArchived('   ')).toBe(false)
  })
})

describe('when it was archived', () => {
  test('is the date the mark says, as a moment', () => {
    expect(archivedAt('2026-09-14T10:00:00.000Z')).toBe(Date.parse('2026-09-14T10:00:00.000Z'))
  })

  test('is null for a mark that is a word rather than a date', () => {
    // Which is the honest answer: the file does not say when, so the archive sorts it last
    // rather than guessing a moment for it.
    expect(archivedAt('true')).toBeNull()
    expect(archivedAt('soon')).toBeNull()
  })

  test('and null for a note nobody archived', () => {
    expect(archivedAt(null)).toBeNull()
    expect(archivedAt('false')).toBeNull()
  })
})

describe('what this app writes', () => {
  test('is a date and time every other tool reads', () => {
    const when = archivedNow()

    expect(isArchived(when)).toBe(true)
    expect(archivedAt(when)).not.toBeNull()
    expect(when).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
  })
})

describe('the mark in a note', () => {
  test('is read off the front matter under its own key', () => {
    const note = `---\n${ARCHIVED_KEY}: 2026-09-14T10:00:00.000Z\n---\n\n# Last year\n`

    expect(archivedIn(note)).toBe('2026-09-14T10:00:00.000Z')
    expect(isArchived(archivedIn(note))).toBe(true)
  })

  test('and a note with no front matter says nothing', () => {
    expect(archivedIn('# Just words\n')).toBeNull()
    expect(isArchived(archivedIn('# Just words\n'))).toBe(false)
  })

  test('a key left saying false is a note nobody archived', () => {
    // What unticking the checkbox in Obsidian leaves behind. The key is still there and the
    // note is not archived, which is exactly what the file says.
    expect(archivedIn('---\narchived: false\n---\n')).toBe('false')
    expect(isArchived(archivedIn('---\narchived: false\n---\n'))).toBe(false)
  })

  test('and the key is not read out of the words of the note', () => {
    // A line in the body that happens to read like the key is a line in the body. Only the
    // block at the top of the file is metadata.
    expect(archivedIn('# A\n\narchived: 2026-09-14\n')).toBeNull()
  })
})
