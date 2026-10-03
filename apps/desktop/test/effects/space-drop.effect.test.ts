import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

/** A tab carried onto the space switcher: held over its button the list opens, a space's
 *  row lights and takes the tab, and leaving the list closes what the hold opened. See
 *  tab-strip/space-drop.ts. In the effects project for its document: the switcher here is
 *  its markup and nothing else, and `elementFromPoint` - which jsdom does not lay out - is
 *  whatever the test says is under the pointer. */

const moved = vi.hoisted(() => [] as string[])

vi.mock('../../src/lib/tab-strip/to-space', () => ({
  spacesOf: () => [{ id: 'home' }, { id: 'uni' }],
  toSpace: (ids: string[], space: string) => {
    moved.push(`${ids.join()} to ${space}`)
    return Promise.resolve()
  },
}))

vi.mock('../../src/lib/workspace.svelte', () => ({
  workspace: { tabs: [{ id: 't1' }] },
}))

const { droppedOnSpace, overSpaces } = await import('../../src/lib/tab-strip/space-drop')

let under: Element | null = null
const at = { x: 1, y: 1 }

/** The switcher's markup: its button, and once it is open, its list of rows. */
function switcher() {
  document.body.innerHTML = `
    <button id="switcher" data-space-drop="switcher" aria-expanded="false"></button>
    <div role="menu" id="list" hidden>
      <button id="work" data-space-drop="work"></button>
      <button id="home" data-space-drop="home"></button>
      <p id="gap"></p>
    </div>
    <main id="pane"></main>`
  const button = document.getElementById('switcher')!
  const list = document.getElementById('list')!
  button.addEventListener('click', () => {
    const open = button.getAttribute('aria-expanded') !== 'true'
    button.setAttribute('aria-expanded', String(open))
    list.hidden = !open
  })
  return { button, list }
}

const byId = (id: string) => document.getElementById(id)
const over = (id: string | null) => {
  under = id === null ? null : byId(id)
  overSpaces('t1', id === null ? null : at)
}

beforeEach(() => {
  vi.useFakeTimers()
  moved.length = 0
  document.elementFromPoint = () => under
})

afterEach(() => {
  droppedOnSpace('t1')
  vi.useRealTimers()
})

describe('a tab held over the switcher', () => {
  test('lights the button, and opens the list after a moment', () => {
    const { button, list } = switcher()
    over('switcher')
    expect(button.classList.contains('is-drop')).toBe(true)
    expect(list.hidden).toBe(true)

    vi.advanceTimersByTime(500)
    expect(list.hidden).toBe(false)
  })

  test('passing over it opens nothing', () => {
    const { list } = switcher()
    over('switcher')
    vi.advanceTimersByTime(200)
    over('pane')
    vi.advanceTimersByTime(500)
    expect(list.hidden).toBe(true)
  })

  test('lights a space it may go to, and not the one it is in', () => {
    switcher()
    over('switcher')
    vi.advanceTimersByTime(500)

    over('work')
    expect(byId('work')?.classList.contains('is-drop')).toBe(false)
    over('home')
    expect(byId('home')?.classList.contains('is-drop')).toBe(true)
    expect(byId('switcher')?.classList.contains('is-drop')).toBe(false)
  })

  test('let go of on a space, moves there and closes the list', () => {
    const { list } = switcher()
    over('switcher')
    vi.advanceTimersByTime(500)
    over('home')

    expect(droppedOnSpace('t1')).toBe(true)
    expect(moved).toEqual(['t1 to home'])
    expect(list.hidden).toBe(true)
    expect(byId('home')?.classList.contains('is-drop')).toBe(false)
  })

  test('between two rows the list stays; off it, it closes again', () => {
    const { list } = switcher()
    over('switcher')
    vi.advanceTimersByTime(500)
    over('gap')
    expect(list.hidden).toBe(false)

    over('pane')
    expect(list.hidden).toBe(true)
  })

  test('let go of anywhere else, moves nothing', () => {
    switcher()
    over('switcher')
    expect(droppedOnSpace('t1')).toBe(false)
    over(null)
    expect(droppedOnSpace('t1')).toBe(false)
    expect(moved).toEqual([])
  })
})
