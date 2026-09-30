import { describe, expect, test } from 'vitest'
import { windowDocument } from './window-document'

const note = { shown: 'Idea', path: '/Users/me/Notes/Idea.md' }

describe('the window of a note', () => {
  test('is the app when nothing is open', () => {
    expect(windowDocument(null, true)).toEqual({ title: 'nibeditor', edited: false, path: null })
    expect(windowDocument(null, false)).toEqual({ title: 'nibeditor', edited: false, path: null })
  })

  /** Every note writes itself, so the dot in a Mac's close button would never say
   *  anything true for longer than a pause in the typing. */
  test('on a Mac is the note, and the close button never wears the edited dot', () => {
    expect(windowDocument(note, true)).toEqual({
      title: 'Idea',
      edited: false,
      path: '/Users/me/Notes/Idea.md',
    })
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
