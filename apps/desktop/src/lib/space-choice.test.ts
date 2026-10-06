import { describe, expect, test } from 'vitest'
import { choosing, type Moment } from './space-choice'

/** When the space chooser is up, which is Obsidian's rule: no vault, the chooser.
 *  One moment that shows it, and every reason that does not, one at a time. */

const FRESH: Moment = {
  native: true,
  firstVisit: false,
  plugin: false,
  restored: true,
  spaces: 0,
  restoring: false,
  signedIn: false,
  invited: false,
  tabs: 0,
}

describe('the space chooser', () => {
  test('is up on a fresh install of the desktop or the phone app', () => {
    expect(choosing(FRESH)).toBe(true)
  })

  test.each<[string, Partial<Moment>]>([
    [
      'the browser build past its first visit, which seeded the welcome note before',
      { native: false },
    ],
    ['the plugin, which never shows anything new', { plugin: true }],
    ['before the spaces folder has been read', { restored: false }],
    ['once there is a space', { spaces: 1 }],
    ['while the account is still being looked for', { restoring: true }],
    ['for somebody signed in, whose spaces are on their way', { signedIn: true }],
    ['while a link somebody followed is being walked through', { invited: true }],
    ['over a file handed over at launch', { tabs: 1 }],
  ])('is not up in %s', (_, change) => {
    expect(choosing({ ...FRESH, ...change })).toBe(false)
  })

  test('is up on the browser build’s first visit, beside the welcome note’s space', () => {
    expect(choosing({ ...FRESH, native: false, firstVisit: true, spaces: 1, tabs: 1 })).toBe(true)
    expect(choosing({ ...FRESH, native: false, firstVisit: true, signedIn: true })).toBe(false)
  })

  test('comes back when the last space goes, as Obsidian’s does', () => {
    expect(choosing({ ...FRESH, spaces: 1 })).toBe(false)
    expect(choosing({ ...FRESH, spaces: 0 })).toBe(true)
  })
})
