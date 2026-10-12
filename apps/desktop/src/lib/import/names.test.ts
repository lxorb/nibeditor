import { describe, expect, test } from 'vitest'

import { hasNotionId, keptName, Names, safeName, titleFrom, withoutNotionId } from './names'

describe('a title as a file name', () => {
  test('loses what no file may be called, keeping the words', () => {
    expect(safeName('Plans: 2026')).toBe('Plans 2026')
    expect(safeName('9/11 notes')).toBe('9 11 notes')
    expect(safeName('What? Why!')).toBe('What Why!')
  })

  test('loses a dot or a space at the end, which Windows drops anyway', () => {
    expect(safeName('Plans.')).toBe('Plans')
    expect(safeName('Plans ')).toBe('Plans')
  })

  test('a title of nothing gets a name', () => {
    expect(safeName('')).toBe('Untitled')
    expect(safeName('///')).toBe('Untitled')
  })

  test('steps around the names MS-DOS took', () => {
    expect(safeName('con')).toBe('con-')
    expect(safeName('LPT1')).toBe('LPT1-')
    expect(safeName('console')).toBe('console')
  })

  test('steps around them in front of the first dot too, which is where Windows looks', () => {
    expect(safeName('Con. Law')).toBe('Con-. Law')
    expect(keptName('Aux. verbs')).toBe('Aux-. verbs')
    expect(keptName('aux.config')).toBe('aux-.config')
    expect(keptName('Cons. Law')).toBe('Cons. Law')
  })

  test('kept from disk keeps a dot or a space before its extension, which Windows keeps', () => {
    expect(keptName('Wait for it...', '.md')).toBe('Wait for it...')
    expect(keptName('Draft ', '.md')).toBe('Draft ')
    // A space that stands in for a forbidden character at the end still comes off.
    expect(keptName('Why?', '.md')).toBe('Why')
    // A folder's name has nothing after it, so Windows would drop them there.
    expect(keptName('Drafts.')).toBe('Drafts')
  })

  test('kept from disk loses a forbidden character at its start, keeping a space it opened with', () => {
    expect(keptName('"Ship it"', '.md')).toBe('Ship it')
    expect(keptName('<Draft>', '.md')).toBe('Draft')
    expect(keptName('*Inbox', '.md')).toBe('Inbox')
    expect(keptName(' Inbox', '.md')).toBe(' Inbox')
    expect(keptName(' ?Inbox', '.md')).toBe(' Inbox')
  })

  test('is short enough to leave room for the folders above it', () => {
    expect(safeName('a'.repeat(300))).toHaveLength(96)
  })

  test('a newline in a title is a space', () => {
    expect(safeName('One\nTwo')).toBe('One Two')
  })
})

describe('the id Notion sticks on every name', () => {
  test('comes off, extension and all', () => {
    expect(withoutNotionId('Plan 1a2b3c4d5e6f78901a2b3c4d5e6f7890.md')).toBe('Plan.md')
    expect(withoutNotionId('Plan-1a2b3c4d5e6f78901a2b3c4d5e6f7890')).toBe('Plan')
  })

  test("is recognised, which is how a zip is known to be Notion's", () => {
    expect(hasNotionId('Plan 1a2b3c4d5e6f78901a2b3c4d5e6f7890.md')).toBe(true)
    expect(hasNotionId('Plan.md')).toBe(false)
    // Sixteen hex characters is not an id, and neither is a word.
    expect(hasNotionId('Plan 1a2b3c4d5e6f7890.md')).toBe(false)
  })
})

describe('a title out of the words', () => {
  test('is the heading when there is one', () => {
    expect(titleFrom('# The plan\n\nWords')).toBe('The plan')
    expect(titleFrom('\n\n### Deeper\n')).toBe('Deeper')
  })

  test('is the first line when there is not', () => {
    expect(titleFrom('Some words\nmore')).toBe('Some words')
  })

  test('is nothing for nothing', () => {
    expect(titleFrom('   \n\n')).toBeNull()
  })
})

describe("keeping an import's own names apart", () => {
  test('steps the second one the way the app steps a new note', () => {
    const names = new Names()

    expect(names.free('Note.md')).toBe('Note.md')
    expect(names.free('Note.md')).toBe('Note 2.md')
    expect(names.free('Note.md')).toBe('Note 3.md')
  })

  test('counts two names that differ only in case as the same name', () => {
    const names = new Names()
    names.free('note.md')

    expect(names.free('Note.md')).toBe('Note 2.md')
  })

  test('a folder can be held without asking for a name', () => {
    const names = new Names()
    names.hold('Plans')

    expect(names.has('plans')).toBe(true)
    expect(names.free('Plans')).toBe('Plans 2')
  })

  test('a name with no extension steps at the end', () => {
    const names = new Names()
    names.free('Folder')

    expect(names.free('Folder')).toBe('Folder 2')
  })

  test('a folder with a dot in its name keeps it', () => {
    // This counted the last dot of the whole path, so a note with no extension
    // under such a folder stepped into a folder nobody had: `v1 2.2/Note`.
    const names = new Names()
    names.free('v1.2/Note')

    expect(names.free('v1.2/Note')).toBe('v1.2/Note 2')
  })
})
