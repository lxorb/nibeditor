import { describe, expect, test } from 'vitest'
import { type Build, type Opener, openerFor } from './openers'

/** Which opener a path is for: a branch for every kind, and for the two builds.
 *
 *  This is the one part of opening that is a decision rather than machinery, so it
 *  is the one part that can be tested without a workspace. The rest - making the
 *  tab - is the class's own core loop; see the workspace section of
 *  docs/conventions.md for why it does not come out. */

/** The app, which shows everything. */
const APP: Build = { evenBuild: false, isPlugin: false }

/** The glasses plugin, from which the viewer, the plane and the handwriting
 *  surface are all missing. `evenBuild` is the define the PDF asks, `isPlugin` the
 *  latch the other two ask; on a real plugin page both are true. */
const PLUGIN: Build = { evenBuild: true, isPlugin: true }

/** No path is a `url:` note unless a case says so. */
const noNotes = (_path: string) => false

function opener(
  path: string,
  build = APP,
  isUrlNote: (path: string) => boolean = noNotes,
): Opener | null {
  return openerFor(path, isUrlNote, build)
}

describe('what opens a path in the app', () => {
  test('a PDF opens in the viewer', () => {
    expect(opener('Papers/Kestrel.pdf')).toBe('pdf')
  })

  test('a shortcut opens in the browser', () => {
    expect(opener('Links/Svelte docs.url')).toBe('web')
  })

  test('a page note opens on the handwriting surface', () => {
    expect(opener('Sketches/Wind.pages')).toBe('pages')
  })

  test('a canvas opens on the plane', () => {
    expect(opener('Boards/Plan.canvas')).toBe('canvas')
  })

  test('and everything else opens as a note', () => {
    expect(opener('Read me.md')).toBe('note')
    expect(opener('notes/Kestrel.md')).toBe('note')
    // A file the app has no special surface for is still a note: it opens as text.
    expect(opener('data/table.csv')).toBe('note')
  })
})

describe('a markdown note that is really a website', () => {
  const isSvelte = (path: string) => path === 'Links/Svelte.md'

  test('opens in the browser when the index says it holds a url', () => {
    expect(opener('Links/Svelte.md', APP, isSvelte)).toBe('web')
  })

  test('opens as a note when the index has not caught up with it', () => {
    // Same path, but nothing yet knows it is a website: it opens as the note it
    // also is, and the next pass settles it.
    expect(opener('Links/Svelte.md', APP, noNotes)).toBe('note')
  })

  test('and only a markdown note is asked about', () => {
    // A `.url` never reaches the index question - its name already said what it is,
    // so the predicate is not even consulted.
    let asked = false
    opener('Links/Svelte docs.url', APP, (path) => {
      asked = true
      return path.length > 0
    })
    expect(asked).toBe(false)
  })
})

describe('in front of a pair of glasses', () => {
  test('a PDF, a canvas and a page note open nothing', () => {
    expect(opener('Papers/Kestrel.pdf', PLUGIN)).toBeNull()
    expect(opener('Boards/Plan.canvas', PLUGIN)).toBeNull()
    expect(opener('Sketches/Wind.pages', PLUGIN)).toBeNull()
  })

  test('a note still opens', () => {
    expect(opener('Read me.md', PLUGIN)).toBe('note')
  })

  test('and a shortcut is not stopped here - openWeb declines it itself', () => {
    // The routing does not guard a website; the reason is that a shortcut is a
    // website everywhere the routing is read, and `openWeb` is where the plugin
    // says no. So the router still answers 'web'.
    expect(opener('Links/Svelte docs.url', PLUGIN)).toBe('web')
  })

  test('and the PDF asks the build while the others ask the latch', () => {
    // A note dragged out of the app into a plugin-that-is-really-the-app-build is
    // the case the two flags exist to tell apart: a build with the viewer compiled
    // in but running as the plugin still cannot show a canvas, but could a PDF.
    expect(opener('Papers/Kestrel.pdf', { evenBuild: false, isPlugin: true })).toBe('pdf')
    expect(opener('Boards/Plan.canvas', { evenBuild: false, isPlugin: true })).toBeNull()
  })
})
