import { describe, expect, test, vi } from 'vitest'
import { render } from 'svelte/server'

/** What the sidebar draws: which tabs its strip holds, what the Footnotes panel makes
 *  of a note's footnotes, and who is offered the button that holds a panel on one note.
 *
 *  Rendered on the server, the way Tabs.test does beside it: what is under test is the
 *  markup, and the markup is what a reader gets. The stores are driven by hand and the
 *  three that reach a disk, a network or a `ResizeObserver` are stood in for.
 *
 *  The hold had no test at all, which is how it came to be offered on a phone while the
 *  code said it was not and the docs said it was not either. */

vi.mock('./rooms.svelte', () => ({ rooms: { present: {}, following: null } }))
vi.mock('./recorder/commands', () => ({
  canRecord: () => false,
  canTakeMeetingNotes: () => false,
  meeting: { running: false },
  meetingLabel: () => 'Meeting notes',
  record: { running: false },
  recordLabel: () => 'Record',
}))
vi.mock('./surfaces.svelte', () => ({
  pagesNavigator: () => new Promise(() => undefined),
  searchPanel: () => new Promise(() => undefined),
}))

const { workspace } = await import('./workspace.svelte')
const { viewport } = await import('./viewport.svelte')
const Sidebar = (await import('./Sidebar.svelte')).default

/** A space with one note open, which is what a panel about a note needs. */
function open(text: string) {
  workspace.tabs = []
  workspace.spaces = [{ id: 's', name: 'Space', root: '/space' }]
  workspace.activeSpaceId = 's'
  workspace.openBlank('A note', text)
}

function drawn(
  panel: Parameters<typeof workspace.showPanel>[0],
  device: typeof viewport.device = 'desktop',
) {
  viewport.device = device
  // Written rather than asked for: `showPanel` is a toggle, and a test that pressed the
  // tab twice would be a test of a shut panel.
  workspace.panel = panel
  return render(Sidebar, { props: { side: 'left' as const } }).body
}

describe('the panel tabs', () => {
  test('are the five the sidebar has, in one fixed order', () => {
    open('# Head\n')
    const html = drawn('tree')
    const labels = [...html.matchAll(/role="tab"[^>]*aria-label="([^"]+)"/g)].map(([, one]) => one)

    // The strip labels its tabs however the shell dresses them; what matters is that
    // all five are in it and that Footnotes is the last of them.
    for (const one of ['Files', 'Outline', 'Search', 'Links', 'Footnotes']) {
      expect(html, one).toContain(one)
    }
    if (labels.length) expect(labels).toEqual(['Files', 'Outline', 'Search', 'Links', 'Footnotes'])
  })
})

describe('the Footnotes panel', () => {
  const NOTE = 'A claim[^1] and another[^two].\n\n[^1]: the first\n\n[^two]: the second\n'

  test('draws a row per footnote, with its label and what it says', () => {
    open(NOTE)
    const html = drawn('footnotes')

    expect(html).toContain('the first')
    expect(html).toContain('the second')
    expect(html.match(/class="[^"]*\brow note\b/g)).toHaveLength(2)
  })

  test('says how many there are in its own heading', () => {
    open(NOTE)
    expect(drawn('footnotes')).toContain('Footnotes<span>2</span>')
  })

  test('offers the definition as well as the mark, which is the whole point of it', () => {
    open(NOTE)
    const html = drawn('footnotes')

    expect(html.match(/to-definition/g)).toHaveLength(2)
    expect(html).toContain('Go to the definition')
  })

  test('and offers no definition for a mark nothing defines', () => {
    open('A claim[^1] and nothing at the bottom.\n')
    const html = drawn('footnotes')

    expect(html).toContain('row note')
    expect(html).not.toContain('to-definition')
  })

  test('says so plainly for a note with none', () => {
    open('# Head\n\nWords.\n')
    const html = drawn('footnotes')

    expect(html).toContain('No footnotes in this note')
    expect(html).toContain('Footnotes<span>0</span>')
  })

  test('leaves the Outline’s own section exactly where it was', () => {
    open(NOTE)
    const html = drawn('outline')

    expect(html).toContain('the first')
    expect(html).toContain('Footnotes<span>2</span>')
  })
})

/** The button that holds a panel on one note while another is written beside it.
 *
 *  A handheld holds one document, so there is nothing to hold a panel against and
 *  opening another note closes the tab it would have been held on. The docs say it is
 *  not offered there; this is what makes that true rather than claimed. */
describe('the button that holds a panel on a note', () => {
  const HELD = 'Stay on this note'

  test('is offered on the three panels that are about one note', () => {
    open('# Head\n\nWords[^1].\n\n[^1]: said\n')

    for (const panel of ['outline', 'links', 'footnotes'] as const) {
      expect(drawn(panel), panel).toContain(HELD)
    }
  })

  test('and on neither of the two that are about the space', () => {
    open('# Head\n')

    for (const panel of ['tree', 'search'] as const) {
      expect(drawn(panel), panel).not.toContain(HELD)
    }
  })

  test('is not offered on a phone, which holds one document', () => {
    open('# Head\n\nWords[^1].\n\n[^1]: said\n')

    for (const panel of ['outline', 'links', 'footnotes'] as const) {
      expect(drawn(panel, 'phone'), panel).not.toContain(HELD)
    }
  })

  /** A handheld is the machine, not the size of the window: `deviceFor` asks the width
   *  only once a finger and a mobile user agent have already said it is a handheld, so a
   *  desktop window narrowed to the width of a phone stays a desktop and still has two
   *  panes to hold a panel between. Which is what the docs say, and - since nothing
   *  tested it - what an audit reading a narrow window as a phone would have called a
   *  bug. See viewport.svelte.ts and docs/mobile.md. */
  test('which is the machine and not the width, so a narrow window keeps it', () => {
    open('# Head\n')

    const html = drawn('outline', 'desktop')

    expect(viewport.touch).toBe(false)
    expect(html).toContain(HELD)
  })

  test('and the palette offers the same hold, by the same rule', async () => {
    const { appCommands } = await import('./commands')
    open('# Head\n')

    viewport.device = 'desktop'
    workspace.panel = 'footnotes'
    const desktop = appCommands().find((one) => one.id === 'hold-panel')
    expect(desktop?.label).toBe(HELD)
    expect(desktop?.disabled).toBe(false)

    // Nothing to hold: a panel that is about the space, and then a handheld.
    workspace.panel = 'tree'
    expect(appCommands().find((one) => one.id === 'hold-panel')?.disabled).toBe(true)

    workspace.panel = 'outline'
    viewport.device = 'phone'
    expect(appCommands().find((one) => one.id === 'hold-panel')?.disabled).toBe(true)
    viewport.device = 'desktop'
  })

  test('nor on a tablet, which holds one document too', () => {
    open('# Head\n\nWords[^1].\n\n[^1]: said\n')

    for (const panel of ['outline', 'links', 'footnotes'] as const) {
      expect(drawn(panel, 'tablet'), panel).not.toContain(HELD)
    }
  })
})
