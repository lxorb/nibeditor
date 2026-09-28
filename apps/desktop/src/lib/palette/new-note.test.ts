import { describe, expect, test } from 'vitest'
import { noteToMake } from './new-note'

describe('a name typed into the palette, as a note', () => {
  test('is a note at the top of the space', () => {
    expect(noteToMake('Groceries')).toEqual({ folder: '', name: 'Groceries.md' })
  })

  test('keeps an ending that was typed', () => {
    expect(noteToMake('Groceries.md')).toEqual({ folder: '', name: 'Groceries.md' })
  })

  test('takes a slash for a folder, either way round', () => {
    expect(noteToMake('Uni / Lecture 3')).toEqual({ folder: 'Uni', name: 'Lecture 3.md' })
    expect(noteToMake('Uni\\Maths\\Sheet 1')).toEqual({ folder: 'Uni/Maths', name: 'Sheet 1.md' })
  })

  test('is nothing where a part could not be written', () => {
    expect(noteToMake('')).toBeNull()
    expect(noteToMake('  /  ')).toBeNull()
    expect(noteToMake('What?')).toBeNull()
    expect(noteToMake('CON/Notes')).toBeNull()
    expect(noteToMake('Done.')).toBeNull()
  })
})
