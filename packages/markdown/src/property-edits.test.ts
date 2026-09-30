import { describe, expect, test } from 'vitest'
import { readProperties } from './properties'
import {
  removeProperty,
  renameProperty,
  withItem,
  withoutItem,
  writeList,
  writeProperty,
  writtenList,
} from './property-edits'

/** What a control in a property row writes back, which has to be plain front matter:
 *  a note edited through the rows and a note typed by hand are the same file, and
 *  nothing written here may be a shape `readProperties` cannot read back. */

const applied = (source: string, edit: { from: number; to: number; insert: string } | null) =>
  edit === null ? source : source.slice(0, edit.from) + edit.insert + source.slice(edit.to)

const NOTE = '---\ntitle: A note\ndone: false\ncount: 3\ntags: [one, two]\n---\n\nWords.\n'

describe('a value typed into a row', () => {
  test('replaces the value and leaves the rest of the block alone', () => {
    expect(applied(NOTE, writeProperty(NOTE, 'title', 'Another'))).toBe(
      '---\ntitle: Another\ndone: false\ncount: 3\ntags: [one, two]\n---\n\nWords.\n',
    )
  })

  test('is written as YAML says it, so a word that reads as something else is quoted', () => {
    const written = applied(NOTE, writeProperty(NOTE, 'title', 'true'))

    expect(written).toContain("title: 'true'")
  })

  test('cannot end the block it is written into', () => {
    const written = applied(NOTE, writeProperty(NOTE, 'title', 'one\n---\nnot the note'))

    // Two fence lines, which is what a block has: a value that could close the
    // block would put the rest of the note's metadata into the note.
    expect(written.split('\n').filter((line) => line.trim() === '---')).toHaveLength(2)
    expect(readProperties(written)).not.toBeNull()
    expect(written.endsWith('Words.\n')).toBe(true)
  })

  test('takes the key away when there is nothing in the field', () => {
    expect(applied(NOTE, writeProperty(NOTE, 'title', null))).not.toContain('title:')
  })

  test('writes nothing at all when the note already says it', () => {
    expect(writeProperty(NOTE, 'title', 'A note')).toBeNull()
  })
})

describe('a checkbox and a number', () => {
  test('are the words YAML reads as a boolean and a number', () => {
    const ticked = applied(NOTE, writeProperty(NOTE, 'done', 'true', 'checkbox'))
    expect(ticked).toContain('done: true')
    expect(readProperties(ticked)?.find((one) => one.key === 'done')?.kind).toBe('checkbox')

    const counted = applied(NOTE, writeProperty(NOTE, 'count', '42', 'number'))
    expect(counted).toContain('count: 42')
    expect(readProperties(counted)?.find((one) => one.key === 'count')?.kind).toBe('number')
  })
})

