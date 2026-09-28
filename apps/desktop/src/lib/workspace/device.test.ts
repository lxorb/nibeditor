/** What this machine remembers about the file list, and the one case where it has
 *  to be asked twice.
 *
 *  Emil, on his phone with even 0.5.6: *"I don't see the icons of the spaces on the
 *  Even Realities plugin right now."* Nothing was wrong with the icons: they were on
 *  his account, the account had handed them over, the plugin had written them down.
 *  What was wrong is when they were read. A packed plugin is served from a port that
 *  never comes back, so the page's own `localStorage` is always empty and the plugin
 *  puts its own in front of it - and this store read the empty one, because every
 *  static import of an entry runs before the entry's first line does. See
 *  lib/even/first.ts, which now wins that race, and `reread` below, which is for the
 *  half of it a cookie has no room for: the phone app's own store answers seconds
 *  after the app was built. */

import { beforeEach, describe, expect, test, vi } from 'vitest'
import { DeviceView } from './device.svelte'

/** `localStorage` in a map, which is what the plugin's own is too. */
function memory(): Storage {
  const held = new Map<string, string>()

  return {
    get length() {
      return held.size
    },
    key: (at: number) => [...held.keys()][at] ?? null,
    getItem: (key: string) => held.get(key) ?? null,
    setItem: (key: string, value: string) => {
      held.set(key, value)
    },
    removeItem: (key: string) => {
      held.delete(key)
    },
    clear: () => held.clear(),
  }
}

let store: Storage

beforeEach(() => {
  store = memory()
  vi.stubGlobal('localStorage', store)
})

describe('the icon a space wears', () => {
  test('is remembered, by folder rather than by id', () => {
    const view = new DeviceView()
    view.setIcon('/Notes', 'GraduationCap')

    expect(view.iconOf('/Notes')).toBe('GraduationCap')
    expect(new DeviceView().iconOf('/Notes')).toBe('GraduationCap')
  })

  test('and a space that chose none says so, which is what draws its letter', () => {
    expect(new DeviceView().iconOf('/Notes')).toBeNull()
  })

  test('follows the folder when it is renamed', () => {
    const view = new DeviceView()
    view.setIcon('/Uni', 'GraduationCap')
    view.moveIcon('/Uni', '/University')

    expect(view.iconOf('/Uni')).toBeNull()
    expect(view.iconOf('/University')).toBe('GraduationCap')
  })

  test('is taken away by choosing none', () => {
    const view = new DeviceView()
    view.setIcon('/Notes', 'Book')
    view.setIcon('/Notes', null)

    expect(view.iconOf('/Notes')).toBeNull()
    expect(new DeviceView().iconOf('/Notes')).toBeNull()
  })
})

/** The colour that icon is drawn in. Kept beside it here and on the account, which
 *  is what makes a space look like itself on the second machine rather than plain.
 *  What `applyIcon` answers is the one thing that is not simply "the account wins";
 *  see its own comment. */
describe('the colour a space is drawn in', () => {
  test('comes down with the icon, and the account is the one copy', () => {
    const view = new DeviceView()
    view.setIcon('/Notes', 'Book', 'violet')

    expect(view.applyIcon('/Notes', 'Book', 'teal')).toBeNull()
    expect(view.tintOf('/Notes')).toBe('teal')
    expect(new DeviceView().tintOf('/Notes')).toBe('teal')
  })

  test('so a colour taken off on another machine is taken off here', () => {
    const view = new DeviceView()
    view.setIcon('/Notes', 'Book', 'violet')

    // The account holds the icon and says there is no colour on it, which is a
    // colour taken off rather than a service that cannot carry one.
    expect(view.applyIcon('/Notes', 'Book', null)).toBeNull()
    expect(view.tintOf('/Notes')).toBeNull()
    expect(view.iconOf('/Notes')).toBe('Book')
  })

  /** The first pass against a service older than the colours: it carries the icon
   *  and has nothing at all where the colour goes. Reading that silence as "no
   *  colour" would undress every space dressed on this machine. */
  test('stays when the account has no column for it, and asks to be sent up', () => {
    const view = new DeviceView()
    view.setIcon('/Notes', 'Book', 'violet')

    expect(view.applyIcon('/Notes', 'Book')).toBe('violet')
    expect(view.tintOf('/Notes')).toBe('violet')
  })

  test('and a space with no colour here has nothing to send', () => {
    const view = new DeviceView()
    view.setIcon('/Notes', 'Book')

    expect(view.applyIcon('/Notes', 'Book')).toBeNull()
  })

  test('goes with the icon it was drawing', () => {
    const view = new DeviceView()
    view.setIcon('/Notes', 'Book', 'violet')

    expect(view.applyIcon('/Notes', null, null)).toBeNull()
    expect(view.iconOf('/Notes')).toBeNull()
    expect(view.tintOf('/Notes')).toBeNull()
  })

  test('follows the folder when it is renamed, the way the icon does', () => {
    const view = new DeviceView()
    view.setIcon('/Uni', 'GraduationCap', 'teal')
    view.moveIcon('/Uni', '/University')

    expect(view.tintOf('/Uni')).toBeNull()
    expect(view.tintOf('/University')).toBe('teal')
  })
})

describe('storage that arrives after the store was built', () => {
  test('is read on the second asking, which is the plugin', () => {
    // Built against a storage with nothing in it: a packed plugin, before the phone
    // app has answered.
    const view = new DeviceView()
    expect(view.iconOf('/Uni')).toBeNull()
    expect(view.recent).toEqual([])

    // And then it answers.
    store.setItem('nib:icons', JSON.stringify({ '/Uni': 'GraduationCap' }))
    store.setItem('nib:recent', JSON.stringify(['/Uni/Lecture.md']))
    store.setItem('nib:expanded', JSON.stringify({ '/Uni': true }))
    view.reread()

    expect(view.iconOf('/Uni')).toBe('GraduationCap')
    expect(view.recent).toEqual(['/Uni/Lecture.md'])
    expect(view.isExpanded('/Uni')).toBe(true)
  })

  /** The second seeding fills in only what nothing has written this launch - see
   *  `fillFrom` in lib/even/local.ts - so reading again cannot undo a choice made in
   *  the seconds before it landed. */
  test('and does not undo what was chosen while it was on its way', () => {
    const view = new DeviceView()
    view.setIcon('/Notes', 'Book')
    view.reread()

    expect(view.iconOf('/Notes')).toBe('Book')
  })

  test('reads nonsense as nothing written', () => {
    store.setItem('nib:icons', '{oh no')
    const view = new DeviceView()

    expect(view.icons).toEqual({})
  })
})

describe('folding the whole list', () => {
  test('shuts every row of the one space and leaves the others as they were', () => {
    const view = new DeviceView()
    view.expand('/Notes/A')
    view.expand('/Notes/A/B')
    view.expand('/Other/C')
    expect(view.unfoldedUnder('/Notes')).toBe(true)

    view.foldUnder('/Notes')

    expect(view.expanded).toEqual({ '/Other/C': true })
    expect(view.unfoldedUnder('/Notes')).toBe(false)
    expect(JSON.parse(store.getItem('nib:expanded') ?? '{}')).toEqual({ '/Other/C': true })
  })

  test('does not take a space whose name only starts the same way', () => {
    const view = new DeviceView()
    view.expand('/Notebook/A')

    view.foldUnder('/Note')

    expect(view.isExpanded('/Notebook/A')).toBe(true)
  })
})
