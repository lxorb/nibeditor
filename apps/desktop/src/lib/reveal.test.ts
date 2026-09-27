import { describe, expect, test } from 'vitest'
import { showLabel } from './reveal'

/** A Mac names its file manager on a download's row, the way Safari does.
 *  Everywhere else the one phrase there was. */
describe('the words for showing a download where it sits', () => {
  test('name Finder on a Mac', () => {
    expect(showLabel('macos')).toBe('Show in Finder')
  })

  test('stay as they were on Windows and Linux', () => {
    expect(showLabel('windows')).toBe('Show in folder')
    expect(showLabel('linux')).toBe('Show in folder')
  })
})
