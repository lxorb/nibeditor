import { describe, expect, test } from 'vitest'
import { keepsSystemMenu } from './system-menu'

/** A right click is pictured by what it landed on, as the window's handler sees it. */
function on(tagName: string, type?: string): EventTarget {
  return { tagName, type } as unknown as EventTarget
}

describe('the system menu', () => {
  test('is kept in a text field on a Mac, for Look Up, spelling and Services', () => {
    expect(keepsSystemMenu(on('TEXTAREA'), 'macos')).toBe(true)
    expect(keepsSystemMenu(on('INPUT', 'text'), 'macos')).toBe(true)
    expect(keepsSystemMenu(on('INPUT', 'search'), 'macos')).toBe(true)
  })

  test('but not in a field that holds no words', () => {
    expect(keepsSystemMenu(on('INPUT', 'password'), 'macos')).toBe(false)
    expect(keepsSystemMenu(on('INPUT', 'checkbox'), 'macos')).toBe(false)
  })

  /** The note has a menu of its own, and so does every row that has one at all. */
  test('nor anywhere that is not a field', () => {
    expect(keepsSystemMenu(on('DIV'), 'macos')).toBe(false)
    expect(keepsSystemMenu(null, 'macos')).toBe(false)
  })

  test('nor anywhere on Windows or Linux, where it is the browser engine’s', () => {
    expect(keepsSystemMenu(on('TEXTAREA'), 'windows')).toBe(false)
    expect(keepsSystemMenu(on('INPUT', 'text'), 'linux')).toBe(false)
  })
})
