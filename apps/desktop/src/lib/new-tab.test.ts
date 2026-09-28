import { describe, expect, test } from 'vitest'
import { besideAt, howFor, type Press, tabAsk } from './new-tab'

/** Which press asks for a tab of its own, and what an open makes of it.
 *
 *  Every surface that opens something reads its press through `tabAsk`, so these are
 *  the browser's convention held down once: the file list, a link, a search hit and
 *  the palette cannot drift apart without one of these failing. The tests run off a
 *  Mac, where the modifier is Ctrl. */

const PLAIN: Press = { button: 0, ctrlKey: false, metaKey: false, shiftKey: false }

function ask(press: Partial<Press>, shiftOpens = false) {
  return tabAsk({ ...PLAIN, ...press }, shiftOpens)
}

describe('what a press asks for', () => {
  test('a plain click asks for nothing beyond the surface of its own', () => {
    expect(ask({})).toBe('plain')
  })

  test('Ctrl+click opens a tab behind, Ctrl+Shift+click one in front', () => {
    expect(ask({ ctrlKey: true })).toBe('behind')
    expect(ask({ ctrlKey: true, shiftKey: true })).toBe('front')
  })

  test('the middle button opens a tab behind, and in front with Shift', () => {
    expect(ask({ button: 1 })).toBe('behind')
    expect(ask({ button: 1, shiftKey: true })).toBe('front')
  })

  test('Cmd is not the modifier off a Mac', () => {
    expect(ask({ metaKey: true })).toBe('plain')
  })

  test('Shift alone opens a tab in front only where Shift means nothing else', () => {
    expect(ask({ shiftKey: true })).toBe('plain')
    expect(ask({ shiftKey: true }, true)).toBe('front')
  })

  test('a key has no button and is read as the main one', () => {
    expect(tabAsk({ ctrlKey: true, metaKey: false, shiftKey: false })).toBe('behind')
    expect(tabAsk({ ctrlKey: false, metaKey: false, shiftKey: false })).toBe('plain')
  })

  test('the right button asks for nothing', () => {
    expect(ask({ button: 2 })).toBe('plain')
  })
})

describe('how an open goes', () => {
  test('a plain press keeps the surface’s own open, preview and all', () => {
    expect(howFor('plain', { preview: true })).toEqual({ preview: true })
    expect(howFor('plain')).toEqual({})
  })

  test('a tab asked for is never the preview, and goes beside the one in front', () => {
    expect(howFor('behind', { preview: true })).toEqual({ activate: false, beside: true })
    expect(howFor('front', { preview: true })).toEqual({ beside: true })
  })
})

describe('where a tab opened beside another goes', () => {
  const strip = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }]

  test('right after the tab it was opened from', () => {
    expect(besideAt(strip, 'b', null)).toBe(2)
  })

  test('after the last one opened from the same tab, so a run keeps its order', () => {
    expect(besideAt(strip, 'b', 'c')).toBe(3)
  })

  test('a previous tab that is not there any more is not waited for', () => {
    expect(besideAt(strip, 'b', 'gone')).toBe(2)
  })

  test('an opener the strip has not got means the end', () => {
    expect(besideAt(strip, 'gone', null)).toBe(null)
  })
})
