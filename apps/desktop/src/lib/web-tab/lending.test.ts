import { beforeEach, describe, expect, test, vi } from 'vitest'

/** A reader's tab lent to an agent: its page running out of sight for the agent's calls,
 *  whatever the reader is looking at, and given back to its own life after. */

interface Held {
  live: boolean
  onScreen: boolean
  opening: boolean
  lent: boolean
  url: string | null
  pane: { x: number; y: number; width: number; height: number } | null
  shown: boolean
}

const held = new Map<string, Held>()
const done: string[] = []

const pages = {
  of: (id: string) => {
    const found = held.get(id)
    if (found) return found
    const made: Held = {
      live: false,
      onScreen: false,
      opening: false,
      lent: false,
      url: null,
      pane: null,
      shown: false,
    }
    held.set(id, made)
    return made
  },
  each: () => [...held.entries()],
  thaw: vi.fn((id: string) => {
    done.push(`thaw ${id}`)
    return Promise.resolve()
  }),
  aside: vi.fn((id: string, _page: Held, pane: { x: number }) => {
    done.push(`aside ${id} ${String(pane.x)}`)
    return Promise.resolve()
  }),
  build: vi.fn((id: string, page: Held, pane: { x: number; width: number }) => {
    done.push(`build ${id} ${String(pane.x)} ${String(pane.width)}`)
    page.live = true
    page.shown = true
    page.pane = { ...pane, y: pane.x, height: 800 }
    return Promise.resolve()
  }),
  hide: vi.fn((id: string) => done.push(`hide ${id}`)),
}

vi.mock('./pages.svelte', () => ({ pages, OUT_OF_THE_WAY: 20_000 }))

const { lend, unlend } = await import('./lending')

beforeEach(() => {
  held.clear()
  done.length = 0
})

describe('a tab lent to an agent', () => {
  test('with no page is built outside the window, and keeps the pane it had', async () => {
    const page = pages.of('t1')
    page.url = 'https://a.example/'

    await lend('t1')

    expect(done).toEqual(['build t1 -20000 1280'])
    expect(page).toMatchObject({ lent: true, shown: false, pane: { x: 0, width: 1280 } })
  })

  test('with a page out of sight is thawed and put out of the way, never hidden', async () => {
    const page = pages.of('t1')
    Object.assign(page, {
      live: true,
      url: 'https://a.example/',
      pane: { x: 40, y: 0, width: 900, height: 600 },
    })

    await lend('t1')

    expect(done).toEqual(['thaw t1', 'aside t1 40'])
  })

  test('on screen is the reader’s to place, and is left as it is', async () => {
    Object.assign(pages.of('t1'), { live: true, onScreen: true, url: 'https://a.example/' })

    await lend('t1')

    expect(done).toEqual([])
    expect(pages.of('t1').lent).toBe(true)
  })

  test('is hidden again once the agent is done, if nobody is looking at it', async () => {
    Object.assign(pages.of('t1'), {
      live: true,
      url: 'https://a.example/',
      pane: { x: 0, y: 0, width: 1, height: 1 },
    })
    await lend('t1')
    done.length = 0

    unlend('t1')
    expect(done).toEqual(['hide t1'])
    expect(pages.of('t1').lent).toBe(false)

    // Once is enough, and a tab nothing lent - a note an agent wrote in - is no page.
    unlend('t1')
    unlend('a-note')
    expect(done).toEqual(['hide t1'])
    expect(held.has('a-note')).toBe(false)
  })
})
