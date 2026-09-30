import { describe, expect, test } from 'vitest'
import { windowDocument } from './window-document'

const note = { shown: 'Idea', path: '/Users/me/Notes/Idea.md' }

describe('the window of a note', () => {
  test('is the app when nothing is open', () => {
    expect(windowDocument(null, true)).toEqual({ title: 'nibeditor', edited: false, path: null })
    expect(windowDocument(null, false)).toEqual({ title: 'nibeditor', edited: false, path: null })
  })

  /** Every note with a file writes itself, so the dot in a Mac's close button would
   *  never say anything true of one for longer than a pause in the typing. */
  test('on a Mac is the note, and the close button wears no edited dot for a file', () => {
    expect(windowDocument(note, true)).toEqual({
      title: 'Idea',
      edited: false,
      path: '/Users/me/Notes/Idea.md',
    })
  })

  /** A document never saved is the one thing the dot is true of, as in TextEdit. */
  test('on a Mac wears the edited dot for a note with no file yet', () => {
    expect(windowDocument({ ...note, path: null, draft: true }, true).edited).toBe(true)
    expect(windowDocument({ ...note, path: null, draft: true }, false).edited).toBe(false)
  })

  test('on a Mac stands for no file when the note has none', () => {
    expect(windowDocument({ ...note, path: null }, true).path).toBeNull()
    expect(windowDocument({ ...note, path: 'https://example.com' }, true).path).toBeNull()
  })

  test('elsewhere is the name and the app, and never a mark between them', () => {
    expect(windowDocument(note, false)).toEqual({
      title: 'Idea - nibeditor',
      edited: false,
      path: null,
    })
  })
})