describe('a list', () => {
  test('is written as the flow sequence every reader of one reads', () => {
    expect(writtenList(['one', 'two'])).toBe('[one, two]')
    expect(writtenList([])).toBe('[]')
    expect(writtenList(['one, two'])).toBe("['one, two']")
  })

  test('replaces the key wherever the note put it', () => {
    expect(applied(NOTE, writeList(NOTE, 'tags', ['one', 'two', 'three']))).toContain(
      'tags: [one, two, three]',
    )
  })

  test('comes back as one line however many lines it was written over', () => {
    const lines = '---\ntags:\n  - one\n  - two\n  - three\ntitle: A note\n---\n\nWords.\n'
    const written = applied(lines, writeList(lines, 'tags', ['one']))

    expect(written).toBe('---\ntags: [one]\ntitle: A note\n---\n\nWords.\n')
    expect(readProperties(written)?.find((one) => one.key === 'tags')?.items).toEqual(['one'])
  })

  test('is appended like any other key where the block does not hold it yet', () => {
    const written = applied(NOTE, writeList(NOTE, 'aliases', ['other']))

    expect(written).toContain('aliases: [other]')
    expect(readProperties(written)?.map((one) => one.key)).toEqual([
      'title',
      'done',
      'count',
      'tags',
      'aliases',
    ])
  })

  test('a chip added is on the end, and the same chip twice says nothing twice', () => {
    const tags = readProperties(NOTE)?.find((one) => one.key === 'tags')
    expect(tags).toBeDefined()
    // Asserted on the line above.
    expect(withItem(tags!, 'three')).toEqual(['one', 'two', 'three'])
    expect(withItem(tags!, 'one')).toBeNull()
    expect(withItem(tags!, '  ')).toBeNull()
  })

  test('a chip taken off is gone, and one that was not there changes nothing', () => {
    const tags = readProperties(NOTE)?.find((one) => one.key === 'tags')
    expect(tags).toBeDefined()
    // Asserted on the line above.
    expect(withoutItem(tags!, 'one')).toEqual(['two'])
    expect(withoutItem(tags!, 'three')).toBeNull()
  })

  test('a chip holding a comma stays one chip through every edit after it', () => {
    // The rows read `["a, b", c]` as three chips once, and the next chip taken off
    // wrote the three back: the note lost the value it had been given.
    const quoted = '---\ntags: ["a, b", c]\n---\n\nWords.\n'
    const tags = readProperties(quoted)?.find((one) => one.key === 'tags')
    expect(tags?.items).toEqual(['a, b', 'c'])

    // Asserted on the line above.
    const written = applied(quoted, writeList(quoted, 'tags', withoutItem(tags!, 'c') ?? []))
    expect(written).toBe("---\ntags: ['a, b']\n---\n\nWords.\n")
    expect(readProperties(written)?.find((one) => one.key === 'tags')?.items).toEqual(['a, b'])

    const again = applied(written, writeList(written, 'tags', ['a, b', "It's, here"]))
    expect(readProperties(again)?.find((one) => one.key === 'tags')?.items).toEqual([
      'a, b',
      "It's, here",
    ])
  })

  test('the last chip off leaves the key with an empty list rather than no key', () => {
    const written = applied(NOTE, writeList(NOTE, 'tags', []))

    expect(written).toContain('tags: []')
    expect(readProperties(written)?.find((one) => one.key === 'tags')?.items).toEqual([])
  })
})

describe('a key renamed from the side panel', () => {
  test('changes the name and nothing else, byte for byte', () => {
    const edit = renameProperty(NOTE, 'done', 'finished')

    expect(edit).toEqual({
      from: NOTE.indexOf('done'),
      to: NOTE.indexOf('done') + 4,
      insert: 'finished',
    })
    expect(applied(NOTE, edit)).toBe(NOTE.replace('done:', 'finished:'))
  })

  test('refuses a name that is not a key, the same name, and one the block already has', () => {
    expect(renameProperty(NOTE, 'done', 'two words')).toBeNull()
    expect(renameProperty(NOTE, 'done', '')).toBeNull()
    expect(renameProperty(NOTE, 'done', 'done')).toBeNull()
    expect(renameProperty(NOTE, 'done', 'Title')).toBeNull()
    expect(renameProperty(NOTE, 'missing', 'other')).toBeNull()
  })
})

describe('a key taken away from the side panel', () => {
  test('takes its line and leaves every other line as it was', () => {
    expect(applied(NOTE, removeProperty(NOTE, 'count'))).toBe(NOTE.replace('count: 3\n', ''))
  })

  test('takes a list written over several lines with it', () => {
    const note = '---\ntitle: A\ntags:\n  - one\n  - two\ndone: true\n---\nWords.\n'

    expect(applied(note, removeProperty(note, 'tags'))).toBe(
      '---\ntitle: A\ndone: true\n---\nWords.\n',
    )
  })

  test('takes the fences too when it was the last key, and the blank line under them', () => {
    expect(
      applied(
        '---\ntitle: A\n---\n\nWords.\n',
        removeProperty('---\ntitle: A\n---\n\nWords.\n', 'title'),
      ),
    ).toBe('Words.\n')
  })

  test('keeps a file’s own line endings', () => {
    const note = '---\r\ntitle: A\r\ndone: true\r\n---\r\nWords.\r\n'
    expect(applied(note, removeProperty(note, 'title'))).toBe(
      '---\r\ndone: true\r\n---\r\nWords.\r\n',
    )
  })

  test('and changes nothing for a key the note does not have', () => {
    expect(removeProperty(NOTE, 'missing')).toBeNull()
  })
})
