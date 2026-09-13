import { BODY_INNER, BODY_ROWS } from '@nib/glasses'
import { describe, expect, test } from 'vitest'
import { type OpenNote, Session } from './session'

const paging = { breakAt: 2, gutter: 0, inner: BODY_INNER, rows: BODY_ROWS }

const LONG = Array.from(
  { length: 40 },
  (_one, at) => `Paragraph ${at} with enough words in it to run past one line of the panel.`,
).join('\n\n')

const note = (over: Partial<OpenNote> = {}): OpenNote => ({
  key: 'a',
  name: 'A note',
  text: LONG,
  ...over,
})

function opened(over: Partial<OpenNote> = {}): Session {
  const session = new Session()
  session.follow(note(over), paging)
  return session
}

/** The rules in the file's own header, one test each. */
describe('which note the glasses show', () => {
  test('shows the note the plugin has active', () => {
    const session = opened()

    expect(session.showing?.key).toBe('a')
    expect(session.showing?.name).toBe('A note')
    expect(session.page).not.toBeNull()
  })

  test('switching notes in the plugin switches the glasses', () => {
    const session = opened()
    session.follow(note({ key: 'b', name: 'Another', text: 'Other words.\n' }), paging)

    expect(session.showing?.key).toBe('b')
    expect(session.page?.words).toContain('Other words.')
  })

  test('closing the note in the plugin leaves it on the glasses', () => {
    const session = opened()
    const before = session.showing

    session.follow(null, paging)

    expect(session.showing).toEqual(before)
  })

  test('a note with nothing in it leaves the last one up', () => {
    const session = opened()
    const before = session.showing

    session.follow(note({ key: 'empty', text: '   \n' }), paging)

    expect(session.showing).toEqual(before)
  })

  test('remembers the page each note was left on', () => {
    const session = opened()
    session.turn(3)
    expect(session.showing?.page).toBe(3)

    session.follow(note({ key: 'b', text: 'Other.\n' }), paging)
    expect(session.showing?.page).toBe(0)

    // Back to the first, and back to page four of it.
    session.follow(note(), paging)
    expect(session.showing?.page).toBe(3)
  })
})

describe('turning a page', () => {
  test('goes one page each way', () => {
    const session = opened()

    session.turn(1)
    expect(session.showing?.page).toBe(1)
    session.turn(-1)
    expect(session.showing?.page).toBe(0)
  })

  test('stops at each end', () => {
    const session = opened()
    const count = session.showing?.count ?? 0

    session.turn(-5)
    expect(session.showing?.page).toBe(0)
    session.turn(count + 10)
    expect(session.showing?.page).toBe(count - 1)
  })

  test('goes straight to a page, for a spoken command', () => {
    const session = opened()

    session.goTo(4)
    expect(session.showing?.page).toBe(4)
  })
})

/** Item three: the phone's scroll and the page on the glasses are one thing. */
describe('the scroll binding', () => {
  test('goes to the page an offset in the note falls on', () => {
    const session = opened()
    const third = session.pages[3]

    expect(third).toBeDefined()
    session.goToOffset(third?.from ?? 0)
    expect(session.showing?.page).toBe(3)
  })

  test('says which region of the note is on the glass, for the frame', () => {
    const session = opened()
    session.goTo(2)
    const showing = session.showing

    expect(showing?.from).toBe(session.pages[2]?.from)
    expect(showing?.to).toBe(session.pages[2]?.to)
    expect(showing?.to).toBeGreaterThan(showing?.from ?? 0)
  })

  test('knows when an offset is already on the page in front of the reader', () => {
    const session = opened()
    const page = session.page

    expect(page).not.toBeNull()
    expect(session.holds(page?.from ?? 0)).toBe(true)
    expect(session.holds((page?.to ?? 0) - 1)).toBe(true)
    // Which is what stops the binding chasing its own tail: most of a scroll is
    // inside the page that is already up.
    expect(session.holds(page?.to ?? 0)).toBe(false)
  })

  test('covers the whole note between its pages, with no gap to fall into', () => {
    const session = opened()
    let at = 0
    for (const page of session.pages) {
      expect(page.from).toBeLessThanOrEqual(at + 1)
      at = page.to
    }

    expect(at).toBe(LONG.length)
  })

  test('every offset in the note lands on a page that exists', () => {
    const session = opened()
    for (let offset = 0; offset < LONG.length; offset += 97) {
      session.goToOffset(offset)
      expect(session.page).not.toBeNull()
    }
  })

  test('says which lines of the note the glass shows', () => {
    const session = opened()
    const showing = session.showing

    expect(showing?.firstLine).toBe(1)
    expect(showing?.lastLine).toBeGreaterThanOrEqual(1)
  })
})

