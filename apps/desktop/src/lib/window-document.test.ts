import { describe, expect, test } from 'vitest'
import { windowDocument } from './window-document'

const note = { shown: 'Idea', unsaved: false, path: '/Users/me/Notes/Idea.md' }

describe('the window of a note', () => {
  test('is the app when nothing is open', () => {
    expect(windowDocument(null, true)).toEqual({ title: 'Nib', edited: false, path: null })
    expect(windowDocument(null, false)).toEqual({ title: 'Nib', edited: false, path: null })
  })

  test('on a Mac is the note, with the unsaved mark in the close button', () => {
    expect(windowDocument(note, true)).toEqual({
      title: 'Idea',
      edited: false,
      path: '/Users/me/Notes/Idea.md',
    })
    expect(windowDocument({ ...note, unsaved: true }, true)).toMatchObject({
      title: 'Idea',
      edited: true,
    })
  })

  test('on a Mac stands for no file when the note has none', () => {
    expect(windowDocument({ ...note, path: null }, true).path).toBeNull()
    expect(windowDocument({ ...note, path: 'https://example.com' }, true).path).toBeNull()
  })

  test('elsewhere says all of it in the title, as it always has', () => {
    expect(windowDocument(note, false)).toEqual({ title: 'Idea - Nib', edited: false, path: null })
    expect(windowDocument({ ...note, unsaved: true }, false).title).toBe('Idea · - Nib')
  })
})
