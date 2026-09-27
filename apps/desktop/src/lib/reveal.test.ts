import { describe, expect, test } from 'vitest'
import { revealLabel } from './reveal'

/** A Mac names its file manager, and names it the way the app a row reads like
 *  does: a download as Safari's, the file list as Obsidian's. Everywhere else the
 *  one phrase there was. */
describe('the words for showing a file where it sits', () => {
  test('name Finder on a Mac', () => {
    expect(revealLabel('download', 'macos')).toBe('Show in Finder')
    expect(revealLabel('tree', 'macos')).toBe('Reveal in Finder')
  })

  test('stay as they were on Windows and Linux', () => {
    for (const system of ['windows', 'linux']) {
      expect(revealLabel('download', system)).toBe('Show in folder')
      expect(revealLabel('tree', system)).toBe('Show in folder')
    }
  })
})
