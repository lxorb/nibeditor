import { describe, expect, test } from 'vitest'
import { readPressed } from './keys'

/** A key the crate took from a page, as the window reads it. What it does once played
 *  is the window's own handler, as for any key pressed in the app; which keys are taken
 *  is `web_keys.rs` and its own tests. */
describe('a key out of a page', () => {
  test('is read as the crate sends it', () => {
    expect(
      readPressed({
        key: 't',
        code: 'KeyT',
        ctrl: true,
        shift: false,
        alt: false,
        repeat: false,
        down: true,
      }),
    ).toEqual({
      key: 't',
      code: 'KeyT',
      ctrl: true,
      shift: false,
      alt: false,
      repeat: false,
      down: true,
    })
  })

  /** A modifier let go of. */
  test('and a release is a release', () => {
    expect(readPressed({ key: 'Control', code: 'ControlLeft', down: false })).toMatchObject({
      key: 'Control',
      ctrl: false,
      down: false,
    })
  })

  /** Only `true` is true, so a field that went missing is a modifier nobody held. */
  test('holds nothing it was not told', () => {
    expect(readPressed({ key: 'w', code: 'KeyW', ctrl: 'yes', down: 1 })).toMatchObject({
      ctrl: false,
      down: false,
    })
  })

  test('and is nothing where the crate said nothing a key could be', () => {
    expect(readPressed(null)).toBeNull()
    expect(readPressed('t')).toBeNull()
    expect(readPressed({ key: '', code: 'KeyT' })).toBeNull()
    expect(readPressed({ key: 't' })).toBeNull()
  })
})