/** An edit keeps the reader on the words in front of them. */
describe('an edit under the reader', () => {
  test('keeps them on the same page when the page did not change', () => {
    const session = opened()
    session.goTo(5)
    const before = session.page?.hash

    // An edit far below the page they are on.
    session.follow(note({ text: `${LONG}\n\nOne more paragraph at the end.` }), paging)

    expect(session.showing?.page).toBe(5)
    expect(session.page?.hash).toBe(before)
  })

  test('sends nothing at all when nothing they can see moved', () => {
    const session = opened()
    session.goTo(5)
    session.drew()
    expect(session.moved).toBe(false)

    session.follow(note({ text: `${LONG}\n\nOne more paragraph at the end.` }), paging)

    expect(session.moved).toBe(false)
  })

  test('sends when the page they are on did change', () => {
    const session = opened()
    session.drew()

    session.follow(note({ text: `An inserted first line.\n\n${LONG}` }), paging)

    expect(session.moved).toBe(true)
  })

  test('follows the words when a paragraph is put in above them', () => {
    const session = opened()
    session.goTo(4)
    const words = session.page?.words

    session.follow(
      note({ text: `An inserted first paragraph, of some length.\n\n${LONG}` }),
      paging,
    )

    // The words the reader was looking at, still in front of them - which is the
    // rule. Not necessarily at the top of the page any more: an insertion moves
    // where the pages are cut, and the page that holds those words now holds a
    // little of what came before them too.
    const first = words?.split('\n')[0] ?? ''
    expect(first).not.toBe('')
    expect(session.page?.words).toContain(first)
  })

  test('keeps the place in the note when the page itself was rewritten', () => {
    const session = opened()
    session.goTo(6)
    const from = session.page?.from ?? 0

    const edited = `${LONG.slice(0, from)}Words nobody had written before.\n\n${LONG.slice(from)}`
    session.follow(note({ text: edited }), paging)

    const now = session.page
    expect(now).not.toBeNull()
    // Within a page of where they were, which is the best a rewrite allows.
    expect(Math.abs((now?.index ?? 0) - 6)).toBeLessThanOrEqual(1)
  })

  test('holds no page at all before a note has arrived', () => {
    const session = new Session()

    expect(session.page).toBeNull()
    expect(session.showing).toBeNull()
    expect(session.pages).toEqual([])
    // And nothing it is asked to do throws.
    session.turn(1)
    session.goTo(3)
    session.goToOffset(50)
    expect(session.holds(0)).toBe(false)
  })
})

/** The paging settings reach the pages, which is what item two asks. */
describe('the paging the reader chose', () => {
  test('breaks at the heading level they chose', () => {
    const source = '# One\n\nwords\n\n## Two\n\nwords\n\n### Three\n\nwords\n'
    const at2 = new Session()
    at2.follow(note({ text: source }), { ...paging, breakAt: 2 })
    const at3 = new Session()
    at3.follow(note({ text: source }), { ...paging, breakAt: 3 })

    expect(at3.pages.length).toBeGreaterThan(at2.pages.length)
  })

  test('carries the line numbers into the pages', () => {
    const session = new Session()
    session.follow(note({ text: 'one\n\ntwo\n' }), {
      ...paging,
      gutter: 48,
      inner: BODY_INNER - 54,
    })

    expect(session.page?.numbers).not.toBe('')
  })
})

/** What the card on the phone follows while a finger is dragging.
 *
 *  Emil: *"it doesn't change WHILE scrolling but you kinda need to pause for it to
 *  react."* The card was drawn around the page the glasses had, and the glasses are
 *  told a tenth of a second after the thumb stops - so it sat still through the drag
 *  and jumped afterwards. `regionAt` answers the same question about any offset, with
 *  none of the consequences: nothing sent, nothing written down. */
describe('where the panel would be', () => {
  const paged = () => {
    const session = new Session()
    session.follow(note({ text: LONG }), paging)
    return session
  }

  test('is the page holding that offset, without going there', () => {
    const session = paged()
    const first = session.showing

    const later = session.regionAt(LONG.length - 200)
    expect(later?.from).toBeGreaterThan(first?.from ?? 0)
    // Nothing moved: the glasses are still where they were, and nothing was written
    // down about a page the reader only scrolled past.
    expect(session.showing?.from).toBe(first?.from)
    expect(session.showing?.page).toBe(first?.page)
  })

  test('stops at the last page of the note', () => {
    const session = paged()

    const far = session.regionAt(1_000_000)
    expect(far?.page).toBe(session.pages.length - 1)
  })

  test('and is the page that is up when the offset is on it', () => {
    const session = paged()
    const where = session.showing

    expect(session.regionAt(where?.from ?? 0)?.from).toBe(where?.from)
  })

  test('answers nothing for a note with nothing in it', () => {
    expect(new Session().regionAt(0)).toBeNull()
  })
})

/** One behaviour, since Emil asked for the choice to go: *"effectively it should be
 *  always nib who turns the pages."* A page is the panel, a flick is a page, and the
 *  number in the head always means something. */
describe('who turns the pages', () => {
  test('is the app, a whole panel at a time', () => {
    const session = new Session()
    session.follow(note({ text: LONG }), paging)

    const first = session.words
    expect(first.split('\n').length).toBeGreaterThan(1)

    session.turn(1)
    expect(session.words).not.toBe(first)
    expect(session.showing?.page).toBe(1)
    // A page of the note, not a row of it: the second page begins where the first
    // one ended.
    expect(session.showing?.firstLine).toBeGreaterThan(1)
  })

  test('and a page is one page of however many the note came to', () => {
    const session = new Session()
    session.follow(note({ text: LONG }), paging)

    expect(session.showing?.count).toBe(session.pages.length)
    session.goTo(1_000)
    expect(session.showing?.page).toBe(session.pages.length - 1)
  })
})
