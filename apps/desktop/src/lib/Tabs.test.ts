import { describe, expect, test, vi } from 'vitest'
import { render } from 'svelte/server'

/** What drawing one tab strip costs, counted.
 *
 *  The strip is drawn again whenever anything about the panes changes, which on a
 *  desktop with two panes open is every keystroke that moves the caret between them
 *  and every tab activated, pinned or dragged. So what a row asks per render is
 *  what the strip costs, and a row that asks the same question four times costs four
 *  times what it needs to.
 *
 *  Counted rather than timed: the number of calls is the claim, and how long they
 *  take says only how busy this machine is. Rendered on the server, which draws the
 *  markup once and so counts exactly one render's worth.
 *
 *  The mark is the one the strip asked three times over - twice to decide whether a
 *  pinned tab shows its name, once more to draw it - and the dots for the other
 *  devices in a note allocated a fresh array-like per tab beside it. */

/** Every call to the two the rows ask, so a second question shows up as a second
 *  number. */
const asked: string[] = []

vi.mock('./file-mark', async (importOriginal) => {
  const real = await importOriginal<typeof import('./file-mark')>()
  return {
    ...real,
    markOf: (kind: string) => {
      asked.push(`markOf ${kind}`)
      return real.markOf(kind as never)
    },
  }
})

/** The stores the strip reads, stood in for: what is under test is the markup, and
 *  none of these has anything to do with the counting. */
vi.mock('./rooms.svelte', () => ({ rooms: { present: {}, seen: {}, following: null } }))

const { workspace } = await import('./workspace.svelte')
const Tabs = (await import('./Tabs.svelte')).default

/** `count` notes open in one pane, each pinned so every branch that asks about the
 *  mark is taken. */
function strip(count: number) {
  workspace.tabs = []
  workspace.spaces = [{ id: 's', name: 'Space', root: '/space' }]
  workspace.activeSpaceId = 's'

  for (let at = 0; at < count; at++) workspace.openBlank(`Note ${at}`, '# note')

  // Whichever pane the store put them in, rather than whichever one is focused:
  // the point of the test is the rows, not where they landed.
  const paneId = workspace.tabs[0]?.paneId ?? ''
  for (const tab of workspace.tabs) {
    tab.paneId = paneId
    tab.pinned = true
  }

  if (workspace.tabsIn(paneId).length !== count) {
    throw new Error(`the strip holds ${workspace.tabsIn(paneId).length} of ${count} tabs`)
  }

  return paneId
}

describe('drawing the tab strip', () => {
  test('asks what mark a tab wears once per tab', () => {
    const paneId = strip(8)
    asked.length = 0

    const drawn = render(Tabs, { props: { paneId } })

    // The strip really did draw eight rows, so the count below is a count of
    // something: a test that asserts nothing was asked passes on an empty strip.
    expect(drawn.body.split('data-tab=').length - 1).toBe(8)
    // One per tab. Un-hoisted this was three: twice to decide whether a pinned
    // tab shows its name, once more to draw the mark.
    expect(asked).toHaveLength(8)
  })

  test('and so twice the tabs is twice the asking, and no more', () => {
    const paneId = strip(16)
    asked.length = 0

    const drawn = render(Tabs, { props: { paneId } })

    expect(drawn.body.split('data-tab=').length - 1).toBe(16)
    expect(asked).toHaveLength(16)
  })
})
